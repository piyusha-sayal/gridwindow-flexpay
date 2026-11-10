/**
 * Authorization races: late or ambiguous provider authorizations against deadline failures, webhooks, recovery,
 * capacity conflicts, provider outages and process restarts. Interleavings are forced with Promise.all and injected
 * provider faults. Runs on embedded PGlite by default and on real PostgreSQL (concurrent connections) when
 * TEST_DATABASE_URL points at a disposable server, because makeApp routes there automatically.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { validatePlans } from "@/domain/validator";
import { MockGateway } from "@/payments/mockGateway";
import { ProviderError } from "@/payments/gateway";
import type { AppDeps } from "@/server/deps";
import { committedPlans, getReservation } from "@/server/repo";
import { acceptOffer, commitCapacityOrVoid, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote, scenarioFor } from "@/server/services/quoteService";
import { recoverPendingReservations } from "@/server/services/recoveryService";
import { resolveOutdatedSessions } from "@/server/services/outdatedSessionService";
import { runSimulation, voidAuthorization } from "@/server/services/settlementService";
import { handlePayPalWebhook } from "@/server/services/webhookService";
import { makeApp, NIGHT, request, resetApp, ScriptedGateway, timeout, type TestApp } from "./helpers";

let app: TestApp;
/** Provider reads fail while true (outage window controlled by the test). */
let providerDown = false;

beforeAll(async () => {
  app = await makeApp();
  app.deps.awaitRecovery = true;
});
beforeEach(async () => {
  await resetApp(app);
  app.deps.llm = null;
  providerDown = false;
});
afterAll(async () => {
  await app.db.close();
});

interface Accepted {
  rid: string;
  orderId: string;
  state: string;
  session: string;
}

const countEvents = async (rid: string, type: string) =>
  (await app.db.query<{ n: number }>("select count(*)::int as n from events where reservation_id = $1 and type = $2", [rid, type]))[0]!.n;
const stateOf = async (rid: string) => (await getReservation(app.db, rid))!.payment_state;
const callsOf = (name: string) => app.gateway.calls.filter((c) => c === name).length;
const countCaptures = async () => (await app.db.query("select 1 from mock_provider_objects where kind = 'capture'")).length;

/** Accepted at the provider and buyer-approved; the driver has not yet returned to the merchant. */
async function acceptedAndApproved(session: string, portId = "port_c"): Promise<Accepted> {
  const quote = await createQuote(app.deps, session, request({ portId }));
  const offer = quote.offers[0]!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  return { rid: r.id, orderId: r.paypal_order_id!, state: new URL(order.returnUrl).searchParams.get("state")!, session };
}

/** Authorized and capacity-committed through the normal return. */
async function authorized(session: string, portId = "port_c"): Promise<Accepted> {
  const a = await acceptedAndApproved(session, portId);
  await handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId);
  return a;
}

/** Makes the provider's order reads fail while `providerDown` is set. */
function outageOnOrderReads(): void {
  const real = app.mock.getOrder.bind(app.mock);
  app.gateway.overrides.getOrder = async (id: string) => {
    if (providerDown) throw timeout();
    return real(id);
  };
}

const hook = (eventId: string, eventType: string, orderId: string) =>
  handlePayPalWebhook(app.deps, {}, JSON.stringify({ id: eventId, event_type: eventType, resource: { id: orderId } }));

describe("A: authorization arrives after a deadline failure", () => {
  it("A1 a late authorization that returns normally is kept by id and voided by the sweep, never recorded as authorized", async () => {
    const a = await acceptedAndApproved("drv_a1");
    const realAuthorize = app.mock.authorizeOrder.bind(app.mock);
    let authorizationId: string | null = null;
    app.gateway.overrides.authorizeOrder = async (orderId, key) => {
      await app.db.query("update reservations set payment_state = 'FAILED', service_state = 'CANCELLED' where id = $1", [a.rid]);
      const auth = await realAuthorize(orderId, key);
      authorizationId = auth.authorizationId;
      return auth;
    };
    await handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId);
    delete app.gateway.overrides.authorizeOrder;

    expect(await getReservation(app.db, a.rid)).toMatchObject({ payment_state: "FAILED", paypal_authorization_id: authorizationId });
    expect(await countEvents(a.rid, "AUTHORIZED")).toBe(0);
    await resolveOutdatedSessions(app.deps);
    expect((await app.gateway.getAuthorization(authorizationId!)).status).toBe("VOIDED");
    expect(await countEvents(a.rid, "ORPHAN_AUTHORIZATION_VOIDED")).toBe(1);
    expect(callsOf("captureAuthorization")).toBe(0);
  });

  it("A2 the authorization lands after the deadline failure and its response is lost while the provider is unreachable: the sweep still finds and voids it", async () => {
    const a = await acceptedAndApproved("drv_a2");
    const realAuthorize = app.mock.authorizeOrder.bind(app.mock);
    let authorizationId: string | null = null;
    outageOnOrderReads();
    app.gateway.overrides.authorizeOrder = async (orderId, key) => {
      await app.db.query("update reservations set payment_state = 'FAILED', service_state = 'CANCELLED' where id = $1", [a.rid]);
      authorizationId = (await realAuthorize(orderId, key)).authorizationId;
      providerDown = true;
      throw timeout();
    };
    await handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId);
    delete app.gateway.overrides.authorizeOrder;
    expect(await stateOf(a.rid)).toBe("FAILED");

    providerDown = false;
    await resolveOutdatedSessions(app.deps);

    expect(authorizationId).not.toBeNull();
    expect((await app.gateway.getAuthorization(authorizationId!)).status).toBe("VOIDED");
    expect(await getReservation(app.db, a.rid)).toMatchObject({ payment_state: "FAILED", paypal_authorization_id: authorizationId });
    expect(await countEvents(a.rid, "ORPHAN_AUTHORIZATION_VOIDED")).toBe(1);
    expect(callsOf("captureAuthorization")).toBe(0);
  });
});

describe("B: provider timeout after a successful authorization", () => {
  it("B the sweep reconciles the lost authorize response to AUTHORIZED with capacity committed, without a second authorize", async () => {
    const a = await acceptedAndApproved("drv_b");
    const realAuthorize = app.mock.authorizeOrder.bind(app.mock);
    outageOnOrderReads();
    app.gateway.overrides.authorizeOrder = async (orderId, key) => {
      await realAuthorize(orderId, key);
      providerDown = true;
      throw timeout();
    };
    await handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId);
    delete app.gateway.overrides.authorizeOrder;
    expect(await stateOf(a.rid)).toBe("NEEDS_RECONCILIATION");

    providerDown = false;
    await resolveOutdatedSessions(app.deps);

    expect(await getReservation(app.db, a.rid)).toMatchObject({ payment_state: "AUTHORIZED", slots_committed: true, service_state: "SCHEDULED" });
    expect(callsOf("authorizeOrder")).toBe(1);
    expect(await countEvents(a.rid, "CAPACITY_COMMITTED")).toBe(1);
    expect(await countCaptures()).toBe(0);
  });
});

describe("C and D: webhooks around the checkout return and terminal states", () => {
  it("C a webhook that arrives before the checkout return advances the state, and the return then authorizes exactly once", async () => {
    const a = await acceptedAndApproved("drv_c");
    app.gateway.webhookValid = true;
    expect(await hook("WH-C-1", "CHECKOUT.ORDER.APPROVED", a.orderId)).toEqual({ status: 200, result: "PROCESSED" });
    expect(await stateOf(a.rid)).toBe("BUYER_APPROVED");

    await handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId);

    expect(await getReservation(app.db, a.rid)).toMatchObject({ payment_state: "AUTHORIZED", slots_committed: true, service_state: "SCHEDULED" });
    expect(callsOf("authorizeOrder")).toBe(1);
    expect(await countEvents(a.rid, "AUTHORIZED")).toBe(1);
  });

  it("D webhooks for an order whose local state is already terminal change nothing, and the conflict is recorded once", async () => {
    const a = await acceptedAndApproved("drv_d");
    await app.db.query("update reservations set payment_state = 'CANCELLED', service_state = 'CANCELLED' where id = $1", [a.rid]);
    app.gateway.webhookValid = true;
    for (const id of ["WH-D-1", "WH-D-2", "WH-D-3"]) {
      expect((await hook(id, "CHECKOUT.ORDER.APPROVED", a.orderId)).status).toBe(200);
    }
    expect(await getReservation(app.db, a.rid)).toMatchObject({ payment_state: "CANCELLED", service_state: "CANCELLED", slots_committed: false, paypal_authorization_id: null });
    expect(callsOf("authorizeOrder") + callsOf("captureAuthorization") + callsOf("voidAuthorization")).toBe(0);
    expect(await countEvents(a.rid, "RECONCILIATION_CONFLICT")).toBe(1);
  });

  it("D2 a provider authorization that appears after the local cancellation is kept by id and voided once", async () => {
    const a = await acceptedAndApproved("drv_d2");
    await app.db.query("update reservations set payment_state = 'CANCELLED', service_state = 'CANCELLED' where id = $1", [a.rid]);
    const auth = await app.mock.authorizeOrder(a.orderId, "external-d2-authorize");
    app.gateway.webhookValid = true;

    await hook("WH-D2-1", "PAYMENT.AUTHORIZATION.CREATED", a.orderId);
    await hook("WH-D2-2", "PAYMENT.AUTHORIZATION.CREATED", a.orderId);

    expect((await app.gateway.getAuthorization(auth.authorizationId)).status).toBe("VOIDED");
    expect(await getReservation(app.db, a.rid)).toMatchObject({ payment_state: "CANCELLED", paypal_authorization_id: auth.authorizationId });
    expect(await countEvents(a.rid, "ORPHAN_AUTHORIZATION_VOIDED")).toBe(1);
    expect(callsOf("voidAuthorization")).toBe(1);
  });
});

describe("E and F: concurrent reconciliation and duplicate delivery", () => {
  it("E a reconciliation, a return revisit, two sweeps and a webhook race one unresolved reservation: one transition, one capacity commit, no second authorize", async () => {
    const a = await authorized("drv_e");
    await app.db.query("update reservations set payment_state = 'NEEDS_RECONCILIATION', slots_committed = false, service_state = 'AWAITING_PAYMENT' where id = $1", [a.rid]);
    const capacityBefore = await countEvents(a.rid, "CAPACITY_COMMITTED");
    app.gateway.calls = [];
    app.gateway.webhookValid = true;

    await Promise.all([
      handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId),
      resolveOutdatedSessions(app.deps),
      resolveOutdatedSessions({ ...app.deps }),
      hook("WH-E-1", "CHECKOUT.ORDER.APPROVED", a.orderId),
    ]);

    expect(await getReservation(app.db, a.rid)).toMatchObject({ payment_state: "AUTHORIZED", slots_committed: true, service_state: "SCHEDULED" });
    expect(await countEvents(a.rid, "CAPACITY_COMMITTED")).toBe(capacityBefore + 1);
    expect(await countEvents(a.rid, "RECONCILED")).toBe(1);
    expect(callsOf("authorizeOrder") + callsOf("captureAuthorization") + callsOf("voidAuthorization")).toBe(0);
  });

  it("E2 a stale return that reads BUYER_APPROVED after the authorize already succeeded reads provider truth and sends no second authorize", async () => {
    const a = await authorized("drv_e2");
    await app.db.query("update reservations set payment_state = 'BUYER_APPROVED', slots_committed = false, service_state = 'AWAITING_PAYMENT' where id = $1", [a.rid]);
    app.gateway.calls = [];

    await handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId);

    expect(await getReservation(app.db, a.rid)).toMatchObject({ payment_state: "AUTHORIZED", slots_committed: true, service_state: "SCHEDULED" });
    expect(callsOf("authorizeOrder")).toBe(0);
    expect(await countEvents(a.rid, "AUTHORIZED")).toBe(1);
  });

  it("F a duplicate webhook delivered concurrently and again later records one verification and one state change", async () => {
    const a = await acceptedAndApproved("drv_f");
    app.gateway.webhookValid = true;
    const outcomes = await Promise.all([
      hook("WH-F-1", "CHECKOUT.ORDER.APPROVED", a.orderId),
      hook("WH-F-1", "CHECKOUT.ORDER.APPROVED", a.orderId),
      hook("WH-F-1", "CHECKOUT.ORDER.APPROVED", a.orderId),
    ]);
    expect(outcomes.every((o) => o.status === 200)).toBe(true);
    expect(await hook("WH-F-1", "CHECKOUT.ORDER.APPROVED", a.orderId)).toEqual({ status: 200, result: "DUPLICATE" });

    expect(await countEvents(a.rid, "WEBHOOK_VERIFIED")).toBe(1);
    expect(await countEvents(a.rid, "RECONCILED")).toBe(1);
    expect(await stateOf(a.rid)).toBe("BUYER_APPROVED");
    expect(callsOf("authorizeOrder")).toBe(0);
  });
});

describe("G: process restart during a pending settlement", () => {
  it("a restarted process (new deps and gateway over the same database) finishes an interrupted capture exactly once", async () => {
    const a = await authorized("drv_g");
    app.gateway.overrides.captureAuthorization = () => new Promise<never>(() => undefined);
    void runSimulation(app.deps, a.rid, { kind: "OPERATOR" }).catch(() => undefined);
    await expect.poll(async () => (await app.db.query("select 1 from simulation_runs where reservation_id = $1", [a.rid])).length).toBe(1);

    // Process restart: only the database and the provider survive. The crashed worker's lease must expire first.
    const restarted: AppDeps = { ...app.deps, gateway: new ScriptedGateway(new MockGateway(app.db, "http://test.local")), now: () => app.clock.now + 61_000 };
    await recoverPendingReservations(restarted);

    expect(await stateOf(a.rid)).toBe("CAPTURED");
    expect(await countCaptures()).toBe(1);
    expect(await countEvents(a.rid, "CAPTURED")).toBe(1);
  });
});

describe("H: two requests race the same charging capacity", () => {
  it("exactly one commits; the other is voided and never double-books the port", async () => {
    const quoteA = await createQuote(app.deps, "drv_h_a", request({ portId: "port_c" }));
    const quoteB = await createQuote(app.deps, "drv_h_b", request({ portId: "port_c" }));
    const accepted = await Promise.all(
      [
        { session: "drv_h_a", quote: quoteA },
        { session: "drv_h_b", quote: quoteB },
      ].map(({ session, quote }) => {
        const offer = quote.offers[0]!;
        return acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
      }),
    );
    const returns = await Promise.all(
      accepted.map(async (a, i) => {
        const r = (await getReservation(app.db, a.reservationId))!;
        const order = await app.mock.approve(r.paypal_order_id!);
        return { session: `drv_h_${i === 0 ? "a" : "b"}`, rid: r.id, orderId: r.paypal_order_id!, state: new URL(order.returnUrl).searchParams.get("state")! };
      }),
    );
    const settled = await Promise.allSettled(returns.map((x) => handleCheckoutReturn(app.deps, x.session, x.rid, x.state, x.orderId)));
    expect(settled.every((s) => s.status === "fulfilled")).toBe(true);

    const rows = await app.db.query<{ payment_state: string; service_state: string; slots_committed: boolean }>("select payment_state, service_state, slots_committed from reservations");
    expect(rows.filter((r) => r.slots_committed)).toHaveLength(1);
    expect(rows.filter((r) => r.payment_state === "VOIDED" && r.service_state === "CANCELLED")).toHaveLength(1);
    expect(await app.db.query("select id from reservations where payment_state = 'AUTHORIZED' and not slots_committed")).toEqual([]);
    expect(callsOf("captureAuthorization")).toBe(0);
    expect(callsOf("voidAuthorization")).toBe(1);

    const committed = await committedPlans(app.db, app.deps.station.id, NIGHT);
    const scenario = scenarioFor(app.deps.station, NIGHT);
    expect(validatePlans(app.deps.station, scenario.grid, scenario.forecastBaseLoadW, committed, [])).toEqual([]);
    expect(committed).toHaveLength(1);
  });
});

describe("I: provider temporarily unavailable", () => {
  it("I1 a 503 during the return leaves the accepted state intact, and a later return authorizes once", async () => {
    const a = await acceptedAndApproved("drv_i1");
    const real = app.mock.getOrder.bind(app.mock);
    let down = true;
    app.gateway.overrides.getOrder = async (id: string) => {
      if (down) throw new ProviderError("HTTP_5XX", "provider unavailable", 503);
      return real(id);
    };
    await expect(handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId)).rejects.toBeInstanceOf(ProviderError);
    expect(await stateOf(a.rid)).toBe("ORDER_CREATED");
    expect(callsOf("authorizeOrder")).toBe(0);

    down = false;
    await handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId);
    expect(await stateOf(a.rid)).toBe("AUTHORIZED");
    expect(callsOf("authorizeOrder")).toBe(1);
  });

  it("I2 a webhook received while the provider is down is answered 503 and processed on redelivery", async () => {
    const a = await acceptedAndApproved("drv_i2");
    app.gateway.webhookValid = true;
    outageOnOrderReads();
    providerDown = true;
    expect(await hook("WH-I2-1", "CHECKOUT.ORDER.APPROVED", a.orderId)).toEqual({ status: 503, result: "RETRY_LATER" });
    expect(await stateOf(a.rid)).toBe("ORDER_CREATED");

    providerDown = false;
    expect(await hook("WH-I2-1", "CHECKOUT.ORDER.APPROVED", a.orderId)).toEqual({ status: 200, result: "PROCESSED" });
    expect(await stateOf(a.rid)).toBe("BUYER_APPROVED");
    expect(await hook("WH-I2-1", "CHECKOUT.ORDER.APPROVED", a.orderId)).toEqual({ status: 200, result: "DUPLICATE" });
  });
});

describe("J: stale workers never commit capacity twice or overwrite a settled state", () => {
  it("J1 concurrent and later commit attempts produce exactly one capacity commit", async () => {
    const a = await authorized("drv_j1");
    await app.db.query("update reservations set slots_committed = false, service_state = 'AWAITING_PAYMENT' where id = $1", [a.rid]);
    const before = await countEvents(a.rid, "CAPACITY_COMMITTED");

    await Promise.all([commitCapacityOrVoid(app.deps, a.rid), commitCapacityOrVoid({ ...app.deps }, a.rid), commitCapacityOrVoid(app.deps, a.rid)]);
    await commitCapacityOrVoid(app.deps, a.rid);

    expect(await countEvents(a.rid, "CAPACITY_COMMITTED")).toBe(before + 1);
    expect(await getReservation(app.db, a.rid)).toMatchObject({ payment_state: "AUTHORIZED", slots_committed: true, service_state: "SCHEDULED" });
  });

  it("J2 a stale commit after another worker voided the reservation never re-commits capacity", async () => {
    const a = await authorized("drv_j2", "port_a");
    await app.db.query("update reservations set slots_committed = false, service_state = 'AWAITING_PAYMENT' where id = $1", [a.rid]);
    const before = await countEvents(a.rid, "CAPACITY_COMMITTED");
    await voidAuthorization(app.deps, a.rid, "OTHER_WORKER");

    await Promise.all([commitCapacityOrVoid(app.deps, a.rid), commitCapacityOrVoid({ ...app.deps }, a.rid)]);

    expect(await countEvents(a.rid, "CAPACITY_COMMITTED")).toBe(before);
    expect(await getReservation(app.db, a.rid)).toMatchObject({ payment_state: "VOIDED", slots_committed: false });
  });
});
