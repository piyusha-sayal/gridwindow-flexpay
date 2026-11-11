/**
 * The persisted schedule view feeds the operator capacity chart (audit I2 and I3). It must expose the capacity-holding flag,
 * the validator's safety headroom and the scenario's forecast base load, and a voided session must stop holding capacity.
 * MOCK provider, real schema. No external service is called.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { holdsCapacity } from "@/domain/capacity";
import { DEMO_STATION } from "@/domain/station";
import { getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { scheduleView } from "@/server/services/scheduleView";
import { runSimulation } from "@/server/services/settlementService";
import { buildScheduleModel } from "@/app/operator/schedule/scheduleModel";
import { NIGHT, makeApp, request, resetApp, type TestApp } from "./helpers";

let app: TestApp;
beforeAll(async () => {
  app = await makeApp();
});
beforeEach(async () => {
  await resetApp(app);
});
afterAll(async () => {
  await app.db.close();
});

async function scheduled(session: string, portId: string): Promise<string> {
  const quote = await createQuote(app.deps, session, request({ portId, targetBatteryKWh: 10 }));
  const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost")!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, session, accepted.reservationId, state, r.paypal_order_id!);
  return accepted.reservationId;
}

describe("schedule view capacity inputs", () => {
  it("exposes the usable-limit inputs from the same station and scenario the validator uses", async () => {
    const rid = await scheduled("drv_cap_1", "port_c");
    const view = await scheduleView(app.deps, NIGHT);
    expect(view.stationCapW).toBe(DEMO_STATION.stationCapW);
    expect(view.safetyHeadroomW).toBe(DEMO_STATION.safetyHeadroomW);
    expect(view.forecastBaseLoadW).toHaveLength(view.sessions[0]!.originalPowerW.length);
    expect(view.forecastBaseLoadW.every((w) => Number.isFinite(w) && w >= 0)).toBe(true);
    const s = view.sessions.find((x) => x.reservationId === rid)!;
    expect(s).toMatchObject({ paymentState: "AUTHORIZED", serviceState: "SCHEDULED", slotsCommitted: true });
    expect(holdsCapacity(s)).toBe(true);
  });

  it("stops counting a session once its authorization is voided after a failed delivery, without touching payment state", async () => {
    const keep = await scheduled("drv_cap_1", "port_b");
    const fail = await scheduled("drv_cap_2", "port_c");
    const before = buildScheduleModel(await scheduleView(app.deps, NIGHT));
    expect(before.sessions.every((s) => s.holdsCapacity)).toBe(true);
    const peakBefore = Math.max(...before.capacity.map((c) => c.drawKw));

    const r = (await getReservation(app.db, fail))!;
    const firstSlot = r.terms.powerW.findIndex((w) => w > 0);
    await runSimulation(app.deps, fail, { kind: "OPERATOR" }, { outage: { fromSlot: firstSlot, toSlot: r.terms.powerW.length } });

    const row = (await getReservation(app.db, fail))!;
    expect(row).toMatchObject({ payment_state: "VOIDED", slots_committed: false });
    const after = buildScheduleModel(await scheduleView(app.deps, NIGHT));
    expect(after.sessions.find((s) => s.sessionId === fail)).toMatchObject({ holdsCapacity: false, paymentState: "VOIDED" });
    expect(after.sessions.find((s) => s.sessionId === keep)?.holdsCapacity).toBe(true);
    expect(after.bursts.some((b) => b.sessionId === fail)).toBe(false);
    expect(Math.max(...after.capacity.map((c) => c.drawKw))).toBeLessThan(peakBefore);
    // Building the chart read-only left the stored states exactly as they were.
    expect(await getReservation(app.db, fail)).toEqual(row);
  });
});
