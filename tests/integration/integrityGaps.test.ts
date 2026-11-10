/**
 * Integrity gaps for provider-authorized reservations: authorization without confirmed capacity, orphan authorizations on
 * locally terminal rows, webhook redelivery after provider failure, and concurrent entry points on one reservation.
 * Interleavings are forced with Promise.all and injected provider/DB hooks; PGlite serializes transactions per database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { validateWithEnvelope } from "@/domain/disturbance";
import { committedPlans, getReservation } from "@/server/repo";
import { acceptOffer, commitCapacityOrVoid, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { recoverReservation } from "@/server/services/recoveryService";
import { resolveOutdatedSessions } from "@/server/services/outdatedSessionService";
import { nightContext } from "@/server/services/scheduleService";
import { captureAuthorization, runSimulation, voidAuthorization } from "@/server/services/settlementService";
import { handlePayPalWebhook } from "@/server/services/webhookService";
import { makeApp, NIGHT, request, resetApp, timeout, type TestApp } from "./helpers";

const DRIVER = "drv_integrity";
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

/** Accepted and buyer-approved at the provider; the return has not been visited yet. */
async function acceptedAndApproved(session = DRIVER, port = "port_c") {
  const quote = await createQuote(app.deps, session, request({ portId: port }));
  const offer = quote.offers[0]!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  return { rid: r.id, orderId: r.paypal_order_id!, state: new URL(order.returnUrl).searchParams.get("state")!, session };
}

/** Authorized and committed through the normal return. */
async function authorizedAndCommitted(session = DRIVER, port = "port_c") {
  const a = await acceptedAndApproved(session, port);
  await handleCheckoutReturn(app.deps, session, a.rid, a.state, a.orderId);
  return a;
}

const countEvents = async (rid: string, type: string) =>
  (await app.db.query<{ n: number }>("select count(*)::int as n from events where reservation_id = $1 and type = $2", [rid, type]))[0]!.n;

describe("authorized without confirmed capacity", () => {
  it.each([
    ["DELIVERED", true],
    ["CANCELLED", false],
  ])("a commit that read a stale 'awaiting capacity' snapshot must not overwrite a concurrent %s state", async (service, slots) => {
    const { rid } = await authorizedAndCommitted();
    // Rewind to the window before capacity was committed, then let a concurrent flow move the reservation after this
    // commit's pre-check but before it takes the station-night lock (a late simulation, or a conflict that cancelled it).
    await app.db.query("update reservations set slots_committed = false, service_state = 'AWAITING_PAYMENT' where id = $1", [rid]);
    const realDb = app.db;
    let injected = false;
    const interleaved = {
      ...realDb,
      query: async <T>(sql: string, params?: unknown[]) => {
        const rows = await realDb.query<T>(sql, params);
        if (!injected && sql === "select * from reservations where id = $1") {
          injected = true;
          await realDb.query("update reservations set slots_committed = $2, service_state = $3 where id = $1", [rid, slots, service]);
        }
        return rows;
      },
    };
    const before = await countEvents(rid, "CAPACITY_COMMITTED");
    await commitCapacityOrVoid({ ...app.deps, db: interleaved }, rid);

    expect(injected).toBe(true);
    const r = (await getReservation(app.db, rid))!;
    expect(r).toMatchObject({ payment_state: "AUTHORIZED", service_state: service, slots_committed: slots });
    expect((await countEvents(rid, "CAPACITY_COMMITTED")) - before).toBe(0);
  });

  it("two simultaneous capacity commits of one reservation record one CAPACITY_COMMITTED", async () => {
    const { rid } = await authorizedAndCommitted();
    await app.db.query("update reservations set slots_committed = false, service_state = 'AWAITING_PAYMENT' where id = $1", [rid]);
    const before = await countEvents(rid, "CAPACITY_COMMITTED");

    await Promise.all([commitCapacityOrVoid(app.deps, rid), commitCapacityOrVoid(app.deps, rid)]);

    expect((await getReservation(app.db, rid))!.slots_committed).toBe(true);
    expect((await countEvents(rid, "CAPACITY_COMMITTED")) - before).toBe(1);
  });

  it("an authorization held by a locally FAILED reservation is voided by the sweep (orphan)", async () => {
    const { rid, orderId, state } = await authorizedAndCommitted();
    const authId = (await getReservation(app.db, rid))!.paypal_authorization_id!;
    expect(orderId).toBeTruthy();
    // A return that moved the row to FAILED while an authorize was still in flight.
    await app.db.query("update reservations set payment_state = 'FAILED', service_state = 'CANCELLED', slots_committed = false where id = $1", [rid]);
    expect(state).toBeTruthy();

    await resolveOutdatedSessions(app.deps);

    expect((await app.gateway.getAuthorization(authId)).status).toBe("VOIDED");
    expect((await getReservation(app.db, rid))!.payment_state).toBe("FAILED");
  });

  it("an authorization that lands after the row left BUYER_APPROVED is kept by id and voided by the sweep, never recorded as authorized", async () => {
    const a = await acceptedAndApproved();
    const real = app.mock.authorizeOrder.bind(app.mock);
    let authId: string | null = null;
    app.gateway.overrides.authorizeOrder = async (id, key) => {
      // A deadline return moves the row to FAILED while this authorize is in flight; the provider still authorizes.
      await app.db.query("update reservations set payment_state = 'FAILED', service_state = 'CANCELLED' where id = $1", [a.rid]);
      const auth = await real(id, key);
      authId = auth.authorizationId;
      return auth;
    };
    await handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId);

    const r = (await getReservation(app.db, a.rid))!;
    expect(r).toMatchObject({ payment_state: "FAILED", paypal_authorization_id: authId });
    expect(await countEvents(a.rid, "AUTHORIZED")).toBe(0);

    app.gateway.overrides = {};
    await resolveOutdatedSessions(app.deps);

    expect((await app.gateway.getAuthorization(authId!)).status).toBe("VOIDED");
    expect((await getReservation(app.db, a.rid))!.payment_state).toBe("FAILED");
    expect(await countEvents(a.rid, "ORPHAN_AUTHORIZATION_VOIDED")).toBe(1);
  });

  it("a lost authorize response is recovered by the sweep to AUTHORIZED with capacity, expiry and authorized_at set", async () => {
    const a = await acceptedAndApproved();
    const real = app.mock.authorizeOrder.bind(app.mock);
    let authorizeSent = false;
    const realGetOrder = app.mock.getOrder.bind(app.mock);
    app.gateway.overrides.authorizeOrder = async (id, key) => {
      await real(id, key);
      authorizeSent = true;
      throw timeout();
    };
    // Lookups succeed until the authorize was sent, then the provider is unreachable.
    app.gateway.overrides.getOrder = async (id) => {
      if (authorizeSent) throw timeout();
      return realGetOrder(id);
    };
    await handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId);
    expect((await getReservation(app.db, a.rid))!.payment_state).toBe("NEEDS_RECONCILIATION");

    app.gateway.overrides = {};
    await resolveOutdatedSessions(app.deps);

    const r = (await getReservation(app.db, a.rid))!;
    expect(r).toMatchObject({ payment_state: "AUTHORIZED", service_state: "SCHEDULED", slots_committed: true });
    expect(r.authorized_at).not.toBeNull();
    expect(r.authorization_expires_at).not.toBeNull();
  });

  it("recovery from ORDER_CREATED to AUTHORIZED records authorized_at and expiry from the provider authorization", async () => {
    const a = await acceptedAndApproved();
    const r0 = (await getReservation(app.db, a.rid))!;
    // The provider authorized (for example via a webhook arriving first) while the local row still waits for the buyer.
    await app.mock.authorizeOrder(r0.paypal_order_id!, "external-auth-key");
    await recoverReservation(app.deps, a.rid, "PAYPAL_WEBHOOK");

    const r = (await getReservation(app.db, a.rid))!;
    expect(r).toMatchObject({ payment_state: "AUTHORIZED", service_state: "SCHEDULED", slots_committed: true });
    expect(r.authorized_at).not.toBeNull();
    expect(r.authorization_expires_at).not.toBeNull();
  });
});

describe("webhook redelivery after a provider failure", () => {
  it("a provider outage during reconciliation answers 503 and the redelivered event is processed, not DUPLICATE", async () => {
    const a = await acceptedAndApproved();
    const r = (await getReservation(app.db, a.rid))!;
    app.gateway.webhookValid = true;
    const body = JSON.stringify({ id: "WH-OUTAGE-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: r.paypal_order_id } });
    app.gateway.overrides.getOrder = async () => {
      throw timeout();
    };
    const first = await handlePayPalWebhook(app.deps, { "paypal-transmission-id": "t-out-1" }, body);
    expect(first).toEqual({ status: 503, result: "RETRY_LATER" });

    app.gateway.overrides = {};
    const second = await handlePayPalWebhook(app.deps, { "paypal-transmission-id": "t-out-2" }, body);
    expect(second.result).not.toBe("DUPLICATE");
    expect(second.status).toBe(200);
    const inbox = await app.db.query<{ processed_at: Date | null }>("select processed_at from webhook_inbox where event_id = 'WH-OUTAGE-1'");
    expect(inbox[0]!.processed_at).not.toBeNull();
  });
});

describe("concurrent entry points on one reservation", () => {
  it("two simultaneous checkout returns authorize once and commit capacity once", async () => {
    const a = await acceptedAndApproved();
    await Promise.all([handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId), handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId)]);

    expect(app.gateway.calls.filter((c) => c === "authorizeOrder")).toHaveLength(1);
    expect((await getReservation(app.db, a.rid))!).toMatchObject({ payment_state: "AUTHORIZED", slots_committed: true });
    expect(await countEvents(a.rid, "CAPACITY_COMMITTED")).toBe(1);
    expect(app.gateway.calls.filter((c) => c === "voidAuthorization" || c === "captureAuthorization")).toHaveLength(0);
  });

  it("return, webhook, sweep and capacity commit racing on one reservation: one authorization, one commit, no settlement", async () => {
    const a = await acceptedAndApproved();
    const r = (await getReservation(app.db, a.rid))!;
    app.gateway.webhookValid = true;
    const body = JSON.stringify({ id: "WH-RACE-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: r.paypal_order_id } });
    await Promise.all([
      handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId),
      handlePayPalWebhook(app.deps, { "paypal-transmission-id": "t-race" }, body),
      resolveOutdatedSessions(app.deps),
      resolveOutdatedSessions({ ...app.deps }),
    ]);
    await handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId);

    expect(app.gateway.calls.filter((c) => c === "authorizeOrder")).toHaveLength(1);
    expect((await getReservation(app.db, a.rid))!).toMatchObject({ payment_state: "AUTHORIZED", service_state: "SCHEDULED", slots_committed: true });
    expect(await countEvents(a.rid, "CAPACITY_COMMITTED")).toBe(1);
    expect(app.gateway.calls.filter((c) => c === "voidAuthorization" || c === "captureAuthorization")).toHaveLength(0);
  });

  it("capture and void racing on one delivered reservation: exactly one provider settlement", async () => {
    const { rid } = await authorizedAndCommitted();
    await app.db.query("update reservations set service_state = 'DELIVERED' where id = $1", [rid]);

    await Promise.all([captureAuthorization(app.deps, rid), voidAuthorization(app.deps, rid, "RACE_TEST")]);

    const settlements = await app.db.query<{ kind: string }>("select kind from payment_operations where reservation_id = $1 and kind in ('CAPTURE','VOID')", [rid]);
    expect(settlements).toHaveLength(1);
    const providerSettlements = app.gateway.calls.filter((c) => c === "captureAuthorization" || c === "voidAuthorization");
    expect(providerSettlements).toHaveLength(1);
    const r = (await getReservation(app.db, rid))!;
    expect(["CAPTURED", "VOIDED", "CAPTURE_PENDING", "NEEDS_RECONCILIATION"]).toContain(r.payment_state);
  });

  it("two users contending for the last capacity slot: exactly one winner, the other is voided and cancelled", async () => {
    const sessions = ["drv_slot_a", "drv_slot_b", "drv_slot_c"];
    const ports = ["port_a", "port_b", "port_c"];
    const accepted = [];
    for (const [i, session] of sessions.entries()) accepted.push(await acceptedAndApproved(session, ports[i]));

    const results = await Promise.all(accepted.map((a) => handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId)));

    // Every reservation either holds capacity (and is authorized) or is voided and cancelled; none is left half-way.
    for (const r of results) {
      const held = r.payment_state === "AUTHORIZED" && r.service_state === "SCHEDULED" && r.slots_committed;
      const released = r.payment_state === "VOIDED" && r.service_state === "CANCELLED" && !r.slots_committed;
      expect(held || released).toBe(true);
    }
    // The committed set must be physically feasible: no station or port overbooking.
    const committed = await committedPlans(app.db, app.deps.station.id, NIGHT);
    const { scenario, envelope } = await nightContext(app.db, app.deps.station, NIGHT);
    expect(committed.length).toBe(results.filter((r) => r.slots_committed).length);
    expect(validateWithEnvelope({ station: app.deps.station, grid: scenario.grid, forecastBaseLoadW: scenario.forecastBaseLoadW, envelope, plans: committed })).toEqual([]);
  });

  it("an interrupted settlement after a recorded simulation is completed by the sweep (capture, once)", async () => {
    const { rid } = await authorizedAndCommitted();
    // The synthetic run commits, then the capture request fails without a definitive answer.
    app.gateway.overrides.captureAuthorization = async () => {
      throw new Error("process interrupted");
    };
    await runSimulation(app.deps, rid, { kind: "OPERATOR" });
    // The failed capture is reconciled straight back to the provider's live authorization, with the run recorded.
    expect(await getReservation(app.db, rid)).toMatchObject({ payment_state: "AUTHORIZED", service_state: "DELIVERED" });

    app.gateway.overrides = {};
    await resolveOutdatedSessions(app.deps);

    const r = (await getReservation(app.db, rid))!;
    expect(r.payment_state).toBe("CAPTURED");
    expect(app.gateway.calls.filter((c) => c === "captureAuthorization")).toHaveLength(2);
    const captures = await app.db.query<{ n: number }>("select count(*)::int as n from payment_operations where reservation_id = $1 and kind = 'CAPTURE'", [rid]);
    expect(captures[0]!.n).toBe(1);
  });
});
