/**
 * Scenario G: the same severe infeasible disturbance on a new-policy agreement settles by its recorded attribution.
 * Disturbances go through recordDisruption, so the real recovery engine and the real sweep run. Only the clock is set.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { effectivePowerOf, getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { recordDisruption } from "@/server/services/scheduleService";
import { FAILURE_REMEDY_COST_RECORDED, OPERATOR_RESOLUTION_REQUIRED, resolveOutdatedSessions } from "@/server/services/outdatedSessionService";
import { operatorDashboard } from "@/server/services/viewService";
import { OPERATOR_RESOLUTION_WINDOW_MS, RESOLUTION_GRACE_MS } from "@/domain/outdatedSession";
import type { FaultAttribution } from "@/domain/faultAttribution";
import { makeApp, NIGHT, request, resetApp, type TestApp } from "./helpers";

const DRIVER = "drv_attr_settle_1";
let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
  app.deps.awaitRecovery = true;
});
beforeEach(async () => {
  await resetApp(app);
  app.deps.llm = null;
});
afterAll(async () => {
  await app.db.close();
});

async function scheduled(): Promise<string> {
  const quote = await createQuote(app.deps, DRIVER, request({ portId: "port_c" }));
  const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost")!;
  const accepted = await acceptOffer(app.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, DRIVER, accepted.reservationId, state, r.paypal_order_id!);
  return accepted.reservationId;
}

/** The first slot of the agreed plan that charges: a charger failure here leaves the agreed energy undeliverable. */
async function firstChargingSlot(rid: string): Promise<number> {
  const powerW = await effectivePowerOf(app.db, (await getReservation(app.db, rid))!);
  return powerW.findIndex((w) => w > 0);
}

/** Records the charger failure through the real route-level service; the recovery engine runs as it would in production. */
async function recordSevereFailure(rid: string, attribution: FaultAttribution, eventId: string): Promise<string> {
  const { event } = await recordDisruption(app.deps, {
    eventId,
    reservationId: rid,
    type: "CHARGER_FAILURE",
    params: {},
    effectiveSlot: await firstChargingSlot(rid),
    attribution,
  });
  const rows = await app.db.query<{ status: string }>("select status from recovery_runs where disruption_event_id = $1", [event.eventId]);
  return rows[0]!.status;
}

const stateOf = async (rid: string) => {
  const r = (await getReservation(app.db, rid))!;
  return { payment: r.payment_state, service: r.service_state };
};
const countEvents = async (rid: string, type: string) =>
  (await app.db.query<{ n: number }>("select count(*)::int as n from events where reservation_id = $1 and type = $2", [rid, type]))[0]!.n;
const payloadsOf = async (rid: string, type: string) =>
  app.db.query<{ payload: Record<string, unknown> }>("select payload from events where reservation_id = $1 and type = $2 order by id", [rid, type]);
const callsOf = (name: string) => app.gateway.calls.filter((c) => c === name).length;
const dashboardSession = async (rid: string) => (await operatorDashboard(app.deps, NIGHT)).sessions.find((s) => s.id === rid)!;

describe("Scenario G: the same severe infeasible disturbance, settled by recorded attribution (new policy)", () => {
  it("OPERATOR: fully voided with zero charge, one modeled remedy record, and repeated sweeps add nothing", async () => {
    const rid = await scheduled();
    const status = await recordSevereFailure(rid, "OPERATOR", "evt_scg_oper_01");
    expect(status).toBe("INFEASIBLE");
    app.gateway.calls = [];

    app.clock.now = (await getReservation(app.db, rid))!.terms.departMs + RESOLUTION_GRACE_MS + 1;
    await resolveOutdatedSessions(app.deps);
    await resolveOutdatedSessions(app.deps);

    expect(await stateOf(rid)).toEqual({ payment: "VOIDED", service: "FAILED" });
    expect(callsOf("captureAuthorization")).toBe(0);
    expect(callsOf("voidAuthorization")).toBe(1);
    expect(await countEvents(rid, OPERATOR_RESOLUTION_REQUIRED)).toBe(0);
    const remedy = await payloadsOf(rid, FAILURE_REMEDY_COST_RECORDED);
    expect(remedy).toHaveLength(1);
    expect(remedy[0]!.payload).toMatchObject({ remedyCostCents: app.deps.economics.failedServiceRemedyCents, basis: "MODELED" });
  });

  it.each(["UNKNOWN", "EXTERNAL", "DRIVER"] as const)("%s: operator resolution required with a stored deadline, and no void or capture", async (attribution) => {
    const rid = await scheduled();
    const status = await recordSevereFailure(rid, attribution, `evt_scg_${attribution.toLowerCase()}_1`);
    expect(status).toBe("INFEASIBLE");
    app.gateway.calls = [];

    const checkedAt = (await getReservation(app.db, rid))!.terms.departMs + RESOLUTION_GRACE_MS + 1;
    app.clock.now = checkedAt;
    await resolveOutdatedSessions(app.deps);

    expect(await stateOf(rid)).toEqual({ payment: "AUTHORIZED", service: "SCHEDULED" });
    expect(callsOf("captureAuthorization")).toBe(0);
    expect(callsOf("voidAuthorization")).toBe(0);
    expect(await countEvents(rid, FAILURE_REMEDY_COST_RECORDED)).toBe(0);
    const flags = await payloadsOf(rid, OPERATOR_RESOLUTION_REQUIRED);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.payload.resolveBy).toBe(new Date(checkedAt + OPERATOR_RESOLUTION_WINDOW_MS).toISOString());

    // The operator's dashboard (the view a reload shows) carries the deadline, then the overdue state, and moves no money.
    const before = await dashboardSession(rid);
    expect(before).toMatchObject({ operatorResolutionRequired: true, resolutionDeadline: flags[0]!.payload.resolveBy, resolutionOverdue: false, paymentState: "AUTHORIZED" });
    app.clock.now = checkedAt + OPERATOR_RESOLUTION_WINDOW_MS + 1;
    await resolveOutdatedSessions(app.deps);
    expect(await dashboardSession(rid)).toMatchObject({ resolutionOverdue: true, paymentState: "AUTHORIZED" });
    expect(callsOf("captureAuthorization")).toBe(0);
    expect(callsOf("voidAuthorization")).toBe(0);
  });
});
