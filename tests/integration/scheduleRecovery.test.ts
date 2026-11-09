/** Committed schedules, disturbances and deterministic recovery against the real schema (MOCK provider). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PROPOSAL_TTL_MS } from "@/server/services/scheduleService";
import type { ServiceError } from "@/server/deps";
import { getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { approveRecoveryRun, commitScheduleVersion, recordDisruption, rejectRecoveryRun, runRecovery } from "@/server/services/scheduleService";
import { scheduleView, driverScheduleView } from "@/server/services/scheduleView";
import { runSimulation } from "@/server/services/settlementService";
import { makeApp, request, resetApp, type TestApp } from "./helpers";

const DRIVER = "drv_sched_1";
const OTHER_DRIVER = "drv_sched_2";
let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
  app.deps.awaitRecovery = true;
});
beforeEach(async () => {
  await resetApp(app);
});
afterAll(async () => {
  await app.db.close();
});

async function quoteAndAccept(session: string, overrides: Parameters<typeof request>[0] = {}) {
  const quote = await createQuote(app.deps, session, request(overrides));
  const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost")!;
  return acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
}

/** Accepted, approved on the mock hosted page, and capacity committed: the session is AUTHORIZED and SCHEDULED. */
async function scheduled(session: string, overrides: Parameters<typeof request>[0] = {}): Promise<string> {
  const accepted = await quoteAndAccept(session, overrides);
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, session, accepted.reservationId, state, r.paypal_order_id!);
  return accepted.reservationId;
}

const eventCount = async (type: string) => (await app.db.query<{ n: number }>("select count(*)::int as n from events where type = $1", [type]))[0]!.n;
const versionCount = async (rid: string) =>
  (await app.db.query<{ n: number }>("select count(*)::int as n from schedule_versions where reservation_id = $1", [rid]))[0]!.n;

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code } satisfies Partial<ServiceError>);
}

describe("migration 003", () => {
  it("creates the disturbance, run and version tables", async () => {
    const rows = await app.db.query<{ t: string | null }>(
      "select to_regclass('disruption_events')::text as t union all select to_regclass('recovery_runs')::text union all select to_regclass('schedule_versions')::text",
    );
    expect(rows.every((r) => r.t !== null)).toBe(true);
  });
});

describe("recordDisruption", () => {
  it("is idempotent by eventId and refuses a reused id for a different disturbance", async () => {
    const rid = await scheduled(DRIVER);
    const input = { eventId: "evt_power_0001", reservationId: rid, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 7_200 }, effectiveSlot: 4 };
    const first = await recordDisruption(app.deps, input);
    const again = await recordDisruption(app.deps, input);
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.event.eventId).toBe(first.event.eventId);
    expect(await eventCount("DISRUPTION_RECORDED")).toBe(1);
    await expectCode(recordDisruption(app.deps, { ...input, params: { maxPowerW: 3_600 } }), "EVENT_ID_REUSED");
  });

  it("refuses disturbances for sessions that are not active, and for unknown reservations", async () => {
    const accepted = await quoteAndAccept(DRIVER);
    await expectCode(
      recordDisruption(app.deps, { eventId: "evt_notyet_01", reservationId: accepted.reservationId, type: "CHARGER_FAILURE", params: {}, effectiveSlot: 4 }),
      "NOT_ACTIVE",
    );
    await expectCode(recordDisruption(app.deps, { eventId: "evt_missing_1", reservationId: "res_missing", type: "CHARGER_FAILURE", params: {}, effectiveSlot: 4 }), "NOT_FOUND");
  });

  it("rejects physically meaningless params and unknown fields", async () => {
    const rid = await scheduled(DRIVER);
    await expectCode(recordDisruption(app.deps, { eventId: "evt_over_0001", reservationId: rid, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 12_000 }, effectiveSlot: 4 }), "INVALID_DISTURBANCE");
    await expect(recordDisruption(app.deps, { eventId: "evt_extra_01", reservationId: rid, type: "CHARGER_FAILURE", params: { note: "x" }, effectiveSlot: 4 })).rejects.toThrow();
  });

  it("keeps disturbance and version rows append-only", async () => {
    const rid = await scheduled(DRIVER);
    await recordDisruption(app.deps, { eventId: "evt_append_01", reservationId: rid, type: "CHARGER_FAILURE", params: {}, effectiveSlot: 60 });
    await expect(app.db.query("update disruption_events set effective_slot = 0")).rejects.toThrow(/append-only/);
    const plan = (await getReservation(app.db, rid))!.terms.powerW;
    // Recovery may already have written a version; stage one by hand only when it did not.
    if ((await versionCount(rid)) === 0) await commitScheduleVersion(app.deps, rid, 1, plan, "no-op", null, 0);
    await expect(app.db.query("update schedule_versions set reason = 'x'")).rejects.toThrow(/append-only/);
  });
});

describe("commitScheduleVersion", () => {
  it("appends version 2 and leaves the agreed terms and terms hash untouched", async () => {
    const rid = await scheduled(DRIVER);
    const before = await getReservation(app.db, rid);
    const plan = [...before!.terms.powerW];
    const commit = await commitScheduleVersion(app.deps, rid, 1, plan, "manual check", null, 0);
    expect(commit).toEqual({ version: 2, source: "MANUAL" });
    const after = await getReservation(app.db, rid);
    expect(after!.terms).toEqual(before!.terms);
    expect(after!.terms_hash).toBe(before!.terms_hash);
    expect(after!.amount_cents).toBe(before!.amount_cents);
  });

  it("refuses a stale expected version", async () => {
    const rid = await scheduled(DRIVER);
    const plan = [...(await getReservation(app.db, rid))!.terms.powerW];
    await commitScheduleVersion(app.deps, rid, 1, plan, "first", null, 0);
    await expectCode(commitScheduleVersion(app.deps, rid, 1, plan, "stale", null, 0), "VERSION_CONFLICT");
    expect(await versionCount(rid)).toBe(1);
  });

  it("lets exactly one of two concurrent commits win and reports the other as VERSION_CONFLICT", async () => {
    const rid = await scheduled(DRIVER);
    const plan = [...(await getReservation(app.db, rid))!.terms.powerW];
    const results = await Promise.allSettled([
      commitScheduleVersion(app.deps, rid, 1, plan, "A", null, 0),
      commitScheduleVersion(app.deps, rid, 1, plan, "B", null, 0),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: "VERSION_CONFLICT" });
    expect(await versionCount(rid)).toBe(1);
  });

  it("refuses to change energy before the effective slot", async () => {
    const rid = await scheduled(DRIVER);
    const plan = [...(await getReservation(app.db, rid))!.terms.powerW];
    const first = plan.findIndex((w) => w > 0);
    const changed = plan.map((w, i) => (i === first ? w - 400 : w));
    await expectCode(commitScheduleVersion(app.deps, rid, 1, changed, "past", null, first + 1), "PAST_ENERGY_CHANGED");
  });

  it("refuses a commit that would leave another session above a reduced site cap", async () => {
    const mine = await scheduled(DRIVER);
    const other = await scheduled(OTHER_DRIVER, { portId: "port_b" });
    const cap = 12_000;
    await recordDisruption(app.deps, { eventId: "evt_cap_0001", reservationId: mine, type: "SITE_CAP_REDUCTION", params: { stationCapW: cap }, effectiveSlot: 0 });
    const otherPlan = [...(await getReservation(app.db, other))!.terms.powerW];
    await expectCode(commitScheduleVersion(app.deps, other, 1, otherPlan, "overbook", null, 0), "PLAN_INVALID");
    expect(await versionCount(other)).toBe(0);
  });
});

describe("runRecovery", () => {
  it("auto-applies nothing for an early departure and needs approval of the exact proposal", async () => {
    const rid = await scheduled(DRIVER);
    const early = Date.parse("2026-11-06T12:00:00Z"); // 04:00 Pacific, earlier than the agreed 07:00
    const { event } = await recordDisruption(app.deps, { eventId: "evt_early_01", reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: early }, effectiveSlot: 24 });
    const run = await runRecovery(app.deps, event.eventId);
    expect(run.status).toBe("NEEDS_APPROVAL");
    expect(run.proposal?.reasons.join(" ")).toMatch(/departure/);
    expect(await versionCount(rid)).toBe(0);
    expect(await runRecovery(app.deps, event.eventId)).toEqual(run);
  });

  it("applies an approved proposal as version 2 and keeps the agreed terms", async () => {
    const rid = await scheduled(DRIVER);
    const termsBefore = JSON.stringify((await getReservation(app.db, rid))!.terms);
    const { event } = await recordDisruption(app.deps, { eventId: "evt_early_02", reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: Date.parse("2026-11-06T12:00:00Z") }, effectiveSlot: 24 });
    const run = await runRecovery(app.deps, event.eventId);
    const approved = await approveRecoveryRun(app.deps, run.runId, DRIVER);
    expect(approved.status).toBe("COMMITTED");
    expect(await versionCount(rid)).toBe(1);
    const row = (await getReservation(app.db, rid))!;
    expect(JSON.stringify(row.terms)).toBe(termsBefore);
  });

  it("does not let another driver approve or reject the proposal", async () => {
    const rid = await scheduled(DRIVER);
    const { event } = await recordDisruption(app.deps, { eventId: "evt_early_03", reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: Date.parse("2026-11-06T12:00:00Z") }, effectiveSlot: 24 });
    const run = await runRecovery(app.deps, event.eventId);
    await expectCode(approveRecoveryRun(app.deps, run.runId, OTHER_DRIVER), "NOT_FOUND");
    await expectCode(rejectRecoveryRun(app.deps, run.runId, OTHER_DRIVER), "NOT_FOUND");
  });

  it("expires a proposal that is approved after its window, and never applies it", async () => {
    const rid = await scheduled(DRIVER);
    const { event } = await recordDisruption(app.deps, { eventId: "evt_early_04", reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: Date.parse("2026-11-06T12:00:00Z") }, effectiveSlot: 24 });
    const run = await runRecovery(app.deps, event.eventId);
    app.clock.now += PROPOSAL_TTL_MS + 1;
    await expectCode(approveRecoveryRun(app.deps, run.runId, DRIVER), "PROPOSAL_EXPIRED");
    const status = await app.db.query<{ status: string }>("select status from recovery_runs where id = $1", [run.runId]);
    expect(status[0]!.status).toBe("EXPIRED");
    expect(await versionCount(rid)).toBe(0);
  });

  it("closes a rejected proposal without changing the schedule", async () => {
    const rid = await scheduled(DRIVER);
    const { event } = await recordDisruption(app.deps, { eventId: "evt_early_05", reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: Date.parse("2026-11-06T12:00:00Z") }, effectiveSlot: 24 });
    const run = await runRecovery(app.deps, event.eventId);
    expect((await rejectRecoveryRun(app.deps, run.runId, DRIVER)).status).toBe("REJECTED");
    expect(await versionCount(rid)).toBe(0);
  });

  it("refuses recovery once the session has been simulated", async () => {
    const rid = await scheduled(DRIVER);
    await runSimulation(app.deps, rid, { kind: "OPERATOR" });
    await expectCode(recordDisruption(app.deps, { eventId: "evt_late_0001", reservationId: rid, type: "CHARGER_FAILURE", params: {}, effectiveSlot: 60 }), "NOT_ACTIVE");
  });
});

describe("effective plan drives delivery and settlement", () => {
  it("simulates the recovered schedule and still captures the agreed amount", async () => {
    const rid = await scheduled(DRIVER);
    const termsHash = (await getReservation(app.db, rid))!.terms_hash;
    const { event } = await recordDisruption(app.deps, { eventId: "evt_power_0002", reservationId: rid, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 7_200 }, effectiveSlot: 0 });
    const run = await runRecovery(app.deps, event.eventId);
    if (run.status === "NEEDS_APPROVAL") await approveRecoveryRun(app.deps, run.runId, DRIVER);
    const after = await getReservation(app.db, rid);
    expect(after!.terms_hash).toBe(termsHash);
    const effective = (await app.db.query<{ power_w: number[] }>("select power_w from schedule_versions where reservation_id = $1 order by version desc limit 1", [rid]))[0]!.power_w;
    expect(Math.max(...effective)).toBeLessThanOrEqual(7_200);

    const settled = await runSimulation(app.deps, rid, { kind: "OPERATOR" });
    expect(settled.service_state).toBe("DELIVERED");
    expect(settled.payment_state).toBe("CAPTURED");
    const records = await app.db.query<{ slot_index: number; commanded_w: number }>(
      "select slot_index, commanded_w from energy_records where reservation_id = $1 order by slot_index",
      [rid],
    );
    for (const rec of records) expect(rec.commanded_w).toBe(effective[rec.slot_index]);
  });
});

describe("schedule read model", () => {
  it("shows the operator every session and the driver only their own", async () => {
    const mine = await scheduled(DRIVER);
    await scheduled(OTHER_DRIVER, { portId: "port_b" });
    const op = await scheduleView(app.deps, "2026-11-05");
    expect(op.sessions).toHaveLength(2);
    const drv = await driverScheduleView(app.deps, "2026-11-05", DRIVER);
    expect(drv.sessions.map((s) => s.reservationId)).toEqual([mine]);
    expect(drv.sessions[0]!.versions[0]).toMatchObject({ version: 1, source: "AGREED" });
  });
});
