import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ServiceError } from "@/server/deps";
import { getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutCancel, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { reconcileReservation } from "@/server/services/reconcileService";
import { captureAuthorization, runSimulation } from "@/server/services/settlementService";
import { recoverReservation } from "@/server/services/recoveryService";
import { handlePayPalWebhook } from "@/server/services/webhookService";
import { ProviderError } from "@/payments/gateway";
import { makeApp, request, resetApp, timeout, type TestApp } from "./helpers";

const DRIVER = "drv_1";
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

async function quoteAndAccept(session = DRIVER, overrides = {}) {
  const quote = await createQuote(app.deps, session, request(overrides));
  const offer = quote.offers[0]!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  return { quote, offer, accepted };
}

/** Buyer approves on the (mock) hosted page; returns the provider redirect parameters. */
async function approve(reservationId: string) {
  const r = (await getReservation(app.db, reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  return { orderId: r.paypal_order_id!, state };
}

async function authorized(session = DRIVER, overrides = {}) {
  const { accepted, offer } = await quoteAndAccept(session, overrides);
  const { orderId, state } = await approve(accepted.reservationId);
  const r = await handleCheckoutReturn(app.deps, session, accepted.reservationId, state, orderId);
  return { r, offer, state, orderId };
}

async function proofs(rid: string) {
  return app.db.query<{ proof_type: string; evidence_source: string; provider_status: string }>(
    "select proof_type, evidence_source, provider_status from provider_proofs where reservation_id = $1 order by observed_at, proof_type",
    [rid],
  );
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code } satisfies Partial<ServiceError>);
}

describe("happy path: approve → authorize → deliver → capture", () => {
  it("records each provider proof once and captures only after synthetic delivery", async () => {
    const { r, offer } = await authorized();
    expect(r.payment_state).toBe("AUTHORIZED");
    expect(r.service_state).toBe("SCHEDULED");
    expect(r.slots_committed).toBe(true);
    expect(r.amount_cents).toBe(offer.priceCents);
    expect(app.gateway.calls).not.toContain("captureAuthorization");

    const done = await runSimulation(app.deps, r.id, { kind: "DRIVER", session: DRIVER });
    expect(done.service_state).toBe("DELIVERED");
    expect(done.payment_state).toBe("CAPTURED");
    expect(done.paypal_capture_id).toMatch(/^MOCK-CAPTURE-/);
    expect((await proofs(r.id)).map((p) => p.proof_type).sort()).toEqual(["AUTHORIZED", "BUYER_APPROVED", "CAPTURED", "ORDER_CREATED"]);
    expect((await proofs(r.id)).every((p) => p.evidence_source === "MOCK_PROVIDER")).toBe(true);

    const energy = await app.db.query<{ source: string }>("select distinct source from energy_records where reservation_id = $1", [r.id]);
    expect(energy).toEqual([{ source: "SYNTHETIC" }]);

    // Idempotent: re-running simulation or capture never creates a second capture.
    await runSimulation(app.deps, r.id, { kind: "DRIVER", session: DRIVER });
    await captureAuthorization(app.deps, r.id);
    const captures = await app.db.query("select id from mock_provider_objects where kind = 'capture'");
    expect(captures).toHaveLength(1);
  });

  it("events table is append-only", async () => {
    const { r } = await authorized();
    await expect(app.db.query("update events set type = 'X' where reservation_id = $1", [r.id])).rejects.toThrow(/append-only/);
    await expect(app.db.query("delete from events where reservation_id = $1", [r.id])).rejects.toThrow(/append-only/);
  });
});

describe("failure path: outage → void, never capture", () => {
  it("voids the authorization on synthetic charger outage and releases capacity", async () => {
    const { r } = await authorized();
    const failed = await runSimulation(app.deps, r.id, { kind: "OPERATOR" }, { outage: { fromSlot: 0, toSlot: 200 } });
    expect(failed.service_state).toBe("FAILED");
    expect(failed.payment_state).toBe("VOIDED");
    expect(failed.slots_committed).toBe(false);
    expect((await proofs(r.id)).map((p) => p.proof_type)).toContain("VOIDED");
    // Capture after void is refused.
    const after = await captureAuthorization(app.deps, r.id);
    expect(after.payment_state).toBe("VOIDED");
    expect(app.gateway.calls).not.toContain("captureAuthorization");
  });

  it("drivers cannot inject faults or simulate someone else's reservation", async () => {
    const { r } = await authorized();
    await expectCode(runSimulation(app.deps, r.id, { kind: "DRIVER", session: DRIVER }, { outage: { fromSlot: 0, toSlot: 10 } }), "FORBIDDEN");
    await expectCode(runSimulation(app.deps, r.id, { kind: "DRIVER", session: "drv_intruder" }), "NOT_FOUND");
  });
});

describe("approval integrity", () => {
  it("rejects tampered terms hashes and expired quotes", async () => {
    const quote = await createQuote(app.deps, DRIVER, request());
    const offer = quote.offers[0]!;
    await expectCode(acceptOffer(app.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: "0".repeat(64), consent: true }), "TERMS_MISMATCH");
    app.clock.now = quote.expiresAtMs;
    await expectCode(acceptOffer(app.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true }), "QUOTE_EXPIRED");
  });

  it("does not reveal or accept another driver's quote", async () => {
    const quote = await createQuote(app.deps, DRIVER, request());
    const offer = quote.offers[0]!;
    await expectCode(acceptOffer(app.deps, "drv_other", { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true }), "QUOTE_NOT_FOUND");
  });

  it("double-click and concurrent accepts create exactly one reservation and one order", async () => {
    const quote = await createQuote(app.deps, DRIVER, request());
    const offer = quote.offers[0]!;
    const input = { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true as const };
    const results = await Promise.allSettled([acceptOffer(app.deps, DRIVER, input), acceptOffer(app.deps, DRIVER, input)]);
    expect(results.some((x) => x.status === "fulfilled")).toBe(true);
    const again = await acceptOffer(app.deps, DRIVER, input);
    const rows = await app.db.query("select id from reservations");
    expect(rows).toHaveLength(1);
    expect(again.reservationId).toBe((rows[0] as { id: string }).id);
    expect(await app.db.query("select id from mock_provider_objects where kind = 'order'")).toHaveLength(1);
  });

  it("rejects a forged checkout return (bad state, wrong session, wrong token)", async () => {
    const { accepted } = await quoteAndAccept();
    const { orderId, state } = await approve(accepted.reservationId);
    await expectCode(handleCheckoutReturn(app.deps, DRIVER, accepted.reservationId, "forged", orderId), "CHECKOUT_STATE_INVALID");
    await expectCode(handleCheckoutReturn(app.deps, "drv_other", accepted.reservationId, state, orderId), "CHECKOUT_STATE_INVALID");
    await expectCode(handleCheckoutReturn(app.deps, DRIVER, accepted.reservationId, state, "MOCK-ORDER-other"), "CHECKOUT_STATE_INVALID");
    expect((await getReservation(app.db, accepted.reservationId))!.payment_state).toBe("ORDER_CREATED");
  });

  it("does not authorize when the buyer has not approved", async () => {
    const { accepted } = await quoteAndAccept();
    const r = (await getReservation(app.db, accepted.reservationId))!;
    const order = await app.db.query<{ data: { returnUrl: string } }>("select data from mock_provider_objects where id = $1", [r.paypal_order_id]);
    const state = new URL(order[0]!.data.returnUrl).searchParams.get("state")!;
    const after = await handleCheckoutReturn(app.deps, DRIVER, r.id, state, r.paypal_order_id!);
    expect(after.payment_state).toBe("ORDER_CREATED");
    expect(app.gateway.calls).not.toContain("authorizeOrder");
  });

  it("stops before authorizing if the provider order amount differs from accepted terms", async () => {
    const { accepted } = await quoteAndAccept();
    const { orderId, state } = await approve(accepted.reservationId);
    const real = app.mock.getOrder.bind(app.mock);
    app.gateway.overrides.getOrder = async (id) => ({ ...(await real(id)), amountCents: 1 });
    await expectCode(handleCheckoutReturn(app.deps, DRIVER, accepted.reservationId, state, orderId), "PROVIDER_MISMATCH");
    expect((await getReservation(app.db, accepted.reservationId))!.payment_state).toBe("NEEDS_RECONCILIATION");
    expect(app.gateway.calls).not.toContain("authorizeOrder");
  });

  describe("payee merchant check (PayPal mode)", () => {
    const EXPECTED = "ABCDEFGH12345";
    const withMerchant = async (payee: string | null, expected: string | null) => {
      app.deps.expectedMerchantId = expected;
      const { accepted } = await quoteAndAccept();
      const { orderId, state } = await approve(accepted.reservationId);
      const real = app.mock.getOrder.bind(app.mock);
      app.gateway.overrides.getOrder = async (id) => ({ ...(await real(id)), payeeMerchantId: payee });
      return { rid: accepted.reservationId, run: () => handleCheckoutReturn(app.deps, DRIVER, accepted.reservationId, state, orderId) };
    };
    afterEach(() => {
      app.deps.expectedMerchantId = undefined;
    });

    it("authorizes when the provider names the configured merchant", async () => {
      const { run } = await withMerchant(EXPECTED, EXPECTED);
      expect((await run()).payment_state).toBe("AUTHORIZED");
    });

    it.each([
      ["a different merchant", "ZZZZZZZZ99999"],
      ["no payee at all", null],
    ])("stops before authorizing when the provider reports %s", async (_name, payee) => {
      const { rid, run } = await withMerchant(payee, EXPECTED);
      await expectCode(run(), "PROVIDER_MISMATCH");
      expect((await getReservation(app.db, rid))!.payment_state).toBe("NEEDS_RECONCILIATION");
      expect(app.gateway.calls).not.toContain("authorizeOrder");
    });

    it.each([
      ["a different merchant", "ZZZZZZZZ99999"],
      ["no payee at all", null],
    ])("also stops when the approval was recorded first by reconciliation (webhook before return) and the provider reports %s", async (_name, payee) => {
      const { rid, run } = await withMerchant(payee, EXPECTED);
      // CHECKOUT.ORDER.APPROVED can arrive before the buyer's browser returns; recovery then advances the state itself.
      await recoverReservation(app.deps, rid, "RECONCILER");
      expect((await getReservation(app.db, rid))!.payment_state).toBe("BUYER_APPROVED");
      await expectCode(run(), "PROVIDER_MISMATCH");
      expect((await getReservation(app.db, rid))!.payment_state).toBe("NEEDS_RECONCILIATION");
      expect(app.gateway.calls).not.toContain("authorizeOrder");
    });

    it("authorizes after an early reconciliation when the provider names the configured merchant", async () => {
      const { rid, run } = await withMerchant(EXPECTED, EXPECTED);
      await recoverReservation(app.deps, rid, "RECONCILER");
      expect((await run()).payment_state).toBe("AUTHORIZED");
      expect(app.gateway.calls.filter((c) => c === "authorizeOrder")).toHaveLength(1);
    });

    it("does not apply in MOCK mode, where no expected merchant is configured", async () => {
      const { run } = await withMerchant(null, null);
      expect((await run()).payment_state).toBe("AUTHORIZED");
    });
  });

  it("buyer cancel leaves no authorization", async () => {
    const { accepted } = await quoteAndAccept();
    const r = (await getReservation(app.db, accepted.reservationId))!;
    const order = await app.db.query<{ data: { cancelUrl: string } }>("select data from mock_provider_objects where id = $1", [r.paypal_order_id]);
    const state = new URL(order[0]!.data.cancelUrl).searchParams.get("state")!;
    const after = await handleCheckoutCancel(app.deps, DRIVER, r.id, state);
    expect(after.payment_state).toBe("CANCELLED");
  });
});

describe("capacity", () => {
  it("voids an authorization that would overbook station kW and never double-books", async () => {
    // Three drivers all want the same cheap overnight window on different ports.
    const quotes = [];
    for (const [i, port] of ["port_a", "port_b", "port_c"].entries()) {
      const quote = await createQuote(app.deps, `drv_${i}`, request({ portId: port, targetBatteryKWh: 45 }));
      quotes.push({ quote, session: `drv_${i}` });
    }
    // All three accept while nothing is committed yet (each passes the accept-time recheck)...
    const accepted = [];
    for (const { quote, session } of quotes) {
      const offer = quote.offers[0]!;
      accepted.push({ session, res: await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true }) });
    }
    // ...then buyers approve; the atomic commit after authorization must catch the overbooking.
    const results = [];
    for (const { session, res } of accepted) {
      const { orderId, state } = await approve(res.reservationId);
      results.push(await handleCheckoutReturn(app.deps, session, res.reservationId, state, orderId));
    }
    const states = results.map((r) => `${r.payment_state}/${r.service_state}`);
    expect(states[0]).toBe("AUTHORIZED/SCHEDULED");
    expect(states.some((s) => s === "VOIDED/CANCELLED")).toBe(true);
    const events = await app.db.query<{ type: string }>("select type from events where type = 'CAPACITY_CONFLICT'");
    expect(events.length).toBeGreaterThan(0);
  });

  it("refuses a request on a port already occupied by a committed parked vehicle", async () => {
    await authorized();
    const quote = await createQuote(app.deps, "drv_2", request({ plugInLocal: "21:00" }));
    expect(quote.baseline.feasible).toBe(false);
    expect(quote.baseline.reason).toMatch(/PORT_OCCUPIED/);
    expect(quote.offers).toEqual([]);
  });
});

describe("provider ambiguity and reconciliation", () => {
  it("capture timeout after provider applied it → reconciliation finds the single capture", async () => {
    const { r } = await authorized();
    const real = app.mock.captureAuthorization.bind(app.mock);
    let first = true;
    app.gateway.overrides.captureAuthorization = async (...args) => {
      const out = await real(...args);
      if (first) {
        first = false;
        throw timeout();
      }
      return out;
    };
    const done = await runSimulation(app.deps, r.id, { kind: "DRIVER", session: DRIVER });
    expect(done.payment_state).toBe("CAPTURED");
    expect(await app.db.query("select id from mock_provider_objects where kind = 'capture'")).toHaveLength(1);
    const ops = await app.db.query<{ kind: string; status: string }>("select kind, status from payment_operations where reservation_id = $1 and kind = 'CAPTURE'", [r.id]);
    expect(ops).toEqual([{ kind: "CAPTURE", status: "AMBIGUOUS" }]);
  });

  it("authorization expiry routes to reconciliation instead of capturing", async () => {
    const { r } = await authorized();
    app.clock.now = r.authorization_expires_at!.getTime() + 1;
    await expectCode(runSimulation(app.deps, r.id, { kind: "DRIVER", session: DRIVER }), "AUTHORIZATION_EXPIRED");
    expect((await getReservation(app.db, r.id))!.payment_state).toBe("NEEDS_RECONCILIATION");
    expect(app.gateway.calls).not.toContain("captureAuthorization");
  });

  it("reconcile with provider unavailable changes nothing", async () => {
    const { r } = await authorized();
    app.gateway.overrides.getAuthorization = async () => {
      throw timeout();
    };
    const after = await reconcileReservation(app.deps, r.id, "RECONCILER");
    expect(after.payment_state).toBe("AUTHORIZED");
  });
});

describe("webhooks", () => {
  const headers = { "paypal-transmission-id": "t1" };

  it("rejects unverified webhooks without touching state or inbox", async () => {
    const { r } = await authorized();
    const out = await handlePayPalWebhook(app.deps, headers, JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: r.paypal_authorization_id } }));
    expect(out).toEqual({ status: 401, result: "REJECTED" });
    expect(await app.db.query("select * from webhook_inbox")).toHaveLength(0);
    expect((await getReservation(app.db, r.id))!.payment_state).toBe("AUTHORIZED");
  });

  it("a verified webhook claiming capture does not mark CAPTURED unless the provider API agrees", async () => {
    const { r } = await authorized();
    app.gateway.webhookValid = true;
    const out = await handlePayPalWebhook(app.deps, headers, JSON.stringify({ id: "WH-2", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: r.paypal_authorization_id } }));
    expect(out.result).toBe("PROCESSED");
    expect((await getReservation(app.db, r.id))!.payment_state).toBe("AUTHORIZED");
  });

  it("de-duplicates replayed events", async () => {
    const { r } = await authorized();
    app.gateway.webhookValid = true;
    const body = JSON.stringify({ id: "WH-3", event_type: "PAYMENT.AUTHORIZATION.CREATED", resource: { id: r.paypal_authorization_id } });
    expect((await handlePayPalWebhook(app.deps, headers, body)).result).toBe("PROCESSED");
    expect((await handlePayPalWebhook(app.deps, headers, body)).result).toBe("DUPLICATE");
  });

  it("stale events arriving after capture or void never downgrade the final state", async () => {
    const { r } = await authorized();
    await runSimulation(app.deps, r.id, { kind: "OPERATOR" });
    expect((await getReservation(app.db, r.id))!.payment_state).toBe("CAPTURED");
    app.gateway.webhookValid = true;
    for (const [i, type] of ["PAYMENT.AUTHORIZATION.CREATED", "CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.PENDING"].entries()) {
      const body = JSON.stringify({ id: `WH-STALE-${i}`, event_type: type, resource: { id: r.paypal_authorization_id } });
      expect((await handlePayPalWebhook(app.deps, headers, body)).result).toBe("PROCESSED");
    }
    const after = (await getReservation(app.db, r.id))!;
    expect(after.payment_state).toBe("CAPTURED");
    expect(await app.db.query("select id from mock_provider_objects where kind = 'capture'")).toHaveLength(1);

    const { r: v } = await authorized(DRIVER, { portId: "port_b" });
    await runSimulation(app.deps, v.id, { kind: "OPERATOR" }, { outage: { fromSlot: 0, toSlot: 200 } });
    const stale = JSON.stringify({ id: "WH-STALE-V", event_type: "PAYMENT.AUTHORIZATION.CREATED", resource: { id: v.paypal_authorization_id } });
    expect((await handlePayPalWebhook(app.deps, headers, stale)).result).toBe("PROCESSED");
    expect((await getReservation(app.db, v.id))!.payment_state).toBe("VOIDED");
  });

  it("an out-of-order authorization webhook (before buyer return) advances state from provider truth", async () => {
    const { accepted } = await quoteAndAccept();
    const { orderId, state } = await approve(accepted.reservationId);
    const auth = await app.mock.authorizeOrder(orderId, `${accepted.reservationId}:AUTHORIZE`);
    app.gateway.webhookValid = true;
    const body = JSON.stringify({ id: "WH-4", event_type: "PAYMENT.AUTHORIZATION.CREATED", resource: { id: auth.authorizationId, supplementary_data: { related_ids: { order_id: orderId } } } });
    expect((await handlePayPalWebhook(app.deps, headers, body)).result).toBe("PROCESSED");
    const mid = (await getReservation(app.db, accepted.reservationId))!;
    expect(mid.payment_state).toBe("AUTHORIZED");
    // Recovery commits capacity and records the provider expiry without waiting for the buyer return.
    expect(mid.slots_committed).toBe(true);
    expect(mid.authorization_expires_at).not.toBeNull();
    // Delayed buyer return is idempotent: no second authorization.
    const after = await handleCheckoutReturn(app.deps, DRIVER, accepted.reservationId, state, orderId);
    expect(after.slots_committed).toBe(true);
    expect(await app.db.query("select id from mock_provider_objects where kind = 'authorization'")).toHaveLength(1);
  });

  it("rejects oversized payloads", async () => {
    app.gateway.webhookValid = true;
    const out = await handlePayPalWebhook(app.deps, headers, "x".repeat(70_000));
    expect(out.status).toBe(413);
  });
});

describe("review regressions", () => {
  it("#1 settlement interrupted after the synthetic run is completed by a later call (single capture)", async () => {
    const { r } = await authorized();
    app.gateway.overrides.captureAuthorization = async () => {
      throw timeout(); // provider never saw it
    };
    const stuck = await runSimulation(app.deps, r.id, { kind: "DRIVER", session: DRIVER });
    expect(stuck.service_state).toBe("DELIVERED");
    expect(stuck.payment_state).toBe("AUTHORIZED");
    delete app.gateway.overrides.captureAuthorization;
    const done = await runSimulation(app.deps, r.id, { kind: "DRIVER", session: DRIVER });
    expect(done.payment_state).toBe("CAPTURED");
    expect(await app.db.query("select id from mock_provider_objects where kind = 'capture'")).toHaveLength(1);
  });

  it("#3 webhook is retried (503) while the provider is unreachable and processed on redelivery", async () => {
    const { r } = await authorized();
    app.gateway.webhookValid = true;
    app.gateway.overrides.getAuthorization = async () => {
      throw timeout();
    };
    const body = JSON.stringify({ id: "WH-R3", event_type: "PAYMENT.AUTHORIZATION.CREATED", resource: { id: r.paypal_authorization_id } });
    expect(await handlePayPalWebhook(app.deps, { "paypal-transmission-id": "t" }, body)).toEqual({ status: 503, result: "RETRY_LATER" });
    delete app.gateway.overrides.getAuthorization;
    expect((await handlePayPalWebhook(app.deps, { "paypal-transmission-id": "t" }, body)).result).toBe("PROCESSED");
    expect((await handlePayPalWebhook(app.deps, { "paypal-transmission-id": "t" }, body)).result).toBe("DUPLICATE");
  });

  it("#5 unverified webhooks write nothing to the database", async () => {
    const before = await app.db.query("select count(*)::int as n from events");
    await handlePayPalWebhook(app.deps, {}, JSON.stringify({ id: "WH-X", event_type: "X" }));
    expect(await app.db.query("select count(*)::int as n from events")).toEqual(before);
  });

  it("#6 a 4xx from authorize after the provider already authorized does not strand a live authorization", async () => {
    const { accepted } = await quoteAndAccept();
    const { orderId, state } = await approve(accepted.reservationId);
    const real = app.mock.authorizeOrder.bind(app.mock);
    app.gateway.overrides.authorizeOrder = async (id, key) => {
      await real(id, key);
      throw new ProviderError("HTTP_4XX", "ORDER_ALREADY_AUTHORIZED", 422, undefined, "ORDER_ALREADY_AUTHORIZED");
    };
    const after = await handleCheckoutReturn(app.deps, DRIVER, accepted.reservationId, state, orderId);
    expect(after.payment_state).toBe("AUTHORIZED");
    expect(after.slots_committed).toBe(true);
  });

  it("#7 failed void after a capacity conflict never re-commits capacity and is retried by recovery", async () => {
    const quotes = [];
    for (const [i, port] of ["port_a", "port_b", "port_c"].entries()) {
      quotes.push({ session: `drv_${i}`, quote: await createQuote(app.deps, `drv_${i}`, request({ portId: port, targetBatteryKWh: 45 })) });
    }
    const accepted = [];
    for (const { quote, session } of quotes) {
      const offer = quote.offers[0]!;
      accepted.push({ session, res: await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true }) });
    }
    app.gateway.overrides.voidAuthorization = async () => {
      throw timeout();
    };
    const results = [];
    for (const { session, res } of accepted) {
      const { orderId, state } = await approve(res.reservationId);
      results.push({ session, state, orderId, r: await handleCheckoutReturn(app.deps, session, res.reservationId, state, orderId) });
    }
    const loser = results.find((x) => x.r.service_state === "CANCELLED")!;
    expect(loser).toBeDefined();
    expect(loser.r.slots_committed).toBe(false);
    // Revisit while void still failing: stays CANCELLED, never SCHEDULED.
    const revisit = await handleCheckoutReturn(app.deps, loser.session, loser.r.id, loser.state, loser.orderId);
    expect(revisit.service_state).toBe("CANCELLED");
    expect(revisit.slots_committed).toBe(false);
    delete app.gateway.overrides.voidAuthorization;
    const healed = await recoverReservation(app.deps, loser.r.id, "OPERATOR");
    expect(healed.reservation.payment_state).toBe("VOIDED");
  });
});
