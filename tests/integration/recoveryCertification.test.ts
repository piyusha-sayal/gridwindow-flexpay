/**
 * Recovery-engine certification (isolated, deterministic, MOCK payments, no model, no Neon).
 * Every case enters through the supported workflow (recordDisruption -> recovery hook -> orchestrator) on a fresh
 * in-memory PGlite database, then asserts persisted rows, not console output. Set CERT_EVIDENCE=1 to write the
 * sanitized evidence file under docs/evidence/recovery-engine/.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_STATION } from "@/domain/station";
import { effectiveDepartMs, validateWithEnvelope } from "@/domain/disturbance";
import { SLOT_MS } from "@/domain/units";
import { slotStartMs } from "@/domain/time";
import { committedPlans, effectivePowerOf, getReservation, planOf } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote, scenarioFor } from "@/server/services/quoteService";
import { approveRecoveryRun, commitScheduleVersion, nightContext, recordDisruption, runRecovery } from "@/server/services/scheduleService";
import { orchestrateRecovery } from "@/server/services/recoveryOrchestrator";
import { resolveOutdatedSession } from "@/server/services/outdatedSessionService";
import { reservationView } from "@/server/services/viewService";
import { ScriptedLlm, ok } from "../unit/scriptedLlm";
import { makeApp, NIGHT, request, resetApp, type TestApp } from "./helpers";

const DRIVER = "drv_cert_1";
const OTHER_DRIVER = "drv_cert_2";
let app: TestApp;
const evidence: Record<string, unknown> = {};

beforeAll(async () => {
  app = await makeApp();
});
beforeEach(async () => {
  await resetApp(app);
  app.deps.llm = null;
  app.deps.awaitRecovery = true;
});
afterAll(async () => {
  if (process.env.CERT_EVIDENCE === "1") {
    const dir = path.join(process.cwd(), "docs", "evidence", "recovery-engine");
    await mkdir(dir, { recursive: true });
    const body = {
      generatedBy: "tests/integration/recoveryCertification.test.ts",
      environment: { database: "embedded PGlite, in-memory, created by this run", neon: "not contacted", gemini: "0 calls (no model configured)", payments: "MOCK gateway only", databaseUrlSet: Boolean(process.env.DATABASE_URL) },
      provenance: "Charging data, disturbances and savings are SYNTHETIC. No PayPal Sandbox or live call was made by this suite.",
      cases: evidence,
    };
    await writeFile(path.join(dir, "recovery-engine-certification.json"), JSON.stringify(body, null, 2) + "\n", "utf8");
  }
  await app.db.close();
});

const grid = scenarioFor(DEMO_STATION, NIGHT).grid;
const slotAt = (iso: string) => (Date.parse(iso) - grid.startMs) / SLOT_MS;
const PLUG_SLOT = slotAt("2026-11-06T03:00:00Z"); // 19:00 local
const EVENING_SLOT = slotAt("2026-11-06T06:00:00Z"); // 22:00 local
const EARLY_DEPART_MS = Date.parse("2026-11-06T12:00:00Z"); // 04:00 local, earlier than the agreed 07:00
const AFTER_DEPART_SLOT = slotAt("2026-11-06T15:30:00Z"); // 07:30 local, after the agreed 07:00 departure

async function scheduled(session: string, kind: "flex_gentle" | "flex_lowest_cost" = "flex_gentle"): Promise<string> {
  const quote = await createQuote(app.deps, session, request());
  const offer = quote.offers.find((o) => o.kind === kind)!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, session, accepted.reservationId, state, r.paypal_order_id!);
  return accepted.reservationId;
}

const count = async (sql: string, params: unknown[] = []) => Number((await app.db.query<{ n: string | number }>(sql, params))[0]!.n);
const versions = (rid: string) => app.db.query<{ version: number; source: string; recovery_run_id: string | null; power_w: number[] }>("select version, source, recovery_run_id, power_w from schedule_versions where reservation_id = $1 order by version", [rid]);
const eventTypes = async (rid: string) => (await app.db.query<{ type: string }>("select type from events where reservation_id = $1 order by id", [rid])).map((e) => e.type);

/** Re-validates the current stored schedule with the independent domain validator under the recorded disturbance envelope. */
async function violationsOf(rid: string) {
  const r = (await getReservation(app.db, rid))!;
  const { scenario, envelope } = await nightContext(app.db, app.deps.station, r.night_of);
  const power = await effectivePowerOf(app.db, r);
  const others = await committedPlans(app.db, app.deps.station.id, r.night_of, r.id);
  const own = { ...planOf(r, power), departMs: effectiveDepartMs(envelope, r.id, r.terms.departMs) };
  return validateWithEnvelope({
    station: app.deps.station,
    grid: scenario.grid,
    forecastBaseLoadW: scenario.forecastBaseLoadW,
    envelope,
    plans: [...others, own],
    targets: [{ sessionId: r.id, targetBatteryWh: r.terms.targetBatteryWh, efficiencyBp: r.terms.efficiencyBp }],
  });
}

describe("A: feasible disruption, deterministic recovery through the supported workflow", () => {
  it("records the event, runs the engine, validates, commits version 2 inside the agreed terms, and replays to no change", async () => {
    const rid = await scheduled(DRIVER);
    const before = (await getReservation(app.db, rid))!;
    const originalPower = [...(await effectivePowerOf(app.db, before))];
    expect(before.payment_state).toBe("AUTHORIZED");
    expect(before.service_state).toBe("SCHEDULED");
    expect(before.slots_committed).toBe(true);
    expect(await versions(rid)).toEqual([]);
    expect(await count("select count(*) as n from recovery_runs")).toBe(0);
    const callsBefore = [...app.gateway.calls];

    const { event, created } = await recordDisruption(app.deps, { eventId: "evt_cert_a_0001", reservationId: rid, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 7_200 }, effectiveSlot: EVENING_SLOT });
    expect(created).toBe(true);

    // Persisted disturbance and run (the hook created the run; nothing was inserted by hand).
    const dis = await app.db.query<{ event_id: string; reservation_id: string; type: string; effective_slot: number; created_by: string }>("select event_id, reservation_id, type, effective_slot, created_by from disruption_events");
    expect(dis).toEqual([expect.objectContaining({ event_id: "evt_cert_a_0001", reservation_id: rid, type: "CHARGER_POWER_REDUCTION", effective_slot: EVENING_SLOT, created_by: "OPERATOR" })]);
    const runs = await app.db.query<{ id: string; disruption_event_id: string; status: string; attempts: number; trace: { tool: string; actor: string; outcome: string }[] }>("select id, disruption_event_id, status, attempts, trace from recovery_runs");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ disruption_event_id: "evt_cert_a_0001", status: "COMMITTED", attempts: 1 });

    // Deterministic provenance: no model actor anywhere, the documented tool order, truthful flags.
    const trace = runs[0]!.trace;
    expect(trace.every((t) => t.actor === "DETERMINISTIC")).toBe(true);
    const okTools = trace.filter((t) => t.outcome === "OK").map((t) => t.tool);
    expect(okTools[0]).toBe("requestRecoveryCandidates");
    expect(okTools.slice(-2)).toEqual(["proposeRecovery", "commitPermittedRecovery"]);
    const middle = okTools.slice(1, -2);
    expect(middle.length).toBeGreaterThan(0);
    expect(middle.every((t) => t === "validateRecoveryPlan")).toBe(true);
    const run = await runRecovery(app.deps, event.eventId);
    expect(run.aiUsed).toBe(false);
    expect(run.explanation?.source).toBe("DETERMINISTIC");
    const proposed = run.outcome!.candidates.filter((c) => c.status === "PROPOSED");
    expect(proposed.length).toBeGreaterThan(0);
    expect(proposed.filter((c) => c.chosen)).toHaveLength(1);
    expect(proposed.find((c) => c.chosen)!.consent).toBe("AUTO_COMMIT");

    // Schedule versioning: the original plan is the reservation's agreed plan and never changes; version 2 is appended.
    const after = (await getReservation(app.db, rid))!;
    expect(after.terms_hash).toBe(before.terms_hash);
    expect(after.terms.powerW).toEqual(before.terms.powerW);
    expect(after.amount_cents).toBe(before.amount_cents);
    const v = await versions(rid);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ version: 2, source: "RECOVERY", recovery_run_id: run.runId });
    expect(v[0]!.power_w.slice(0, Math.floor(EVENING_SLOT))).toEqual(originalPower.slice(0, Math.floor(EVENING_SLOT)));

    // Physical feasibility, independent of the engine's own check.
    const power = await effectivePowerOf(app.db, after);
    expect(await violationsOf(rid)).toEqual([]);
    expect(Math.max(...power.slice(Math.ceil(EVENING_SLOT)))).toBeLessThanOrEqual(7_200);
    expect(Math.max(...power)).toBeLessThanOrEqual(DEMO_STATION.ports.find((p) => p.id === after.port_id)!.maxPowerW);
    const depart = after.terms.departMs;
    power.forEach((w, i) => {
      if (w > 0) expect(slotStartMs(grid, i) + SLOT_MS).toBeLessThanOrEqual(depart);
    });
    // Financial guardrails: agreed amount unchanged and inside the driver's spend cap.
    expect(after.amount_cents).toBeLessThanOrEqual(2_500);
    expect(run.outcome!.candidates.every((c) => c.priceCents === null || c.priceCents <= 2_500)).toBe(true);

    // Audit trail links disturbance -> run -> committed version.
    const types = await eventTypes(rid);
    expect(types).toContain("DISRUPTION_RECORDED");
    const committed = await app.db.query<{ payload: { version: number; source: string; runId: string } }>("select payload from events where reservation_id = $1 and type = 'SCHEDULE_VERSION_COMMITTED'", [rid]);
    expect(committed).toHaveLength(1);
    expect(committed[0]!.payload).toMatchObject({ version: 2, source: "RECOVERY", runId: run.runId });
    expect(run.outcome!.versionCommitted).toBe(2);

    // No payment gateway call from disruption through commit.
    expect(app.gateway.calls).toEqual(callsBefore);
    expect(after.payment_state).toBe("AUTHORIZED");

    // C: replay. Same event again, and a second orchestrator pass, change nothing.
    const counts = async () => ({
      versions: (await versions(rid)).length,
      runs: await count("select count(*) as n from recovery_runs"),
      disruptions: await count("select count(*) as n from disruption_events"),
      events: (await eventTypes(rid)).length,
      operations: await count("select count(*) as n from payment_operations"),
    });
    const c1 = await counts();
    const again = await recordDisruption(app.deps, { eventId: "evt_cert_a_0001", reservationId: rid, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 7_200 }, effectiveSlot: EVENING_SLOT });
    expect(again.created).toBe(false);
    const replayRun = await orchestrateRecovery(app.deps, "evt_cert_a_0001");
    expect(replayRun.runId).toBe(run.runId);
    expect(replayRun.trace).toHaveLength(run.trace.length);
    expect(await counts()).toEqual(c1);
    expect(app.gateway.calls).toEqual(callsBefore);

    const view = await reservationView(app.deps, rid, { operator: true });
    expect(view.recovery!.versions.map((x) => x.version)).toEqual([1, 2]);
    expect(view.recovery!.disturbances).toEqual([expect.objectContaining({ eventId: "evt_cert_a_0001", provenance: "SYNTHETIC" })]);

    evidence.A_feasible_and_replay = {
      runStatus: runs[0]!.status,
      toolOrder: okTools,
      actors: [...new Set(trace.map((t) => t.actor))],
      candidates: run.outcome!.candidates.map((c) => ({ preference: c.preference, status: c.status, consent: c.consent, chosen: c.chosen, reason: c.reason })),
      versionsAfter: v.map((x) => ({ version: x.version, source: x.source, linkedToRun: x.recovery_run_id === run.runId })),
      maxPowerAfterEffectiveSlotW: Math.max(...power.slice(Math.ceil(EVENING_SLOT))),
      validatorViolations: 0,
      termsHashUnchanged: true,
      amountCents: after.amount_cents,
      spendCapCents: 2_500,
      gatewayCallsDuringRecovery: 0,
      replayChanged: false,
      countsAfterReplay: c1,
    };
  });
});

describe("B: no feasible alternative, documented fallback", () => {
  async function infeasible(eventId: string, attribution?: "OPERATOR") {
    const rid = await scheduled(DRIVER);
    const before = (await getReservation(app.db, rid))!;
    const powerBefore = [...(await effectivePowerOf(app.db, before))];
    const callsBefore = [...app.gateway.calls];
    const { event } = await recordDisruption(app.deps, { eventId, reservationId: rid, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 1_000 }, effectiveSlot: PLUG_SLOT, ...(attribution ? { attribution } : {}) });
    const run = await runRecovery(app.deps, event.eventId);
    expect(run.status).toBe("INFEASIBLE");
    expect(run.proposal).toBeNull();
    expect(run.explanation?.source).toBe("DETERMINISTIC");
    expect(run.outcome!.candidates.every((c) => c.status === "REJECTED")).toBe(true);
    expect(await versions(rid)).toEqual([]);
    expect(await effectivePowerOf(app.db, (await getReservation(app.db, rid))!)).toEqual(powerBefore);
    expect(app.gateway.calls).toEqual(callsBefore);
    return { rid, run };
  }

  it("unattributed (UNKNOWN) failure: INFEASIBLE writes nothing and the policy escalates to the operator; no money moves", async () => {
    const { rid, run } = await infeasible("evt_cert_b_0001");
    expect(await resolveOutdatedSession(app.deps, rid)).toBe("OPERATOR_RESOLUTION");
    const r = (await getReservation(app.db, rid))!;
    expect(r.payment_state).toBe("AUTHORIZED");
    expect(await count("select count(*) as n from payment_operations where reservation_id = $1 and kind in ('CAPTURE', 'VOID')", [rid])).toBe(0);
    expect(await eventTypes(rid)).toContain("OPERATOR_RESOLUTION_REQUIRED");
    await resolveOutdatedSession(app.deps, rid);
    expect(await count("select count(*) as n from events where reservation_id = $1 and type = 'OPERATOR_RESOLUTION_REQUIRED'", [rid])).toBe(1);
    evidence.B1_infeasible_unknown_attribution = {
      runStatus: run.status,
      rejections: run.outcome!.candidates.map((c) => ({ preference: c.preference, status: c.status, reason: c.reason })),
      scheduleVersionsWritten: 0,
      settlement: "OPERATOR_RESOLUTION (policy: UNKNOWN attribution never auto-voids and never captures)",
      paymentState: r.payment_state,
      paymentWrites: 0,
      gatewayCallsDuringRecovery: 0,
    };
  });

  it("confirmed OPERATOR failure with no feasible plan: the documented full void runs once through the MOCK gateway", async () => {
    const { rid, run } = await infeasible("evt_cert_b_0002", "OPERATOR");
    const callsAfterRecovery = [...app.gateway.calls];
    expect(await resolveOutdatedSession(app.deps, rid)).toBe("VOIDED");
    const r = (await getReservation(app.db, rid))!;
    expect(r.payment_state).toBe("VOIDED");
    expect(r.service_state).toBe("FAILED");
    expect(await count("select count(*) as n from payment_operations where reservation_id = $1 and kind = 'VOID'", [rid])).toBe(1);
    expect(await count("select count(*) as n from payment_operations where reservation_id = $1 and kind = 'CAPTURE'", [rid])).toBe(0);
    const types = await eventTypes(rid);
    expect(types).toEqual(expect.arrayContaining(["DISRUPTION_RECORDED", "OUTDATED_VOID_DECIDED", "SERVICE_FAILED"]));
    await resolveOutdatedSession(app.deps, rid);
    expect(await count("select count(*) as n from payment_operations where reservation_id = $1 and kind = 'VOID'", [rid])).toBe(1);
    evidence.B2_infeasible_operator_confirmed = {
      runStatus: run.status,
      scheduleVersionsWritten: 0,
      gatewayCallsDuringRecovery: 0,
      gatewayCallsAfterSettlement: app.gateway.calls.length - callsAfterRecovery.length,
      settlement: { result: "VOIDED via MOCK gateway", voidOperations: 1, captureOperations: 0, replayAddedOperations: 0, events: types },
      note: "The void is a MOCK gateway operation. A PayPal Sandbox void was shown separately in docs/evidence/paypal-recovery/.",
    };
  });
});

describe("D: consent boundary", () => {
  it("an early departure is proposed, never silently committed, and only the owning driver's approval writes it", async () => {
    const rid = await scheduled(DRIVER, "flex_lowest_cost");
    const callsBefore = [...app.gateway.calls];
    const { event } = await recordDisruption(app.deps, { eventId: "evt_cert_d_0001", reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: EARLY_DEPART_MS }, effectiveSlot: PLUG_SLOT });
    const run = await runRecovery(app.deps, event.eventId);
    expect(run.status).toBe("NEEDS_APPROVAL");
    expect(run.proposal).not.toBeNull();
    expect(run.outcome!.candidates.find((c) => c.chosen)!.consent).not.toBe("AUTO_COMMIT");
    expect(await versions(rid)).toEqual([]);
    expect(await count("select count(*) as n from events where reservation_id = $1 and type = 'SCHEDULE_VERSION_COMMITTED'", [rid])).toBe(0);

    await expect(approveRecoveryRun(app.deps, run.runId, OTHER_DRIVER)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await versions(rid)).toEqual([]);

    const approved = await approveRecoveryRun(app.deps, run.runId, DRIVER);
    expect(approved.status).toBe("COMMITTED");
    const v = await versions(rid);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ version: 2, source: "RECOVERY", recovery_run_id: run.runId });
    expect(await violationsOf(rid)).toEqual([]);
    const view = await reservationView(app.deps, rid, { operator: true });
    expect(view.recovery!.runs[0]!.consent).toEqual({ method: "DRIVER_APPROVED", version: 2 });
    await expect(approveRecoveryRun(app.deps, run.runId, DRIVER)).rejects.toMatchObject({ code: "NOT_PENDING" });
    expect(await versions(rid)).toHaveLength(1);
    expect(app.gateway.calls).toEqual(callsBefore);

    evidence.D_consent_boundary = {
      statusBeforeApproval: run.status,
      versionsBeforeApproval: 0,
      wrongDriverApproval: "refused (NOT_FOUND), nothing written",
      statusAfterOwnerApproval: approved.status,
      versionsAfterApproval: v.map((x) => ({ version: x.version, source: x.source })),
      consentRecorded: "DRIVER_APPROVED",
      secondApprovalRefused: true,
      gatewayCallsDuringRecovery: 0,
    };
  });
});

describe("E: adversarial and financially unauthorized candidates", () => {
  it("the commit gate refuses a plan above the port limit, a plan that misses the target, and charging after departure", async () => {
    const rid = await scheduled(DRIVER);
    const r = (await getReservation(app.db, rid))!;
    const original = [...(await effectivePowerOf(app.db, r))];
    const fromEvening = Math.ceil(EVENING_SLOT);
    const overPort = original.map((w, i) => (i === fromEvening + 1 ? 20_000 : w));
    const missesTarget = original.map(() => 0);
    const afterDeparture = original.map((w, i) => (i === Math.floor(AFTER_DEPART_SLOT) ? 3_000 : w));
    const results: Record<string, string> = {};
    for (const [name, plan, from] of [["ABOVE_PORT_LIMIT", overPort, fromEvening], ["MISSES_TARGET_ENERGY", missesTarget, 0], ["CHARGES_AFTER_DEPARTURE", afterDeparture, fromEvening]] as const) {
      await expect(commitScheduleVersion(app.deps, rid, 1, plan, `adversarial ${name}`, null, from)).rejects.toMatchObject({ code: "PLAN_INVALID" });
      results[name] = "PLAN_INVALID";
    }
    expect(await versions(rid)).toEqual([]);
    expect(await effectivePowerOf(app.db, (await getReservation(app.db, rid))!)).toEqual(original);

    evidence.E_adversarial_plans = { results, scheduleVersionsWritten: 0, scheduleUnchanged: true };
  });

  it("a hostile model (payment tool, commit before validate, unknown tool) is refused and logged; the deterministic path decides; no gateway call", async () => {
    const rid = await scheduled(DRIVER);
    const callsBefore = [...app.gateway.calls];
    const queue = [
      { tool: "capturePayment", argsJson: "{}" },
      { tool: "commitPermittedRecovery", argsJson: "{}" },
      { tool: "proposeRecovery", argsJson: JSON.stringify({ candidateId: "c999" }) },
    ];
    app.deps.llm = new ScriptedLlm(() => ok(queue.shift() ?? { tool: "noop", argsJson: "{}" }));
    const { event } = await recordDisruption(app.deps, { eventId: "evt_cert_e_0002", reservationId: rid, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 7_200 }, effectiveSlot: EVENING_SLOT });
    const run = await runRecovery(app.deps, event.eventId);
    expect(run.status).toBe("COMMITTED");
    expect(run.aiUsed).toBe(false);
    const geminiOk = run.trace.filter((t) => t.actor === "GEMINI" && t.outcome === "OK");
    expect(geminiOk).toEqual([]);
    const rejected = run.trace.filter((t) => t.actor === "GEMINI" && t.outcome === "REJECTED").map((t) => t.tool);
    expect(rejected.length).toBeGreaterThanOrEqual(2);
    expect(run.trace.filter((t) => t.tool === "commitPermittedRecovery" && t.outcome === "OK").every((t) => t.actor === "DETERMINISTIC")).toBe(true);
    expect(await violationsOf(rid)).toEqual([]);
    expect(app.gateway.calls).toEqual(callsBefore);
    expect(await count("select count(*) as n from payment_operations where kind in ('CAPTURE', 'VOID') and reservation_id = $1", [rid])).toBe(0);

    evidence.E_hostile_model = { rejectedModelCalls: rejected, modelDecisionsAccepted: 0, finalDecisionActor: "DETERMINISTIC", runStatus: run.status, aiUsed: run.aiUsed, gatewayCallsDuringRecovery: 0 };
  });

  it("an operator margin below the accepted minimum stops recovery: no proposal, no version", async () => {
    const rid = await scheduled(DRIVER);
    const economics = app.deps.economics;
    app.deps.economics = { ...economics, minOperatorImprovementCents: 1_000_000 };
    try {
      const { event } = await recordDisruption(app.deps, { eventId: "evt_cert_e_0003", reservationId: rid, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 7_200 }, effectiveSlot: EVENING_SLOT });
      const run = await runRecovery(app.deps, event.eventId);
      expect(["INFEASIBLE", "FAILED"]).toContain(run.status);
      expect(run.proposal).toBeNull();
      expect(await versions(rid)).toEqual([]);
      evidence.E_economics_gate = { minOperatorImprovementCents: 1_000_000, runStatus: run.status, candidates: run.outcome?.candidates.map((c) => ({ preference: c.preference, status: c.status, reason: c.reason })) ?? [], scheduleVersionsWritten: 0 };
    } finally {
      app.deps.economics = economics;
    }
  });
});
