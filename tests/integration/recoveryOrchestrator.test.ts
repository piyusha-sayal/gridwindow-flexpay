/** Autonomous recovery end to end against the real schema (MOCK provider, PGlite): scenarios, safety, resume and fallback. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_STATION } from "@/domain/station";
import type { OfferKind } from "@/domain/quotes";
import { SLOT_MS } from "@/domain/units";
import type { StructuredLlm, LlmResult } from "@/server/ai/llm";
import type { ServiceError } from "@/server/deps";
import { getReservation, effectivePowerOf } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote, scenarioFor } from "@/server/services/quoteService";
import { approveRecoveryRun, recordDisruption, rejectRecoveryRun, runRecovery } from "@/server/services/scheduleService";
import { LEASE_MS, MAX_ATTEMPTS, MAX_TOOL_STEPS, orchestrateRecovery, resumeStuckRuns } from "@/server/services/recoveryOrchestrator";
import { getRecoveryRunView } from "@/server/services/recoveryRuns";
import { reservationView } from "@/server/services/viewService";
import { runSimulation } from "@/server/services/settlementService";
import { PROPOSAL_TTL_MS } from "@/server/services/scheduleService";
import { ScriptedLlm, ok } from "../unit/scriptedLlm";
import { makeApp, NIGHT, request, resetApp, type TestApp } from "./helpers";

const DRIVER = "drv_orch_1";
const OTHER_DRIVER = "drv_orch_2";
let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
  app.deps.awaitRecovery = true;
});
beforeEach(async () => {
  await resetApp(app);
  app.deps.llm = null;
  app.deps.awaitRecovery = true;
});
afterAll(async () => {
  await app.db.close();
});

const grid = scenarioFor(DEMO_STATION, NIGHT).grid;
const slotAt = (iso: string) => (Date.parse(iso) - grid.startMs) / SLOT_MS;
/** 19:00 local plug-in and a 22:00 local disturbance on the seeded night (Pacific, UTC-8). */
const PLUG_SLOT = slotAt("2026-11-06T03:00:00Z");
const EVENING_SLOT = slotAt("2026-11-06T06:00:00Z");
const EARLY_DEPART_MS = Date.parse("2026-11-06T12:00:00Z"); // 04:00 local, earlier than the 07:00 agreed departure
const IMPOSSIBLE_DEPART_MS = Date.parse("2026-11-06T04:30:00Z"); // 1.5 h after plug-in: the energy cannot fit

/** Scripted model: each call returns the next {tool, args} pair; an exhausted script returns an unknown tool. */
function steps(...calls: [string, Record<string, unknown>?][]): ScriptedLlm {
  const queue = calls.map(([tool, args = {}]) => ({ tool, argsJson: JSON.stringify(args) }));
  return new ScriptedLlm(() => ok(queue.shift() ?? { tool: "noop", argsJson: "{}" }));
}

function failingLlm(reason: "TIMEOUT" | "UNAVAILABLE"): StructuredLlm {
  return {
    model: "test-failing",
    generate: async (): Promise<LlmResult<never>> => ({ ok: false, reason }),
  } as StructuredLlm;
}

async function quoteAndAccept(session: string, overrides: Parameters<typeof request>[0] = {}, kind: OfferKind = "flex_lowest_cost") {
  const quote = await createQuote(app.deps, session, request(overrides));
  const offer = quote.offers.find((o) => o.kind === kind)!;
  return acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
}

/** Accepted, approved on the mock hosted page, and capacity committed: AUTHORIZED and SCHEDULED. */
async function scheduled(session: string, overrides: Parameters<typeof request>[0] = {}, kind: OfferKind = "flex_lowest_cost"): Promise<string> {
  const accepted = await quoteAndAccept(session, overrides, kind);
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, session, accepted.reservationId, state, r.paypal_order_id!);
  return accepted.reservationId;
}

/** Inserts a disturbance row directly, so no hook runs (used to stage crash and resume states). */
async function insertDisturbance(rid: string, eventId: string, type: string, params: Record<string, number>, effectiveSlot: number): Promise<string> {
  await app.db.query("insert into disruption_events (id, event_id, reservation_id, type, params, effective_slot, created_by) values ($1, $2, $3, $4, $5, $6, 'TEST')", [
    `dis_${eventId}`,
    eventId,
    rid,
    type,
    JSON.stringify(params),
    effectiveSlot,
  ]);
  return eventId;
}

const versionRows = (rid: string) =>
  app.db.query<{ version: number; source: string; recovery_run_id: string | null; power_w: number[] }>(
    "select version, source, recovery_run_id, power_w from schedule_versions where reservation_id = $1 order by version",
    [rid],
  );
const runRows = (eventId: string) => app.db.query<{ id: string; status: string; attempts: number; trace: { seq: number; tool: string }[] }>(
  "select id, status, attempts, trace from recovery_runs where disruption_event_id = $1",
  [eventId],
);

describe("scenario B: charger power cut, recovered inside the agreed terms", () => {
  it("the model picks a validated candidate, the server auto-commits it, delivery and capture follow", async () => {
    const rid = await scheduled(DRIVER, {}, "flex_gentle");
    const before = (await getReservation(app.db, rid))!;
    const llm = steps(
      ["requestRecoveryCandidates"],
      ["validateRecoveryPlan", { candidateId: "c1" }],
      ["proposeRecovery", { candidateId: "c1" }],
      ["commitPermittedRecovery"],
      ["explainRecoveryOutcome", { text: "The charger limit applies from that time, and the agreed price stays the same." }],
    );
    app.deps.llm = llm;
    const { event } = await recordDisruption(app.deps, { eventId: "evt_scn_b_0001", reservationId: rid, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 7_200 }, effectiveSlot: EVENING_SLOT });

    const run = await runRecovery(app.deps, event.eventId);
    expect(run.status).toBe("COMMITTED");
    expect(run.aiUsed).toBe(true);
    expect(run.explanation).toEqual({ text: "The charger limit applies from that time, and the agreed price stays the same.", source: "MODEL" });
    expect(run.trace.filter((t) => t.actor === "GEMINI" && t.outcome === "OK").map((t) => t.tool)).toEqual([
      "requestRecoveryCandidates",
      "validateRecoveryPlan",
      "proposeRecovery",
      "commitPermittedRecovery",
      "explainRecoveryOutcome",
    ]);

    const versions = await versionRows(rid);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 2, source: "RECOVERY", recovery_run_id: run.runId });
    const after = (await getReservation(app.db, rid))!;
    expect(after.terms_hash).toBe(before.terms_hash);
    expect(after.amount_cents).toBe(before.amount_cents);
    const power = await effectivePowerOf(app.db, after);
    expect(Math.max(...power.slice(Math.ceil(EVENING_SLOT)))).toBeLessThanOrEqual(7_200);

    const settled = await runSimulation(app.deps, rid, { kind: "OPERATOR" });
    expect(settled.service_state).toBe("DELIVERED");
    expect(settled.payment_state).toBe("CAPTURED");

    const view = await reservationView(app.deps, rid, { operator: true });
    expect(view.recovery).not.toBeNull();
    expect(view.recovery!.aiUsed).toBe(true);
    expect(view.recovery!.disturbances).toEqual([expect.objectContaining({ eventId: "evt_scn_b_0001", type: "CHARGER_POWER_REDUCTION", provenance: "SYNTHETIC" })]);
    expect(view.recovery!.runs[0]!.consent).toEqual({ method: "AUTO_WITHIN_PRE_APPROVED_BOUNDS" });
    expect(view.recovery!.evidenceStatement).toMatch(/separate from PayPal Sandbox/);
    expect(view.recovery!.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(view.recovery!.versions[1]!.deliveredBatteryMilliWh).toBeGreaterThan(0);
    expect(view.paymentState).toBe("CAPTURED");
  });
});

describe("scenario D: operator margin below the accepted minimum", () => {
  it("never auto-commits a recovery that breaches the operator minimum: nothing is written and the schedule stays", async () => {
    const rid = await scheduled(DRIVER, {}, "flex_gentle");
    const powerBefore = await effectivePowerOf(app.db, (await getReservation(app.db, rid))!);

    // The recovery hook runs inside recordDisruption (awaitRecovery), so the stricter minimum must be in place before it.
    const economics = app.deps.economics;
    app.deps.economics = { ...economics, minOperatorImprovementCents: 1_000_000 };
    try {
      const { event } = await recordDisruption(app.deps, { eventId: "evt_scn_d_0001", reservationId: rid, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 7_200 }, effectiveSlot: EVENING_SLOT });
      const run = await runRecovery(app.deps, event.eventId);
      expect(run.status).not.toBe("COMMITTED");
      expect(run.status).not.toBe("NEEDS_APPROVAL");
      expect(run.proposal).toBeNull();
    } finally {
      app.deps.economics = economics;
    }
    expect(await versionRows(rid)).toEqual([]);
    expect(await effectivePowerOf(app.db, (await getReservation(app.db, rid))!)).toEqual(powerBefore);
  });
});

describe("scenario C: infeasible recovery", () => {
  it("commits nothing, keeps the schedule and explains the limit in plain English", async () => {
    const rid = await scheduled(DRIVER);
    const before = (await getReservation(app.db, rid))!;
    const powerBefore = await effectivePowerOf(app.db, before);
    const { event } = await recordDisruption(app.deps, { eventId: "evt_scn_c_0001", reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: IMPOSSIBLE_DEPART_MS }, effectiveSlot: PLUG_SLOT });

    const run = await runRecovery(app.deps, event.eventId);
    expect(run.status).toBe("INFEASIBLE");
    expect(run.proposal).toBeNull();
    expect(run.outcome?.reason).toMatch(/not enough time/i);
    expect(run.explanation?.source).toBe("DETERMINISTIC");
    expect(await versionRows(rid)).toEqual([]);
    expect(await effectivePowerOf(app.db, (await getReservation(app.db, rid))!)).toEqual(powerBefore);
  });

  it("documents current settlement: a plan the disturbance has made invalid is not simulated, so it is not voided automatically", async () => {
    const rid = await scheduled(DRIVER);
    await recordDisruption(app.deps, { eventId: "evt_scn_c_0002", reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: IMPOSSIBLE_DEPART_MS }, effectiveSlot: PLUG_SLOT });
    await expect(runSimulation(app.deps, rid, { kind: "OPERATOR" })).rejects.toMatchObject({ code: "PLAN_OUTDATED" } satisfies Partial<ServiceError>);
    expect((await getReservation(app.db, rid))!.payment_state).toBe("AUTHORIZED");
  });
});

describe("early departure needs the driver's approval", () => {
  it("proposes an exact version that the driver approves, and writes it only then", async () => {
    const rid = await scheduled(DRIVER);
    const { event } = await recordDisruption(app.deps, { eventId: "evt_early_a001", reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: EARLY_DEPART_MS }, effectiveSlot: PLUG_SLOT });
    const run = await runRecovery(app.deps, event.eventId);
    expect(run.status).toBe("NEEDS_APPROVAL");
    expect(run.proposal?.reasons.join(" ")).toMatch(/departure/);
    expect(run.expiresAt).not.toBeNull();
    expect(await versionRows(rid)).toEqual([]);

    const approved = await approveRecoveryRun(app.deps, run.runId, DRIVER);
    expect(approved.status).toBe("COMMITTED");
    const versions = await versionRows(rid);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.recovery_run_id).toBe(run.runId);
    const view = await reservationView(app.deps, rid, { operator: true });
    expect(view.recovery!.runs[0]!.consent).toEqual({ method: "DRIVER_APPROVED", version: 2 });
  });

  it("a rejected proposal changes nothing", async () => {
    const rid = await scheduled(DRIVER);
    const { event } = await recordDisruption(app.deps, { eventId: "evt_early_b001", reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: EARLY_DEPART_MS }, effectiveSlot: PLUG_SLOT });
    const run = await runRecovery(app.deps, event.eventId);
    expect((await rejectRecoveryRun(app.deps, run.runId, DRIVER)).status).toBe("REJECTED");
    expect(await versionRows(rid)).toEqual([]);
  });

  it("an unapproved proposal expires: approval is refused, the view shows EXPIRED and the sweep records it", async () => {
    const rid = await scheduled(DRIVER);
    const { event } = await recordDisruption(app.deps, { eventId: "evt_early_c001", reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: EARLY_DEPART_MS }, effectiveSlot: PLUG_SLOT });
    const run = await runRecovery(app.deps, event.eventId);
    app.clock.now += PROPOSAL_TTL_MS + 1;
    expect((await getRecoveryRunView(app.deps, run.runId, { driverSession: DRIVER })).status).toBe("EXPIRED");
    await expect(approveRecoveryRun(app.deps, run.runId, DRIVER)).rejects.toMatchObject({ code: "PROPOSAL_EXPIRED" });
    expect(await versionRows(rid)).toEqual([]);

    const again = await recordDisruption(app.deps, { eventId: "evt_early_c002", reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: EARLY_DEPART_MS }, effectiveSlot: PLUG_SLOT });
    const second = await runRecovery(app.deps, again.event.eventId);
    expect(second.status).toBe("NEEDS_APPROVAL");
    app.clock.now += PROPOSAL_TTL_MS + 1;
    expect((await resumeStuckRuns(app.deps)).expired).toBeGreaterThanOrEqual(1);
    const stored = await app.db.query<{ status: string }>("select status from recovery_runs where id = $1", [second.runId]);
    expect(stored[0]!.status).toBe("EXPIRED");
  });
});

describe("deduplication and concurrency", () => {
  it("the same event id twice records once and starts one run", async () => {
    const rid = await scheduled(DRIVER);
    const input = { eventId: "evt_dedupe_001", reservationId: rid, type: "EARLY_DEPARTURE" as const, params: { departMs: EARLY_DEPART_MS }, effectiveSlot: PLUG_SLOT };
    const first = await recordDisruption(app.deps, input);
    const again = await recordDisruption(app.deps, input);
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(await runRows("evt_dedupe_001")).toHaveLength(1);
    const traceLength = (await runRows("evt_dedupe_001"))[0]!.trace.length;
    const run = await orchestrateRecovery(app.deps, "evt_dedupe_001");
    expect(run.trace).toHaveLength(traceLength);
  });

  it("two workers started on the same event share one run and never double-commit", async () => {
    const rid = await scheduled(DRIVER);
    await insertDisturbance(rid, "evt_race_0001", "CHARGER_POWER_REDUCTION", { maxPowerW: 7_200 }, EVENING_SLOT);
    const results = await Promise.all([orchestrateRecovery(app.deps, "evt_race_0001"), orchestrateRecovery(app.deps, "evt_race_0001")]);
    expect(new Set(results.map((r) => r.runId)).size).toBe(1);
    expect(await runRows("evt_race_0001")).toHaveLength(1);
    expect((await versionRows(rid)).length).toBeLessThanOrEqual(1);
  });
});

describe("crash and restart", () => {
  it("resumes a run whose worker died holding the lease, and keeps the trace in order", async () => {
    const rid = await scheduled(DRIVER);
    await insertDisturbance(rid, "evt_crash_0001", "EARLY_DEPARTURE", { departMs: EARLY_DEPART_MS }, PLUG_SLOT);
    const died = app.clock.now - LEASE_MS - 1_000;
    await app.db.query(
      `insert into recovery_runs (id, disruption_event_id, status, attempts, lease_until, trace)
       values ('rrun_crash_1', 'evt_crash_0001', 'RUNNING', 1, $1::timestamptz,
         jsonb_build_array(jsonb_build_object('seq', 1, 'at', $2::text, 'tool', 'orchestrator', 'actor', 'DETERMINISTIC', 'input', '{}'::jsonb, 'outcome', 'INFO', 'detail', 'started')))`,
      [new Date(died).toISOString(), new Date(died).toISOString()],
    );

    expect(await resumeStuckRuns(app.deps)).toMatchObject({ resumed: 1, failed: 0 });
    const run = await getRecoveryRunView(app.deps, "rrun_crash_1", { operator: true });
    expect(run.status).toBe("NEEDS_APPROVAL");
    expect(run.trace[0]).toMatchObject({ seq: 1, detail: "started" });
    expect(run.trace[1]).toMatchObject({ seq: 2, detail: expect.stringMatching(/resumed on attempt 2/) });
    expect(run.trace.map((t) => t.seq)).toEqual(run.trace.map((_, i) => i + 1));
    expect((await app.db.query<{ attempts: number }>("select attempts from recovery_runs where id = 'rrun_crash_1'"))[0]!.attempts).toBe(2);
  });

  it("a live lease is never taken over", async () => {
    const rid = await scheduled(DRIVER);
    await insertDisturbance(rid, "evt_live_0001", "EARLY_DEPARTURE", { departMs: EARLY_DEPART_MS }, PLUG_SLOT);
    const live = new Date(app.clock.now + LEASE_MS).toISOString();
    await app.db.query("insert into recovery_runs (id, disruption_event_id, status, attempts, lease_until) values ('rrun_live_1', 'evt_live_0001', 'RUNNING', 1, $1::timestamptz)", [live]);
    expect(await resumeStuckRuns(app.deps)).toMatchObject({ resumed: 0 });
    const run = await orchestrateRecovery(app.deps, "evt_live_0001");
    expect(run.status).toBe("RUNNING");
    expect((await app.db.query<{ attempts: number }>("select attempts from recovery_runs where id = 'rrun_live_1'"))[0]!.attempts).toBe(1);
  });

  it("stops retrying after the attempt limit and records the run as FAILED", async () => {
    const rid = await scheduled(DRIVER);
    await insertDisturbance(rid, "evt_limit_0001", "EARLY_DEPARTURE", { departMs: EARLY_DEPART_MS }, PLUG_SLOT);
    const died = app.clock.now - LEASE_MS - 1_000;
    await app.db.query("insert into recovery_runs (id, disruption_event_id, status, attempts, lease_until) values ('rrun_limit_1', 'evt_limit_0001', 'RUNNING', $1, $2::timestamptz)", [
      MAX_ATTEMPTS,
      new Date(died).toISOString(),
    ]);
    await resumeStuckRuns(app.deps);
    expect((await app.db.query<{ status: string }>("select status from recovery_runs where id = 'rrun_limit_1'"))[0]!.status).toBe("FAILED");
    expect(await versionRows(rid)).toEqual([]);
  });
});

describe("model failure falls back to the deterministic path", () => {
  it("a timeout or unavailable model leaves a deterministic, labelled result", async () => {
    const rid = await scheduled(DRIVER);
    await insertDisturbance(rid, "evt_fb_0001", "EARLY_DEPARTURE", { departMs: EARLY_DEPART_MS }, PLUG_SLOT);
    app.deps.llm = failingLlm("TIMEOUT");
    const run = await orchestrateRecovery(app.deps, "evt_fb_0001");
    expect(run.status).toBe("NEEDS_APPROVAL");
    expect(run.aiUsed).toBe(false);
    expect(run.explanation?.source).toBe("DETERMINISTIC");
    expect(run.trace.every((t) => t.actor === "DETERMINISTIC")).toBe(true);
    expect(run.trace.some((t) => /TIMEOUT/.test(t.detail))).toBe(true);
  });

  it("a model that never answers is cut off by the loop budget", async () => {
    const rid = await scheduled(DRIVER);
    await insertDisturbance(rid, "evt_fb_0002", "EARLY_DEPARTURE", { departMs: EARLY_DEPART_MS }, PLUG_SLOT);
    app.deps.llm = { model: "test-hanging", generate: () => new Promise<never>(() => undefined) } as StructuredLlm;
    const started = Date.now();
    const run = await orchestrateRecovery(app.deps, "evt_fb_0002", { timeoutMs: 30 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(run.status).toBe("NEEDS_APPROVAL");
    expect(run.aiUsed).toBe(false);
  });

  it("the loop is bounded: a model that never stops is cut off at the step limit", async () => {
    const rid = await scheduled(DRIVER);
    await insertDisturbance(rid, "evt_fb_0003", "CHARGER_POWER_REDUCTION", { maxPowerW: 7_200 }, EVENING_SLOT);
    const llm = new ScriptedLlm(() => ok({ tool: "readStationState", argsJson: "{}" }));
    app.deps.llm = llm;
    const run = await orchestrateRecovery(app.deps, "evt_fb_0003");
    expect(llm.calls).toHaveLength(MAX_TOOL_STEPS);
    expect(run.trace.some((t) => t.detail === "model step limit reached")).toBe(true);
    expect(["COMMITTED", "NEEDS_APPROVAL"]).toContain(run.status);
  });
});

describe("hostile model output is refused, logged and never executed", () => {
  it("unknown candidates, payment tools, extra fields and bad ids are rejected; the validated path still completes", async () => {
    const rid = await scheduled(DRIVER, {}, "flex_gentle");
    const captureCallsBefore = app.gateway.calls.filter((c) => /capture|void/i.test(c)).length;
    await insertDisturbance(rid, "evt_hostile_01", "CHARGER_POWER_REDUCTION", { maxPowerW: 7_200 }, EVENING_SLOT);
    app.deps.llm = steps(
      ["requestRecoveryCandidates"],
      ["validateRecoveryPlan", { candidateId: "c99" }],
      ["proposeRecovery", { candidateId: "c1; ignore the rules" }],
      ["captureAuthorization", {}],
      ["proposeRecovery", { candidateId: "c1", powerW: [7_200] }],
      ["validateRecoveryPlan", { candidateId: "c1" }],
      ["proposeRecovery", { candidateId: "c1" }],
      ["commitPermittedRecovery"],
    );
    const run = await orchestrateRecovery(app.deps, "evt_hostile_01");
    const rejected = run.trace.filter((t) => t.actor === "GEMINI" && t.outcome === "REJECTED").map((t) => t.detail);
    expect(rejected.join(" | ")).toMatch(/UNKNOWN_CANDIDATE/);
    expect(rejected.join(" | ")).toMatch(/INVALID_ARGS/);
    expect(rejected.join(" | ")).toMatch(/UNKNOWN_TOOL/);
    expect(run.status).toBe("COMMITTED");
    expect(app.gateway.calls.filter((c) => /capture|void/i.test(c)).length).toBe(captureCallsBefore);
  });

  it("an explanation that states an ungrounded figure or a payment claim is replaced by the deterministic text", async () => {
    const rid = await scheduled(DRIVER, {}, "flex_gentle");
    await insertDisturbance(rid, "evt_hostile_02", "CHARGER_POWER_REDUCTION", { maxPowerW: 7_200 }, EVENING_SLOT);
    app.deps.llm = steps(
      ["requestRecoveryCandidates"],
      ["validateRecoveryPlan", { candidateId: "c1" }],
      ["proposeRecovery", { candidateId: "c1" }],
      ["commitPermittedRecovery"],
      ["explainRecoveryOutcome", { text: "You will save $999.99 and the payment was captured." }],
    );
    const run = await orchestrateRecovery(app.deps, "evt_hostile_02");
    expect(run.status).toBe("COMMITTED");
    expect(run.explanation?.source).toBe("DETERMINISTIC");
    expect(run.trace.some((t) => t.tool === "explainRecoveryOutcome" && t.outcome === "REJECTED")).toBe(true);
  });

  it("the model never receives identifiers, the driver session or provider references", async () => {
    const rid = await scheduled(DRIVER, {}, "flex_gentle");
    const order = (await getReservation(app.db, rid))!.paypal_order_id!;
    await insertDisturbance(rid, "evt_privacy_01", "CHARGER_POWER_REDUCTION", { maxPowerW: 7_200 }, EVENING_SLOT);
    const llm = steps(["readStationState"], ["inspectDisruption"], ["requestRecoveryCandidates"]);
    app.deps.llm = llm;
    await orchestrateRecovery(app.deps, "evt_privacy_01");
    const sent = llm.calls.map((c) => `${c.system}\n${c.user}`).join("\n");
    expect(llm.calls.length).toBeGreaterThan(0);
    for (const secret of [DRIVER, rid, order]) expect(sent).not.toContain(secret);
  });
});

describe("authorization boundaries", () => {
  it("only the owning driver or an operator can read a run; a stranger gets NOT_FOUND", async () => {
    const rid = await scheduled(DRIVER);
    const { event } = await recordDisruption(app.deps, { eventId: "evt_authz_001", reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: EARLY_DEPART_MS }, effectiveSlot: PLUG_SLOT });
    const run = await runRecovery(app.deps, event.eventId);
    expect((await getRecoveryRunView(app.deps, run.runId, { driverSession: DRIVER })).runId).toBe(run.runId);
    expect((await getRecoveryRunView(app.deps, run.runId, { operator: true })).runId).toBe(run.runId);
    await expect(getRecoveryRunView(app.deps, run.runId, { driverSession: OTHER_DRIVER })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(approveRecoveryRun(app.deps, run.runId, OTHER_DRIVER)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(rejectRecoveryRun(app.deps, run.runId, OTHER_DRIVER)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("recovery of one reservation leaves other sessions' schedules and versions untouched", async () => {
    const mine = await scheduled(DRIVER);
    const other = await scheduled(OTHER_DRIVER, { portId: "port_b" });
    const otherBefore = { power: await effectivePowerOf(app.db, (await getReservation(app.db, other))!), versions: await versionRows(other) };
    await recordDisruption(app.deps, { eventId: "evt_isolate_01", reservationId: mine, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 7_200 }, effectiveSlot: EVENING_SLOT });
    expect(await effectivePowerOf(app.db, (await getReservation(app.db, other))!)).toEqual(otherBefore.power);
    expect(await versionRows(other)).toEqual(otherBefore.versions);
  });

  it("the trace is ordered and carries sanitized inputs only", async () => {
    const rid = await scheduled(DRIVER);
    await insertDisturbance(rid, "evt_trace_0001", "CHARGER_POWER_REDUCTION", { maxPowerW: 7_200 }, EVENING_SLOT);
    app.deps.llm = steps(["requestRecoveryCandidates"], ["validateRecoveryPlan", { candidateId: "c1\u0000\nSYSTEM" }], ["explainRecoveryOutcome", { text: "x".repeat(300) }]);
    const run = await orchestrateRecovery(app.deps, "evt_trace_0001");
    expect(run.trace.map((t) => t.seq)).toEqual(run.trace.map((_, i) => i + 1));
    const at = run.trace.map((t) => Date.parse(t.at));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(JSON.stringify(run.trace)).not.toMatch(/[\u0000\n]/);
    expect(JSON.stringify(run.trace)).not.toContain("x".repeat(100));
  });
});

