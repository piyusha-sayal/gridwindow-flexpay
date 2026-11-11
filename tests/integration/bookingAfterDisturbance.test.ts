/**
 * Booking on a disturbed night (MOCK payments, PGlite, deterministic recovery). Regression for a finding of the
 * 2026-11-11 release check: after a charger power cut left one session above its new port limit (no feasible recovery),
 * offers were still shown to the next driver, but accepting one failed with CAPACITY_CHANGED; and the capacity commit
 * after authorization would have cancelled and voided such a booking. Acceptance and the commit now use the same
 * "violations introduced by this plan" rule as quoting, so one disturbed session never blocks the rest of the night,
 * while a genuine conflict is still refused (see lifecycle.test.ts, overbooking caught at commit).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_STATION } from "@/domain/station";
import { validateWithEnvelope } from "@/domain/disturbance";
import { committedPlans, getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { nightContext, recordDisruption } from "@/server/services/scheduleService";
import { makeApp, NIGHT, request, resetApp, type TestApp } from "./helpers";

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

async function book(driver: string, portId: string) {
  const quote = await createQuote(app.deps, driver, request({ portId }));
  expect(quote.offers.length).toBeGreaterThan(0);
  const offer = quote.offers[0]!;
  const accepted = await acceptOffer(app.deps, driver, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, driver, accepted.reservationId, state, r.paypal_order_id!);
  return (await getReservation(app.db, accepted.reservationId))!;
}

describe("booking after a disturbance on another port", () => {
  it("a session left above its cut port limit does not block a new booking on another port", async () => {
    const first = await book("drv_cut_1", "port_b");
    expect(`${first.payment_state}/${first.service_state}`).toBe("AUTHORIZED/SCHEDULED");

    // Port B drops to 2.4 kW from 22:00 local (slot 16): the remaining energy cannot be delivered, the plan stays as agreed.
    await recordDisruption(app.deps, { eventId: "evt_cut_00001", reservationId: first.id, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 2_400 }, effectiveSlot: 16 });
    const runs = await app.db.query<{ status: string }>("select status from recovery_runs where disruption_event_id = $1", ["evt_cut_00001"]);
    expect(runs.map((r) => r.status)).toEqual(["INFEASIBLE"]);

    // Precondition: the committed night now violates the disturbed envelope on its own.
    const { scenario, envelope } = await nightContext(app.db, DEMO_STATION, NIGHT);
    const committed = await committedPlans(app.db, DEMO_STATION.id, NIGHT);
    const existing = validateWithEnvelope({ station: DEMO_STATION, grid: scenario.grid, forecastBaseLoadW: scenario.forecastBaseLoadW, envelope, plans: committed });
    expect(existing.some((v) => v.code === "PORT_POWER_CAP" && v.sessionId === first.id)).toBe(true);

    // A second driver on port C: offers are shown, acceptance succeeds, and capacity is committed after authorization.
    const gatewayBefore = app.gateway.calls.length;
    const second = await book("drv_cut_2", "port_c");
    expect(`${second.payment_state}/${second.service_state}`).toBe("AUTHORIZED/SCHEDULED");
    expect(second.slots_committed).toBe(true);
    const events = await app.db.query<{ type: string }>("select type from events where reservation_id = $1 order by id", [second.id]);
    expect(events.map((e) => e.type)).toContain("CAPACITY_COMMITTED");
    expect(events.map((e) => e.type)).not.toContain("CAPACITY_CONFLICT");
    expect(app.gateway.calls.slice(gatewayBefore).some((c) => /void/i.test(String(c)))).toBe(false);
  });
});
