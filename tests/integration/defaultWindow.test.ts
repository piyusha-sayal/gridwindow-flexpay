/**
 * Regression for the default-night defect: before 07:00 the default night used to be the previous
 * evening, whose window had already started, so checkout always ended in APPROVAL_TOO_LATE.
 * The default window must be in the future and bookable at every hour, including DST nights,
 * while the approval deadline stays enforced.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_STATION } from "@/domain/station";
import { approvalDeadlineMs } from "@/domain/terms";
import { zonedTimeToUtc } from "@/domain/time";
import type { ServiceError } from "@/server/deps";
import { getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { seedDemoNight } from "@/server/services/demoService";
import { createQuote, driverDefaultWindow } from "@/server/services/quoteService";
import { makeApp, request, resetApp, type TestApp } from "./helpers";

const DRIVER = "drv_default_window";
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

const tz = DEMO_STATION.timeZone;
const local = (year: number, month: number, day: number, hour: number, minute: number) => zonedTimeToUtc({ year, month, day, hour, minute }, tz);

const CASES: [string, number][] = [
  ["midnight", local(2026, 11, 5, 0, 0)],
  ["01:15", local(2026, 11, 5, 1, 15)],
  ["05:00", local(2026, 11, 5, 5, 0)],
  ["06:59", local(2026, 11, 5, 6, 59)],
  ["07:00", local(2026, 11, 5, 7, 0)],
  ["09:59", local(2026, 11, 5, 9, 59)],
  ["noon", local(2026, 11, 5, 12, 0)],
  ["evening after the default plug-in", local(2026, 11, 5, 20, 7)],
  ["DST fall-back morning (repeated 01:30)", local(2026, 11, 1, 1, 30)],
  ["evening before DST fall-back", local(2026, 10, 31, 21, 0)],
  ["DST spring-forward morning", local(2026, 3, 8, 3, 30)],
  ["evening before DST spring-forward", local(2026, 3, 7, 22, 10)],
];

async function bookDefault(nowMs: number) {
  app.clock.now = nowMs;
  const w = driverDefaultWindow(DEMO_STATION, nowMs);
  const quote = await createQuote(app.deps, DRIVER, request({ nightOf: w.nightOf, plugInLocal: w.plugInLocal, departLocal: w.departLocal }));
  return { w, quote };
}

describe("default charging window is future and bookable", () => {
  it.each(CASES)("%s: quote is feasible, every offer's approval deadline is ahead, checkout authorizes", async (_name, nowMs) => {
    const { quote } = await bookDefault(nowMs);
    expect(quote.request.plugInMs).toBeGreaterThan(nowMs);
    expect(quote.offers.length).toBeGreaterThan(0);
    for (const o of quote.offers) expect(approvalDeadlineMs({ gridStartMs: quote.grid.startMs, powerW: o.powerW, plugInMs: quote.request.plugInMs })).toBeGreaterThan(nowMs);

    const offer = quote.offers[0]!;
    const accepted = await acceptOffer(app.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
    const r = (await getReservation(app.db, accepted.reservationId))!;
    const order = await app.mock.approve(r.paypal_order_id!);
    const state = new URL(order.returnUrl).searchParams.get("state")!;
    const done = await handleCheckoutReturn(app.deps, DRIVER, r.id, state, r.paypal_order_id!);
    expect(done.payment_state).toBe("AUTHORIZED");
  });

  it("at 23:59 the window starts after midnight (00:15) and is still ahead", async () => {
    const nowMs = local(2026, 11, 5, 23, 59);
    const { w, quote } = await bookDefault(nowMs);
    expect(w).toEqual({ nightOf: "2026-11-05", plugInLocal: "00:15", departLocal: "07:00" });
    expect(quote.request.plugInMs).toBe(local(2026, 11, 6, 0, 15));
    expect(quote.request.plugInMs).toBeGreaterThan(nowMs);
  });

  it("just before midnight the window (00:15 → 07:00) is still ahead and physically feasible; any rejection is economic, not timing", async () => {
    const nowMs = local(2026, 11, 5, 23, 50);
    const { w, quote } = await bookDefault(nowMs);
    expect(w.plugInLocal).toBe("00:15");
    expect(quote.request.plugInMs).toBeGreaterThan(nowMs);
    expect(quote.capacity.maxBatteryWh).toBeGreaterThanOrEqual(quote.capacity.requiredBatteryWh);
    for (const o of quote.offers) expect(approvalDeadlineMs({ gridStartMs: quote.grid.startMs, powerW: o.powerW, plugInMs: quote.request.plugInMs })).toBeGreaterThan(nowMs);
    for (const r of quote.rejected) expect(["NO_ENERGY_SAVINGS", "DISCOUNT_BELOW_MINIMUM", "DUPLICATE_SCHEDULE"]).toContain(r.reason);
  });

  it("operator demo seeding works on the default night before 07:00", async () => {
    const nowMs = local(2026, 11, 5, 5, 0);
    app.clock.now = nowMs;
    expect(await seedDemoNight({ ...app.deps, gateway: app.mock }, driverDefaultWindow(DEMO_STATION, nowMs).nightOf)).toHaveLength(2);
  });

  it("the approval deadline is still enforced: approving after charging should have begun is refused", async () => {
    const { quote } = await bookDefault(local(2026, 11, 5, 5, 0));
    const offer = quote.offers[0]!;
    const accepted = await acceptOffer(app.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
    const r = (await getReservation(app.db, accepted.reservationId))!;
    const order = await app.mock.approve(r.paypal_order_id!);
    const state = new URL(order.returnUrl).searchParams.get("state")!;
    app.clock.now = approvalDeadlineMs({ gridStartMs: quote.grid.startMs, powerW: offer.powerW, plugInMs: quote.request.plugInMs });
    const err = await handleCheckoutReturn(app.deps, DRIVER, r.id, state, r.paypal_order_id!).catch((e: ServiceError) => e);
    expect((err as ServiceError).code).toBe("APPROVAL_TOO_LATE");
    expect((await getReservation(app.db, r.id))!.payment_state).not.toBe("AUTHORIZED");
  });
});

describe("past windows are refused before any payment", () => {
  it("a plug-in time that has already passed is refused when quoting, naming the earliest default", async () => {
    app.clock.now = local(2026, 11, 5, 21, 0);
    await expect(createQuote(app.deps, DRIVER, request({ plugInLocal: "19:00" }))).rejects.toMatchObject({ code: "PLUG_IN_PASSED", message: expect.stringContaining("21:15") });
    await expect(createQuote(app.deps, DRIVER, request({ plugInLocal: "21:15" }))).resolves.toMatchObject({ quoteSetId: expect.any(String) });
  });

  it("accept after the approval deadline is refused before a reservation or order exists", async () => {
    const { quote } = await bookDefault(local(2026, 11, 5, 5, 0));
    const offer = quote.offers[0]!;
    app.clock.now = approvalDeadlineMs({ gridStartMs: quote.grid.startMs, powerW: offer.powerW, plugInMs: quote.request.plugInMs });
    // Keep the quote itself unexpired so only the deadline applies.
    await app.db.query("update quote_sets set payload = jsonb_set(payload, '{expiresAtMs}', to_jsonb($1::bigint)) where id = $2", [app.clock.now + 60_000, quote.quoteSetId]);
    await expect(acceptOffer(app.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true })).rejects.toMatchObject({ code: "APPROVAL_TOO_LATE" });
    expect((await app.db.query<{ n: number }>("select count(*)::int as n from reservations"))[0]!.n).toBe(0);
    expect(app.gateway.calls).not.toContain("createOrder");
  });

  it("demo seeding late in the evening plugs background cars in at the next bookable time", async () => {
    app.clock.now = local(2026, 11, 5, 21, 0);
    const ids = await seedDemoNight({ ...app.deps, gateway: app.mock }, "2026-11-05");
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const r = (await getReservation(app.db, id))!;
      expect(r.payment_state).toBe("AUTHORIZED");
    }
  });
});

