/**
 * Live Gemini certification for autonomous recovery. Dry run by default: a deterministic rehearsal on an in-memory
 * PGlite database (no model call, .env.local not opened) that must find at least two usable candidates. With
 * --approve-gemini-calls it repeats the rehearsal gate, then runs ONE recovery with the real GeminiLlm behind the meter:
 * at most 6 model requests, a fixed budget, no retries, no tool access beyond the recovery tool set. Payments stay MOCK.
 * Writes artifacts/recovery-live-<ISO>.json with sanitized evidence only (no keys, prompts, model text or DATABASE_URL).
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { SYNTHETIC_ECONOMICS } from "../src/domain/economics";
import { DEMO_STATION } from "../src/domain/station";
import { SLOT_MS } from "../src/domain/units";
import { DEFAULT_GEMINI_MODEL, GeminiLlm } from "../src/server/ai/geminiLlm";
import type { LlmDiagnostic, LlmResult, StructuredLlm } from "../src/server/ai/llm";
import { openPglite, type Db } from "../src/server/db/client";
import type { AppDeps } from "../src/server/deps";
import { getReservation, effectivePowerOf, type ReservationRow } from "../src/server/repo";
import { runProvenance } from "../src/server/services/recoveryProvenance";
import { acceptOffer, handleCheckoutReturn } from "../src/server/services/checkoutService";
import { createQuote, scenarioFor } from "../src/server/services/quoteService";
import { runRecovery } from "../src/server/services/scheduleService";
import type { RecoveryRunView } from "../src/server/services/recoveryRuns";
import { MockGateway } from "../src/payments/mockGateway";
import { BudgetExceededError, MeteredLlm } from "./aiSmokeFlow";
import { boundedToolVerdict, pickLiveEnv, skippedModelReasons, summarizeTrace, type BoundedVerdict } from "./recoveryLiveFlow";

const APPROVAL_FLAG = "--approve-gemini-calls";
const MAX_REQUESTS = 6;
const BUDGET_USD = 0.25;
/** Budgeting only: a conservative planning rate. The Gemini free tier is priced at $0 and the paid tariff was not verified. */
const PLANNING_PRICE = { inPerMTok: 10, outPerMTok: 50 };
const BASE_URL = "http://recovery-live.local";
const NIGHT = "2026-11-05";
const DRIVER = "drv_live_1";
const EVENT_ID = "evt_live_0001";
const START_MS = Date.parse("2026-11-05T20:00:00Z");
const MIN_USABLE_CANDIDATES = 2;
const TERMINAL = new Set(["COMMITTED", "NEEDS_APPROVAL", "INFEASIBLE"]);

const log = (msg: string) => process.stdout.write(`${msg}\n`);

interface Harness {
  db: Db;
  mock: MockGateway;
  deps: AppDeps;
  /** Every payment-gateway method called through the deps, in order. */
  paymentCalls: string[];
}

async function openHarness(llm: StructuredLlm | null): Promise<Harness> {
  const db = await openPglite();
  const mock = new MockGateway(db, BASE_URL);
  const paymentCalls: string[] = [];
  const gateway = new Proxy(mock, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        paymentCalls.push(String(prop));
        return Reflect.apply(value, target, args);
      };
    },
  });
  let seq = 0;
  const deps: AppDeps = {
    db,
    gateway,
    station: DEMO_STATION,
    economics: SYNTHETIC_ECONOMICS,
    now: () => START_MS,
    newId: (prefix) => `${prefix}_live_${++seq}`,
    baseUrl: BASE_URL,
    merchantRef: "sandbox-merchant-live",
    quoteTtlMs: 10 * 60_000,
    llm,
    awaitRecovery: false,
  };
  return { db, mock, deps, paymentCalls };
}

/** Synthetic reservation, approved on the mock hosted page and scheduled, as in the orchestrator integration test. */
async function seedScheduled(h: Harness): Promise<string> {
  const quote = await createQuote(h.deps, DRIVER, { portId: "port_c", nightOf: NIGHT, plugInLocal: "19:00", departLocal: "07:00", targetBatteryKWh: 30, spendCapCents: 2500 });
  const offer = quote.offers.find((o) => o.kind === "flex_gentle")!;
  const accepted = await acceptOffer(h.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(h.db, accepted.reservationId))!;
  const order = await h.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(h.deps, DRIVER, accepted.reservationId, state, r.paypal_order_id!);
  return accepted.reservationId;
}

const eveningSlot = () => (Date.parse("2026-11-06T06:00:00Z") - scenarioFor(DEMO_STATION, NIGHT).grid.startMs) / SLOT_MS;
const DISTURBANCE_PARAMS = { maxPowerW: 7_200 };

/** Records the charger power cut directly, so the only path that starts a run is runRecovery itself. */
async function insertDisturbance(h: Harness, rid: string): Promise<void> {
  await h.db.query(
    "insert into disruption_events (id, event_id, reservation_id, type, params, effective_slot, created_by) values ($1, $2, $3, $4, $5, $6, 'TEST')",
    [h.deps.newId("dis"), EVENT_ID, rid, "CHARGER_POWER_REDUCTION", JSON.stringify(DISTURBANCE_PARAMS), eveningSlot()],
  );
}

async function scheduleVersions(db: Db, rid: string) {
  const rows = await db.query<{ version: number; source: string; recovery_run_id: string | null }>(
    "select version, source, recovery_run_id from schedule_versions where reservation_id = $1 order by version",
    [rid],
  );
  return rows.map((v) => ({ version: v.version, source: v.source, linkedToRun: v.recovery_run_id !== null }));
}

/** Deterministic rehearsal: same seed and disturbance, no model. Proves the case has usable candidates before any live call. */
async function rehearse(): Promise<{ proposed: number; rejected: number; run: RecoveryRunView }> {
  const h = await openHarness(null);
  const rid = await seedScheduled(h);
  await insertDisturbance(h, rid);
  const run = await runRecovery(h.deps, EVENT_ID);
  const candidates = run.outcome?.candidates ?? [];
  return { proposed: candidates.filter((c) => c.status === "PROPOSED").length, rejected: candidates.filter((c) => c.status === "REJECTED").length, run };
}

function candidateIdOf(input: unknown): unknown {
  return typeof input === "object" && input !== null && "candidateId" in input ? input.candidateId : undefined;
}

/** Counts every generate call the orchestrator makes; the difference from the meter's calls is what the meter refused. */
class CountingLlm implements StructuredLlm {
  attempts = 0;
  constructor(private readonly inner: StructuredLlm) {}

  get provider() {
    return this.inner.provider;
  }

  get model(): string {
    return this.inner.model;
  }

  generate<S extends z.ZodType>(req: { system: string; user: string; schema: S; maxTokens: number }): Promise<LlmResult<z.infer<S>>> {
    this.attempts += 1;
    return this.inner.generate(req);
  }
}

function sanitizeDiagnostic(d: LlmDiagnostic | null): Partial<LlmDiagnostic> | null {
  if (!d) return null;
  return { category: d.category, errorName: d.errorName, httpStatus: d.httpStatus, providerStatus: d.providerStatus };
}

async function liveRecovery(apiKey: string, model: string) {
  const meter = new MeteredLlm(new GeminiLlm(apiKey, model), { maxRequests: MAX_REQUESTS, budgetUsd: BUDGET_USD, price: PLANNING_PRICE });
  const counting = new CountingLlm(meter);
  const h = await openHarness(counting);
  const rid = await seedScheduled(h);
  await insertDisturbance(h, rid);
  const versionsBefore = await scheduleVersions(h.db, rid);
  const paymentsBefore = h.paymentCalls.length;
  let runError: string | null = null;
  let run: RecoveryRunView | null = null;
  try {
    run = await runRecovery(h.deps, EVENT_ID);
  } catch (err) {
    runError = err instanceof Error ? err.name : "UNKNOWN";
  }
  const reservation: ReservationRow = (await getReservation(h.db, rid))!;
  const power = await effectivePowerOf(h.db, reservation);
  return {
    meter,
    counting,
    run,
    runError,
    paymentCallsDuringRun: h.paymentCalls.slice(paymentsBefore),
    versionsBefore,
    versionsAfter: await scheduleVersions(h.db, rid),
    eveningMaxPowerW: Math.max(...power.slice(Math.ceil(eveningSlot()))),
    refusedByMeter: counting.attempts - meter.calls.length,
    model,
  };
}

type LiveResult = Awaited<ReturnType<typeof liveRecovery>>;

function buildVerdicts(live: LiveResult, rehearsal: { proposed: number }) {
  const run = live.run;
  const trace = run?.trace ?? [];
  const chosen = run?.outcome?.candidates.find((c) => c.chosen) ?? null;
  const validatedInTrace = chosen !== null && trace.some((e) => e.tool === "validateRecoveryPlan" && e.outcome === "OK" && candidateIdOf(e.input) === chosen.id);
  const bounded = boundedToolVerdict(trace, live.paymentCallsDuringRun.length);
  const failedCalls = live.meter.calls.filter((c) => !c.ok);
  const consentMatches = chosen !== null && ((chosen.consent === "AUTO_COMMIT" && run?.status === "COMMITTED") || (chosen.consent === "NEEDS_DRIVER_APPROVAL" && run?.status === "NEEDS_APPROVAL"));
  const verdict = (v: BoundedVerdict | "PASS" | "FAIL" | "NOT TESTED", note: string) => ({ verdict: v, note });
  return {
    modelOnlyAllowedTools: verdict(bounded.verdict, `model named [${bounded.toolsNamed.join(", ")}]; outside tool set: ${bounded.outsideToolSet.length}`),
    noPaymentToolCalls: verdict(live.paymentCallsDuringRun.length === 0 ? "PASS" : "FAIL", `gateway calls during run: ${live.paymentCallsDuringRun.length}`),
    chosenCandidatePassedValidation: verdict(validatedInTrace ? "PASS" : chosen ? "FAIL" : "BLOCKED", chosen ? `chosen ${chosen.preference} (${chosen.consent}), validated in trace: ${validatedInTrace}` : "no candidate was chosen"),
    consentRespected: verdict(chosen === null ? "BLOCKED" : consentMatches ? "PASS" : "FAIL", `status ${run?.status ?? "none"}`),
    requestCapEnforced: verdict(live.meter.calls.length <= MAX_REQUESTS ? "PASS" : "FAIL", `requests sent ${live.meter.calls.length}, refused by meter ${live.refusedByMeter}`),
    modelFailureFallsBack: verdict(failedCalls.length === 0 ? "NOT TESTED" : run && TERMINAL.has(run.status) && !run.aiUsed ? "PASS" : "FAIL", `failed provider calls: ${failedCalls.length}; aiUsed: ${run?.aiUsed ?? false}`),
    invalidOrInjectedOutputFallsBack: verdict("NOT TESTED", `live adversarial probe not run; rejected model steps observed: ${trace.filter((e) => e.actor === "GEMINI" && e.outcome === "REJECTED").length}; rehearsal usable candidates: ${rehearsal.proposed}`),
  };
}

async function main() {
  const approved = process.argv.includes(APPROVAL_FLAG);
  log(`Recovery live plan: provider=gemini, one recovery run, at most ${MAX_REQUESTS} model requests, budget cap $${BUDGET_USD} (planning rate), no retries, payments MOCK, Neon/DATABASE_URL not used (in-memory PGlite).`);
  const rehearsal = await rehearse();
  log(`Deterministic rehearsal: run status=${rehearsal.run.status}, usable candidates=${rehearsal.proposed}, rejected=${rehearsal.rejected}.`);
  if (rehearsal.proposed < MIN_USABLE_CANDIDATES) throw new Error(`rehearsal found fewer than ${MIN_USABLE_CANDIDATES} usable candidates; no live call made`);
  if (!approved) {
    log(`Dry run only. The .env.local file is not opened. Re-run with ${APPROVAL_FLAG} to make the authorized real Gemini call.`);
    return;
  }

  const envText = await readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  const fileEnv = pickLiveEnv(envText);
  const apiKey = fileEnv.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in .env.local");
  // An explicit --model=<id> wins over the file, so the certified model is used even if .env.local names another one.
  const modelFlag = process.argv.find((a) => a.startsWith("--model="))?.slice("--model=".length).trim();
  const model = modelFlag || (fileEnv.GEMINI_MODEL ?? process.env.GEMINI_MODEL)?.trim() || DEFAULT_GEMINI_MODEL;

  const live = await liveRecovery(apiKey, model);
  const run = live.run;
  const ranAt = new Date().toISOString();
  const okCalls = live.meter.calls.filter((c) => c.ok).length;
  const modelFailures = live.meter.calls.filter((c) => !c.ok).map((c) => c.reason ?? "UNKNOWN");
  const trace = run?.trace ?? [];
  const evidence = {
    ranAt,
    provider: "gemini",
    model: live.model,
    servedModels: [...new Set(live.meter.calls.flatMap((c) => (c.servedModel ? [c.servedModel] : [])))],
    paymentsMode: "MOCK",
    paymentGatewayCallsDuringRun: live.paymentCallsDuringRun.length,
    rehearsal: { usableCandidates: rehearsal.proposed, rejectedCandidates: rehearsal.rejected },
    requests: { limit: MAX_REQUESTS, attempted: live.counting.attempts, sentToProvider: live.meter.calls.length, refusedByMeter: live.refusedByMeter, providerResponses: live.meter.calls.filter((c) => c.responded).length, okResponses: okCalls },
    budget: { capUsd: BUDGET_USD, planningPrice: PLANNING_PRICE, estimatedCostUsd: Number(live.meter.spent.toFixed(6)) },
    tokens: live.meter.calls.reduce((t, c) => ({ inputTokens: t.inputTokens + c.inputTokens, outputTokens: t.outputTokens + c.outputTokens }), { inputTokens: 0, outputTokens: 0 }),
    calls: live.meter.calls.map((c) => ({ ok: c.ok, responded: c.responded, reason: c.reason, diagnostic: sanitizeDiagnostic(c.diagnostic), latencyMs: c.latencyMs, inputTokens: c.inputTokens, outputTokens: c.outputTokens })),
    runError: live.runError,
    run: run ? { status: run.status, aiUsed: run.aiUsed, mode: runProvenance(run).decision, provenance: runProvenance(run).decisionLabel, explanationSource: run.explanation?.source ?? null, outcomeKind: run.outcome?.kind ?? null, versionCommitted: run.outcome?.versionCommitted ?? null } : null,
    fallbackReasons: [...skippedModelReasons(trace), ...modelFailures],
    trace: summarizeTrace(trace),
    chosenCandidate: (() => {
      const c = run?.outcome?.candidates.find((x) => x.chosen);
      return c ? { id: c.id, preference: c.preference, consent: c.consent, priceCents: c.priceCents } : null;
    })(),
    scheduleVersions: { before: live.versionsBefore, after: live.versionsAfter },
    eveningMaxPowerW: live.eveningMaxPowerW,
    adversarialProbe: "NOT TESTED: not run in this certification; the price-change probe needs an injected instruction the real prompt does not carry.",
    verdicts: buildVerdicts(live, rehearsal),
  };
  await mkdir(path.join(process.cwd(), "artifacts"), { recursive: true });
  const file = path.join(process.cwd(), "artifacts", `recovery-live-${ranAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(evidence, null, 2) + "\n");
  log(`Run status=${run?.status ?? "none"} mode=${evidence.run?.mode ?? "none"} requests sent=${live.meter.calls.length} refused=${live.refusedByMeter} tokens in/out=${evidence.tokens.inputTokens}/${evidence.tokens.outputTokens}`);
  log(`Evidence: ${path.relative(process.cwd(), file)}`);
  if (live.runError) process.exitCode = 1;
}

main().catch((err: unknown) => {
  if (err instanceof BudgetExceededError) console.error(`Recovery live stopped: ${err.message}`);
  console.error(`Recovery live FAILED: ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown"}`);
  process.exit(1);
});
