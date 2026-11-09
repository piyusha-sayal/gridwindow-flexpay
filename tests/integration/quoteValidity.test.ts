/** Quote validity under disturbances: stale snapshots fail closed, and new offers never exceed the disturbed envelope. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { recordDisruption } from "@/server/services/scheduleService";
import type { ServiceError } from "@/server/deps";
import { makeApp, request, resetApp, type TestApp } from "./helpers";

const DRIVER = "drv_quote_1";
const OTHER_DRIVER = "drv_quote_2";
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

/** Accepted, approved and scheduled reservation for `session` on the given port. */
async function scheduled(session: string, portId: string): Promise<string> {
  const quote = await createQuote(app.deps, session, request({ portId }));
  const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost")!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, session, accepted.reservationId, state, r.paypal_order_id!);
  return accepted.reservationId;
}

const reservationCount = async () => (await app.db.query<{ n: number }>("select count(*)::int as n from reservations"))[0]!.n;

describe("quote snapshots fail closed", () => {
  it("accepting a quote after a disturbance was recorded on its night is refused with QUOTE_STALE and creates nothing", async () => {
    const quote = await createQuote(app.deps, DRIVER, request({ portId: "port_a" }));
    const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost")!;
    const other = await scheduled(OTHER_DRIVER, "port_c");
    await recordDisruption(app.deps, { eventId: "evt_quote_stale1", reservationId: other, type: "CHARGER_FAILURE", params: {}, effectiveSlot: 60 });

    const before = await reservationCount();
    await expect(acceptOffer(app.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true })).rejects.toMatchObject({
      code: "QUOTE_STALE",
    } satisfies Partial<ServiceError>);
    expect(await reservationCount()).toBe(before);
  });

  it("a quote generated after the disturbance is accepted against the current snapshot", async () => {
    const other = await scheduled(OTHER_DRIVER, "port_c");
    await recordDisruption(app.deps, { eventId: "evt_quote_fresh1", reservationId: other, type: "CHARGER_FAILURE", params: {}, effectiveSlot: 60 });
    const quote = await createQuote(app.deps, DRIVER, request({ portId: "port_a" }));
    const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost")!;
    const accepted = await acceptOffer(app.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
    expect(accepted.reservationId).toBeTruthy();
  });
});

describe("new offers respect the disturbed envelope", () => {
  it("a power cap recorded on a port is never exceeded by an offer quoted afterwards", async () => {
    const other = await scheduled(OTHER_DRIVER, "port_c");
    await recordDisruption(app.deps, { eventId: "evt_quote_cap01", reservationId: other, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 3_600 }, effectiveSlot: 0 });
    const quote = await createQuote(app.deps, DRIVER, request({ portId: "port_c" }));
    for (const offer of quote.offers) {
      expect(Math.max(0, ...offer.powerW)).toBeLessThanOrEqual(3_600);
    }
  });

  it("with no disturbance on the night the quote is unchanged by the envelope check", async () => {
    const quote = await createQuote(app.deps, DRIVER, request({ portId: "port_c" }));
    expect(quote.offers.length).toBeGreaterThan(0);
    expect(quote.offers.every((o) => o.powerW.length === quote.grid.slotCount)).toBe(true);
  });
});
