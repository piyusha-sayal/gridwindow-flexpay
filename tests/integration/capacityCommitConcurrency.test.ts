/** A checkout-return capacity commit and the sweep's recovery-path commit racing on one reservation. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { resolveOutdatedSessions } from "@/server/services/outdatedSessionService";
import { makeApp, request, resetApp, type TestApp } from "./helpers";

const DRIVER = "drv_capcommit_1";
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

/** Authorized and committed through the normal return; returns the checkout state needed to revisit the return. */
async function authorizedWithOrder(): Promise<{ rid: string; state: string; orderId: string }> {
  const quote = await createQuote(app.deps, DRIVER, request());
  const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost")!;
  const accepted = await acceptOffer(app.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, DRIVER, accepted.reservationId, state, r.paypal_order_id!);
  return { rid: accepted.reservationId, state, orderId: r.paypal_order_id! };
}

const countEvents = async (rid: string, type: string) =>
  (await app.db.query<{ n: number }>("select count(*)::int as n from events where reservation_id = $1 and type = $2", [rid, type]))[0]!.n;

describe("checkout-return commit vs sweep commit on one reservation", () => {
  it("both paths race to commit capacity: exactly one committed state, one capacity event, no settlement", async () => {
    const { rid, state, orderId } = await authorizedWithOrder();
    // Rewind to the window between authorization and capacity commit (capacity not yet held).
    await app.db.query("update reservations set slots_committed = false, service_state = 'AWAITING_PAYMENT' where id = $1", [rid]);
    const before = await countEvents(rid, "CAPACITY_COMMITTED");

    await Promise.all([handleCheckoutReturn(app.deps, DRIVER, rid, state, orderId), resolveOutdatedSessions(app.deps), resolveOutdatedSessions({ ...app.deps })]);

    const r = (await getReservation(app.db, rid))!;
    expect(r).toMatchObject({ payment_state: "AUTHORIZED", service_state: "SCHEDULED", slots_committed: true });
    expect(app.gateway.calls.filter((c) => c === "voidAuthorization" || c === "captureAuthorization")).toHaveLength(0);
    expect((await countEvents(rid, "CAPACITY_COMMITTED")) - before).toBe(1);
  });
});
