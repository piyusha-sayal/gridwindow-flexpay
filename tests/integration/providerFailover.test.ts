/**
 * Gemini primary with OpenRouter fallback on a recovery run (MOCK payments, PGlite, scripted adapters, no network).
 * Covers which failures switch providers, the shared request budget across both providers, provider-specific decision
 * provenance and that failover never duplicates a schedule commit or reaches the payment gateway.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { DEMO_STATION } from "@/domain/station";
import { SLOT_MS } from "@/domain/units";
import { FailoverLlm } from "@/server/ai/failoverLlm";
import { classifyHttpStatus, type LlmFailure, type LlmResult, type ModelProvider, type StructuredLlm } from "@/server/ai/llm";
import { getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote, scenarioFor } from "@/server/services/quoteService";
import { MAX_MODEL_REQUESTS, orchestrateRecovery } from "@/server/services/recoveryOrchestrator";
import { runProvenance, RESUMED_DETERMINISTIC_DETAIL } from "@/server/services/recoveryProvenance";
import type { RecoveryRunView } from "@/server/services/recoveryRuns";
import { makeApp, NIGHT, request, resetApp, type TestApp } from "./helpers";

const DRIVER = "drv_provider_1";
let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});
beforeEach(async () => {
  await resetApp(app);
  app.deps.llm = null;
  app.deps.awaitRecovery = true;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterAll(async () => {
  await app.db.close();
});

const grid = scenarioFor(DEMO_STATION, NIGHT).grid;
const EVENING_SLOT = (Date.parse("2026-11-06T06:00:00Z") - grid.startMs) / SLOT_MS;
const DECIDING_STEPS: [string, Record<string, unknown>?][] = [
  ["requestRecoveryCandidates"],
  ["validateRecoveryPlan", { candidateId: "c1" }],
  ["proposeRecovery", { candidateId: "c1" }],
  ["commitPermittedRecovery"],
];

/** A scripted adapter presented as a named provider. Each call answers with the next scripted step or a fixed failure. */
class Adapter implements StructuredLlm {
  calls = 0;
  private readonly queue: { tool: string; argsJson: string }[];
  constructor(
    readonly provider: ModelProvider,
    readonly model: string,
    steps: [string, Record<string, unknown>?][] = [],
    private readonly failure: LlmFailure | null = null,
    private readonly delayMs = 0,
  ) {
    this.queue = steps.map(([tool, args = {}]) => ({ tool, argsJson: JSON.stringify(args) }));
  }
  async generate<S extends z.ZodType>(req: { schema: S }): Promise<LlmResult<z.infer<S>>> {
    this.calls += 1;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failure) return { ok: false, reason: this.failure };
    const parsed = req.schema.safeParse(this.queue.shift() ?? { tool: "noop", argsJson: "{}" });
    return parsed.success ? { ok: true, value: parsed.data, model: this.model } : { ok: false, reason: "SCHEMA_MISMATCH" };
  }
}

const gemini = (steps: [string, Record<string, unknown>?][] = [], failure: LlmFailure | null = null, delayMs = 0) => new Adapter("gemini", "gemini-3.6-flash", steps, failure, delayMs);
const openRouter = (steps: [string, Record<string, unknown>?][] = [], failure: LlmFailure | null = null) => new Adapter("openrouter", "anthropic/claude-haiku-5.5", steps, failure);

async function scheduled(session: string): Promise<string> {
  const quote = await createQuote(app.deps, session, request({}));
  const offer = quote.offers.find((o) => o.kind === "flex_gentle")!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, session, accepted.reservationId, state, r.paypal_order_id!);
  return accepted.reservationId;
}

async function disturb(eventId: string): Promise<string> {
  const rid = await scheduled(DRIVER);
  await app.db.query("insert into disruption_events (id, event_id, reservation_id, type, params, effective_slot, created_by) values ($1, $2, $3, $4, $5, $6, 'TEST')", [
    `dis_${eventId}`,
    eventId,
    rid,
    "CHARGER_POWER_REDUCTION",
    JSON.stringify({ maxPowerW: 7_200 }),
    EVENING_SLOT,
  ]);
  return rid;
}

const provenance = (run: RecoveryRunView) => runProvenance({ aiUsed: run.aiUsed, trace: run.trace });

describe("which failures switch to OpenRouter", () => {
  it("maps 503 and 504 to UNAVAILABLE and 429 to QUOTA_EXHAUSTED (both transient), and 401/403 to AUTH_FAILED", () => {
    expect(classifyHttpStatus(503)).toBe("UNAVAILABLE");
    expect(classifyHttpStatus(504)).toBe("UNAVAILABLE");
    expect(classifyHttpStatus(429)).toBe("QUOTA_EXHAUSTED");
    expect(classifyHttpStatus(401)).toBe("AUTH_FAILED");
    expect(classifyHttpStatus(403)).toBe("AUTH_FAILED");
  });

  it("Gemini succeeds: OpenRouter is never asked and the run is a GEMINI_MODEL_DECISION", async () => {
    const rid = await disturb("evt_pf_0001");
    const primary = gemini(DECIDING_STEPS);
    const fallback = openRouter(DECIDING_STEPS);
    app.deps.llm = new FailoverLlm(primary, fallback);
    const run = await orchestrateRecovery(app.deps, "evt_pf_0001");
    expect(run.status).toBe("COMMITTED");
    expect(fallback.calls).toBe(0);
    expect(provenance(run)).toMatchObject({ decision: "MODEL_DECISION", decisionCode: "GEMINI_MODEL_DECISION" });
    expect((await getReservation(app.db, rid))!.payment_state).toBe("AUTHORIZED");
  });

  for (const [label, failure] of [
    ["503 (UNAVAILABLE)", "UNAVAILABLE"],
    ["504 (UNAVAILABLE)", "UNAVAILABLE"],
    ["a timeout", "TIMEOUT"],
    ["429 (QUOTA_EXHAUSTED)", "QUOTA_EXHAUSTED"],
  ] as const) {
    it(`Gemini ${label} switches to OpenRouter, which decides through the same validated tools`, async () => {
      await disturb("evt_pf_0002");
      const primary = gemini([], failure, failure === "TIMEOUT" ? 5 : 0);
      const fallback = openRouter(DECIDING_STEPS);
      app.deps.llm = new FailoverLlm(primary, fallback);
      const run = await orchestrateRecovery(app.deps, "evt_pf_0002");
      expect(primary.calls).toBe(1); // then skipped for the cooldown, never retried
      expect(fallback.calls).toBeGreaterThanOrEqual(DECIDING_STEPS.length);
      expect(run.status).toBe("COMMITTED");
      expect(provenance(run)).toMatchObject({ decision: "MODEL_DECISION", decisionCode: "OPENROUTER_MODEL_DECISION" });
    });
  }

  for (const failure of ["AUTH_FAILED", "REFUSED", "INVALID_OUTPUT", "SCHEMA_MISMATCH", "REQUEST_REJECTED"] as const) {
    it(`Gemini ${failure} is not treated as an outage: OpenRouter is not asked and the deterministic path decides`, async () => {
      await disturb("evt_pf_0003");
      const fallback = openRouter(DECIDING_STEPS);
      app.deps.llm = new FailoverLlm(gemini([], failure), fallback);
      const run = await orchestrateRecovery(app.deps, "evt_pf_0003");
      expect(fallback.calls).toBe(0);
      expect(provenance(run)).toMatchObject({ decision: "DETERMINISTIC_FALLBACK", decisionCode: "DETERMINISTIC_FALLBACK", modelLabel: null });
    });
  }

  it("both providers unavailable: labelled DETERMINISTIC_FALLBACK, never an AI decision, and no payment call", async () => {
    await disturb("evt_pf_0004");
    const gatewayBefore = app.gateway.calls.length;
    app.deps.llm = new FailoverLlm(gemini([], "UNAVAILABLE"), openRouter([], "UNAVAILABLE"));
    const run = await orchestrateRecovery(app.deps, "evt_pf_0004");
    expect(["COMMITTED", "NEEDS_APPROVAL", "INFEASIBLE"]).toContain(run.status);
    expect(provenance(run)).toMatchObject({ decision: "DETERMINISTIC_FALLBACK", decisionCode: "DETERMINISTIC_FALLBACK", modelLabel: null });
    expect(run.aiUsed).toBe(false);
    expect(app.gateway.calls.length).toBe(gatewayBefore);
  });
});

describe("shared request budget", () => {
  it(`caps provider requests at ${MAX_MODEL_REQUESTS} per run across Gemini and OpenRouter together`, async () => {
    await disturb("evt_pf_0005");
    const primary = gemini([], "UNAVAILABLE");
    const fallback = openRouter(Array.from({ length: 20 }, () => ["noop"] as [string]));
    app.deps.llm = new FailoverLlm(primary, fallback);
    const run = await orchestrateRecovery(app.deps, "evt_pf_0005");
    expect(primary.calls + fallback.calls).toBe(MAX_MODEL_REQUESTS);
    expect(run.trace.some((t) => t.detail.includes("REQUEST_BUDGET"))).toBe(true);
    expect(["COMMITTED", "NEEDS_APPROVAL", "INFEASIBLE"]).toContain(run.status);
  });

  it("a healthy primary is also capped: no more than the budget even when every step is rejected", async () => {
    await disturb("evt_pf_0006");
    const primary = gemini(Array.from({ length: 20 }, () => ["captureAuthorization"] as [string]));
    app.deps.llm = new FailoverLlm(primary, openRouter());
    const run = await orchestrateRecovery(app.deps, "evt_pf_0006");
    expect(primary.calls).toBe(MAX_MODEL_REQUESTS);
    expect(run.trace.filter((t) => t.actor === "GEMINI" && t.outcome === "REJECTED")).toHaveLength(MAX_MODEL_REQUESTS);
  });
});

describe("no duplicate effects", () => {
  it("running the same disturbance again reuses the run: one run, at most one new version, no payment operation", async () => {
    const rid = await disturb("evt_pf_0007");
    const gatewayBefore = app.gateway.calls.length;
    const primary = gemini([], "UNAVAILABLE");
    const fallback = openRouter([...DECIDING_STEPS, ...DECIDING_STEPS]);
    app.deps.llm = new FailoverLlm(primary, fallback);
    const first = await orchestrateRecovery(app.deps, "evt_pf_0007");
    const callsAfterFirst = primary.calls + fallback.calls;
    const second = await orchestrateRecovery(app.deps, "evt_pf_0007");
    expect(second.runId).toBe(first.runId);
    expect(primary.calls + fallback.calls).toBe(callsAfterFirst);
    const runs = await app.db.query("select id from recovery_runs where disruption_event_id = 'evt_pf_0007'");
    expect(runs).toHaveLength(1);
    const versions = await app.db.query("select version from schedule_versions where reservation_id = $1", [rid]);
    expect(versions.length).toBeLessThanOrEqual(1);
    expect(app.gateway.calls.length).toBe(gatewayBefore);
  });

  it("a resumed run does not ask any model again and is labelled deterministic", async () => {
    await disturb("evt_pf_0008");
    const died = app.clock.now - 120_000;
    await app.db.query(
      `insert into recovery_runs (id, disruption_event_id, status, attempts, lease_until, trace)
       values ('rrun_pf_8', 'evt_pf_0008', 'RUNNING', 1, $1::timestamptz,
         jsonb_build_array(jsonb_build_object('seq', 1, 'at', $1::text, 'tool', 'orchestrator', 'actor', 'DETERMINISTIC', 'input', '{}'::jsonb, 'outcome', 'INFO', 'detail', 'started')))`,
      [new Date(died).toISOString()],
    );
    const primary = gemini(DECIDING_STEPS);
    const fallback = openRouter(DECIDING_STEPS);
    app.deps.llm = new FailoverLlm(primary, fallback);
    const run = await orchestrateRecovery(app.deps, "evt_pf_0008");
    expect(primary.calls + fallback.calls).toBe(0);
    expect(run.trace.some((t) => t.detail === RESUMED_DETERMINISTIC_DETAIL)).toBe(true);
    expect(provenance(run).decisionCode).toBe("DETERMINISTIC_FALLBACK");
  });
});
