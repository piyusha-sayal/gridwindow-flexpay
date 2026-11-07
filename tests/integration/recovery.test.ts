/**
 * Crash-safe order creation (finding #9) and provider-aware settlement recovery (finding #10).
 * MOCK provider only: proves application logic, not PayPal behavior.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PAYPAL_REQUEST_ID_RETENTION_MS, ProviderError } from "@/payments/gateway";
import type { Queryable } from "@/server/db/client";
import type { AppDeps, ServiceError } from "@/server/deps";
import { getReservation, OPERATION_LEASE_MS } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { assertReplayWindowWithinRetention } from "@/server/services/orderCreationService";
import { createQuote } from "@/server/services/quoteService";
import { recoverPendingReservations, recoverReservation } from "@/server/services/recoveryService";
import { captureAuthorization, runSimulation, settleFromExistingRun } from "@/server/services/settlementService";
import { reservationView } from "@/server/services/viewService";
import { handlePayPalWebhook } from "@/server/services/webhookService";
import { makeApp, request, resetApp, timeout, type TestApp } from "./helpers";

const DRIVER = "drv_r";
const HEADERS = { "paypal-transmission-id": "t" };
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

const never = <T>() => new Promise<T>(() => undefined);
const count = async (sql: string, params: unknown[] = []) => (await app.db.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`, params))[0]!.n;
const mockOrders = () => count("select id from mock_provider_objects where kind = 'order'");
const mockCaptures = () => count("select id from mock_provider_objects where kind = 'capture'");
const calls = (name: string) => app.gateway.calls.filter((c) => c === name).length;
const state = async (rid: string) => (await getReservation(app.db, rid))!;

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code } satisfies Partial<ServiceError>);
}

async function newQuote() {
  const quote = await createQuote(app.deps, DRIVER, request());
  const offer = quote.offers[0]!;
  return { quote, offer, input: { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true as const } };
}

/** Starts acceptOffer, lets it commit its DB writes, and abandons it mid provider call (simulated process death). */
async function crashDuringCreateOrder(afterProviderSuccess: boolean) {
  const real = app.mock.createOrder.bind(app.mock);
  app.gateway.overrides.createOrder = async (i) => {
    if (afterProviderSuccess) await real(i);
    return never();
  };
  const { input, offer } = await newQuote();
  void acceptOffer(app.deps, DRIVER, input).catch(() => undefined);
  for (let i = 0; i < 200 && calls("createOrder") === 0; i++) await new Promise((r) => setTimeout(r, 5));
  for (let i = 0; i < 200 && afterProviderSuccess && (await mockOrders()) === 0; i++) await new Promise((r) => setTimeout(r, 5));
  const rid = (await app.db.query<{ id: string }>("select id from reservations where offer_id = $1", [offer.offerId]))[0]!.id;
  delete app.gateway.overrides.createOrder; // the "restarted" process talks to a healthy provider
  return { rid, input };
}

async function authorized() {
  const { input } = await newQuote();
  const accepted = await acceptOffer(app.deps, DRIVER, input);
  const r = await state(accepted.reservationId);
  const order = await app.mock.approve(r.paypal_order_id!);
  const st = new URL(order.returnUrl).searchParams.get("state")!;
  return handleCheckoutReturn(app.deps, DRIVER, r.id, st, r.paypal_order_id!);
}

async function setCapture(captureId: string, patch: Record<string, string>) {
  for (const [k, v] of Object.entries(patch)) {
    await app.db.query("update mock_provider_objects set data = jsonb_set(data, $2::text[], to_jsonb($3::text)) where id = $1", [captureId, `{${k}}`, v]);
  }
}

/** Authorized + delivered; the provider reports the new capture with `status`. */
async function deliveredWithCaptureStatus(status: string) {
  const r = await authorized();
  const real = app.mock.captureAuthorization.bind(app.mock);
  app.gateway.overrides.captureAuthorization = async (...args) => {
    const cap = await real(...args);
    await setCapture(cap.captureId, { status });
    return { ...cap, status };
  };
  const after = await runSimulation(app.deps, r.id, { kind: "DRIVER", session: DRIVER });
  delete app.gateway.overrides.captureAuthorization;
  return after;
}

const captureWebhook = (id: string, eventType: string, captureId: string) => JSON.stringify({ id, event_type: eventType, resource: { id: captureId } });

describe("#9 crash-safe order creation", () => {
  it("persists the operation, payload and offer binding before the provider call", async () => {
    const { rid } = await crashDuringCreateOrder(false);
    const r = await state(rid);
    expect(r.payment_state).toBe("QUOTE_ACCEPTED");
    const [op] = await app.db.query<{ status: string; request: { amountCents: number }; terms_hash: string; amount_cents: number; lease_until: Date | null }>(
      "select status, request, terms_hash, amount_cents, lease_until from payment_operations where reservation_id = $1 and kind = 'CREATE_ORDER'",
      [rid],
    );
    expect(op).toMatchObject({ status: "STARTED", terms_hash: r.terms_hash, amount_cents: r.amount_cents });
    expect(op!.request.amountCents).toBe(r.amount_cents);
    expect(op!.lease_until).not.toBeNull();
  });

  it("crash before PayPal responds: recovery after restart creates exactly one order and the buyer can finish", async () => {
    const { rid, input } = await crashDuringCreateOrder(false);
    // While the crashed worker's lease is live, nobody calls the provider again.
    await recoverReservation(app.deps, rid, "RECONCILER");
    expect(calls("createOrder")).toBe(1);

    app.clock.now += OPERATION_LEASE_MS + 1;
    expect(await recoverPendingReservations(app.deps)).toEqual({ attempted: 1, failed: 0 });
    const r = await state(rid);
    expect(r.payment_state).toBe("ORDER_CREATED");
    expect(await mockOrders()).toBe(1);

    // Driver retry returns the recovered order rather than a new one.
    const retry = await acceptOffer(app.deps, DRIVER, input);
    expect(retry.approveUrl).toBe(r.approve_url);
    const order = await app.mock.approve(r.paypal_order_id!);
    const after = await handleCheckoutReturn(app.deps, DRIVER, rid, new URL(order.returnUrl).searchParams.get("state")!, r.paypal_order_id!);
    expect(after.payment_state).toBe("AUTHORIZED");
  });

  it("crash after provider success but before DB commit: same-key replay recovers the existing order", async () => {
    const { rid } = await crashDuringCreateOrder(true);
    expect(await mockOrders()).toBe(1);
    app.clock.now += OPERATION_LEASE_MS + 1;
    const { reservation } = await recoverReservation(app.deps, rid, "RECONCILER");
    expect(reservation.payment_state).toBe("ORDER_CREATED");
    expect(await mockOrders()).toBe(1);
    const proofs = await count("select 1 from provider_proofs where reservation_id = $1 and proof_type = 'ORDER_CREATED'", [rid]);
    expect(proofs).toBe(1);
  });

  it("repeated and parallel recovery workers make one provider call and one order", async () => {
    const { rid, input } = await crashDuringCreateOrder(true);
    app.clock.now += OPERATION_LEASE_MS + 1;
    const results = await Promise.allSettled([
      recoverReservation(app.deps, rid, "RECONCILER"),
      recoverReservation(app.deps, rid, "RECONCILER"),
      recoverPendingReservations(app.deps),
      acceptOffer(app.deps, DRIVER, input),
    ]);
    expect(results.filter((x) => x.status === "rejected").every((x) => (x as PromiseRejectedResult).reason.code === "CHECKOUT_PENDING")).toBe(true);
    for (let i = 0; i < 3; i++) await recoverReservation(app.deps, rid, "RECONCILER");
    expect(calls("createOrder")).toBe(2); // the crashed attempt + exactly one replay
    expect(await mockOrders()).toBe(1);
    expect((await state(rid)).payment_state).toBe("ORDER_CREATED");
  });

  it("expired accepted quote: never replays, cancels with no order shown and no capacity held", async () => {
    const { rid, input } = await crashDuringCreateOrder(false);
    app.clock.now += app.deps.quoteTtlMs + OPERATION_LEASE_MS;
    await recoverReservation(app.deps, rid, "RECONCILER");
    const r = await state(rid);
    expect(r).toMatchObject({ payment_state: "CANCELLED", service_state: "CANCELLED", slots_committed: false, paypal_order_id: null, approve_url: null });
    expect(calls("createOrder")).toBe(1);
    await expectCode(acceptOffer(app.deps, DRIVER, input), "QUOTE_EXPIRED");
    expect(await count("select 1 from events where reservation_id = $1 and type = 'ORDER_CREATION_ABANDONED'", [rid])).toBe(1);
  });

  it("ambiguous create recovered after PayPal's 6 h request-id retention: no new order, fails closed to manual review", async () => {
    const { rid } = await crashDuringCreateOrder(true); // provider created an order whose response was lost
    app.clock.now += PAYPAL_REQUEST_ID_RETENTION_MS + OPERATION_LEASE_MS;
    for (let i = 0; i < 3; i++) await recoverReservation(app.deps, rid, "RECONCILER");
    await recoverPendingReservations(app.deps);
    expect(calls("createOrder")).toBe(1); // only the original attempt; a late replay could open a second order
    expect(await mockOrders()).toBe(1);
    expect(await state(rid)).toMatchObject({ payment_state: "CANCELLED", service_state: "CANCELLED", slots_committed: false, paypal_order_id: null, approve_url: null });
    expect(await count("select 1 from events where reservation_id = $1 and type = 'MANUAL_REVIEW_REQUIRED' and payload->>'reason' like 'ambiguous order creation%'", [rid])).toBe(1);
  });

  it("a lost create response that lands after abandonment is recorded for review, never linked or duplicated", async () => {
    const real = app.mock.createOrder.bind(app.mock);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    app.gateway.overrides.createOrder = async (i) => {
      await gate; // response is "in flight" until the test releases it
      return real(i);
    };
    const { input, offer } = await newQuote();
    const inFlight = acceptOffer(app.deps, DRIVER, input).catch(() => undefined);
    for (let i = 0; i < 200 && calls("createOrder") === 0; i++) await new Promise((r) => setTimeout(r, 5));
    const rid = (await app.db.query<{ id: string }>("select id from reservations where offer_id = $1", [offer.offerId]))[0]!.id;
    app.clock.now += PAYPAL_REQUEST_ID_RETENTION_MS + OPERATION_LEASE_MS;
    await recoverReservation(app.deps, rid, "RECONCILER"); // abandons: quote expired, retention passed
    expect((await state(rid)).payment_state).toBe("CANCELLED");
    release();
    await inFlight;
    delete app.gateway.overrides.createOrder;
    await recoverPendingReservations(app.deps);
    const r = await state(rid);
    expect(r).toMatchObject({ payment_state: "CANCELLED", paypal_order_id: null, approve_url: null, slots_committed: false });
    expect(calls("createOrder")).toBe(1);
    expect(await mockOrders()).toBe(1);
    const orderId = (await app.db.query<{ id: string }>("select id from mock_provider_objects where kind = 'order'"))[0]!.id;
    // Correlation survives for manual investigation: operation row and an explicit event both name the order.
    const [op] = await app.db.query<{ provider_ref: string; idempotency_key: string }>("select provider_ref, idempotency_key from payment_operations where reservation_id = $1 and kind = 'CREATE_ORDER'", [rid]);
    expect(op).toEqual({ provider_ref: orderId, idempotency_key: `${rid}:CREATE_ORDER` });
    expect(await count("select 1 from events where reservation_id = $1 and type = 'ORDER_CREATED_AFTER_ABANDONMENT' and payload->>'orderId' = $2", [rid, orderId])).toBe(1);
    expect(await count("select 1 from provider_proofs where reservation_id = $1", [rid])).toBe(0);
  });

  it("the replay window always ends inside the provider's idempotency-key retention", () => {
    expect(() => assertReplayWindowWithinRetention(app.deps.quoteTtlMs)).not.toThrow();
    expect(() => assertReplayWindowWithinRetention(PAYPAL_REQUEST_ID_RETENTION_MS)).toThrow(/retention/);
  });

  it("provider timeout followed by a successful same-key lookup", async () => {
    const real = app.mock.createOrder.bind(app.mock);
    app.gateway.overrides.createOrder = async (i) => {
      await real(i);
      throw timeout();
    };
    const { input } = await newQuote();
    await expectCode(acceptOffer(app.deps, DRIVER, input), "CHECKOUT_PENDING");
    const rid = (await app.db.query<{ id: string }>("select id from reservations"))[0]!.id;
    expect((await state(rid)).payment_state).toBe("NEEDS_RECONCILIATION");
    delete app.gateway.overrides.createOrder;
    const retry = await acceptOffer(app.deps, DRIVER, input); // lease was released on the ambiguous outcome
    expect(retry.reservationId).toBe(rid);
    expect(await mockOrders()).toBe(1);
    const [op] = await app.db.query<{ status: string; attempts: number }>("select status, attempts from payment_operations where reservation_id = $1 and kind = 'CREATE_ORDER'", [rid]);
    expect(op).toEqual({ status: "SUCCEEDED", attempts: 2 });
  });

  it("a definitive provider rejection fails closed and is never replayed", async () => {
    app.gateway.overrides.createOrder = async () => {
      throw new ProviderError("HTTP_4XX", "bad request", 422, undefined, "UNPROCESSABLE_ENTITY");
    };
    const { input } = await newQuote();
    await expectCode(acceptOffer(app.deps, DRIVER, input), "PROVIDER_UNAVAILABLE");
    const rid = (await app.db.query<{ id: string }>("select id from reservations"))[0]!.id;
    delete app.gateway.overrides.createOrder;
    app.clock.now += OPERATION_LEASE_MS + 1;
    await recoverPendingReservations(app.deps);
    expect((await state(rid)).payment_state).toBe("FAILED");
    expect(calls("createOrder")).toBe(1);
  });

  it("accepted terms are immutable at the database level", async () => {
    const r = await authorized();
    await expect(app.db.query("update reservations set amount_cents = amount_cents + 1 where id = $1", [r.id])).rejects.toThrow(/immutable/);
    await expect(app.db.query("update reservations set terms = '{}'::jsonb where id = $1", [r.id])).rejects.toThrow(/immutable/);
  });
});

describe("#10 provider-aware settlement", () => {
  it("PENDING capture stays pending (no receipt, no second capture) and completes from a verified webhook", async () => {
    const pending = await deliveredWithCaptureStatus("PENDING");
    expect(pending.payment_state).toBe("CAPTURE_PENDING");
    expect(pending.paypal_capture_id).toMatch(/^MOCK-CAPTURE-/);
    const view = await reservationView(app.deps, pending.id, { operator: true });
    expect(view.proofs.some((p) => p.type === "CAPTURED")).toBe(false);

    // Retries, re-simulation and recovery never submit another capture while pending.
    await runSimulation(app.deps, pending.id, { kind: "DRIVER", session: DRIVER });
    await captureAuthorization(app.deps, pending.id);
    await recoverReservation(app.deps, pending.id, "RECONCILER");
    expect(calls("captureAuthorization")).toBe(1);
    expect((await state(pending.id)).payment_state).toBe("CAPTURE_PENDING");

    await setCapture(pending.paypal_capture_id!, { status: "COMPLETED" });
    app.gateway.webhookValid = true;
    const body = captureWebhook("WH-P1", "PAYMENT.CAPTURE.COMPLETED", pending.paypal_capture_id!);
    expect((await handlePayPalWebhook(app.deps, HEADERS, body)).result).toBe("PROCESSED");
    const done = await state(pending.id);
    expect(done.payment_state).toBe("CAPTURED");
    expect(done.slots_committed).toBe(false);
    expect(await count("select 1 from provider_proofs where reservation_id = $1 and proof_type = 'CAPTURED'", [done.id])).toBe(1);
    expect(await mockCaptures()).toBe(1);

    // Duplicate and out-of-order (stale PENDING) callbacks change nothing.
    expect((await handlePayPalWebhook(app.deps, HEADERS, body)).result).toBe("DUPLICATE");
    expect((await handlePayPalWebhook(app.deps, HEADERS, captureWebhook("WH-P0", "PAYMENT.CAPTURE.PENDING", done.paypal_capture_id!))).result).toBe("PROCESSED");
    expect((await state(done.id)).payment_state).toBe("CAPTURED");
  });

  it("DECLINED capture is final for automation: no retry, no receipt, capacity released", async () => {
    const declined = await deliveredWithCaptureStatus("DECLINED");
    expect(declined).toMatchObject({ payment_state: "CAPTURE_DECLINED", slots_committed: false });
    await recoverReservation(app.deps, declined.id, "RECONCILER");
    await captureAuthorization(app.deps, declined.id);
    await recoverPendingReservations(app.deps);
    expect(calls("captureAuthorization")).toBe(1);
    expect(await count("select 1 from provider_proofs where reservation_id = $1 and proof_type in ('CAPTURED','VOIDED')", [declined.id])).toBe(0);
  });

  it("FAILED capture status maps to CAPTURE_DECLINED; unknown status fails closed", async () => {
    expect((await deliveredWithCaptureStatus("FAILED")).payment_state).toBe("CAPTURE_DECLINED");
    await resetApp(app);
    expect((await deliveredWithCaptureStatus("SOMETHING_NEW")).payment_state).toBe("NEEDS_RECONCILIATION");
  });

  it("a capture linked to a different authorization is never finalized", async () => {
    const r = await authorized();
    const real = app.mock.captureAuthorization.bind(app.mock);
    app.gateway.overrides.captureAuthorization = async (...args) => {
      const cap = await real(...args);
      await setCapture(cap.captureId, { authorizationId: "MOCK-AUTH-someone-else" });
      return cap;
    };
    const after = await runSimulation(app.deps, r.id, { kind: "DRIVER", session: DRIVER });
    expect(after.payment_state).toBe("NEEDS_RECONCILIATION");
    expect(await count("select 1 from provider_proofs where reservation_id = $1 and proof_type = 'CAPTURED'", [r.id])).toBe(0);
  });

  it("lookup timeout while pending keeps the webhook unacknowledged (503) and a restart sweep completes it", async () => {
    const pending = await deliveredWithCaptureStatus("PENDING");
    await setCapture(pending.paypal_capture_id!, { status: "COMPLETED" });
    app.gateway.webhookValid = true;
    app.gateway.overrides.getCapture = async () => {
      throw timeout();
    };
    const body = captureWebhook("WH-T1", "PAYMENT.CAPTURE.COMPLETED", pending.paypal_capture_id!);
    expect(await handlePayPalWebhook(app.deps, HEADERS, body)).toEqual({ status: 503, result: "RETRY_LATER" });
    expect((await state(pending.id)).payment_state).toBe("CAPTURE_PENDING");
    delete app.gateway.overrides.getCapture;
    await recoverPendingReservations(app.deps); // server restart
    expect((await state(pending.id)).payment_state).toBe("CAPTURED");
    expect((await handlePayPalWebhook(app.deps, HEADERS, body)).result).toBe("PROCESSED"); // redelivery is still accepted
    expect(calls("captureAuthorization")).toBe(1);
  });

  it("simultaneous settlement workers submit one capture", async () => {
    const r = await authorized();
    app.gateway.overrides.captureAuthorization = async () => {
      throw timeout(); // provider never saw it; run recorded, settlement interrupted
    };
    const delivered = await runSimulation(app.deps, r.id, { kind: "DRIVER", session: DRIVER });
    expect(delivered).toMatchObject({ payment_state: "AUTHORIZED", service_state: "DELIVERED" });
    delete app.gateway.overrides.captureAuthorization;
    await Promise.all([
      captureAuthorization(app.deps, r.id),
      captureAuthorization(app.deps, r.id),
      settleFromExistingRun(app.deps, r.id),
      runSimulation(app.deps, r.id, { kind: "OPERATOR" }),
      recoverReservation(app.deps, r.id, "RECONCILER"),
    ]);
    await recoverReservation(app.deps, r.id, "RECONCILER");
    expect((await state(r.id)).payment_state).toBe("CAPTURED");
    expect(await mockCaptures()).toBe(1);
    expect(await count("select 1 from payment_operations where reservation_id = $1 and kind in ('CAPTURE','VOID')", [r.id])).toBe(1);
  });

  it("a definitive capture rejection is not retried automatically", async () => {
    const r = await authorized();
    app.gateway.overrides.captureAuthorization = async () => {
      throw new ProviderError("HTTP_4XX", "declined", 422, undefined, "AUTHORIZATION_VOIDED");
    };
    await runSimulation(app.deps, r.id, { kind: "DRIVER", session: DRIVER });
    delete app.gateway.overrides.captureAuthorization;
    await recoverReservation(app.deps, r.id, "RECONCILER");
    await recoverPendingReservations(app.deps);
    expect(calls("captureAuthorization")).toBe(1);
    expect((await state(r.id)).payment_state).not.toBe("CAPTURED");
    expect(await count("select 1 from events where reservation_id = $1 and type = 'MANUAL_REVIEW_REQUIRED'", [r.id])).toBeGreaterThan(0);
  });

  it("an interrupted capture is not retried after the authorization expires", async () => {
    const r = await authorized();
    app.gateway.overrides.captureAuthorization = async () => {
      throw timeout();
    };
    await runSimulation(app.deps, r.id, { kind: "DRIVER", session: DRIVER });
    delete app.gateway.overrides.captureAuthorization;
    app.clock.now = r.authorization_expires_at!.getTime() + 1;
    await recoverReservation(app.deps, r.id, "RECONCILER");
    expect(calls("captureAuthorization")).toBe(1);
    expect((await state(r.id)).payment_state).toBe("NEEDS_RECONCILIATION");
  });
});

describe("webhook durability", () => {
  it("a database failure during processing leaves the event unacknowledged and retryable", async () => {
    const pending = await deliveredWithCaptureStatus("PENDING");
    await setCapture(pending.paypal_capture_id!, { status: "COMPLETED" });
    app.gateway.webhookValid = true;
    const failing: Queryable = {
      query: (sql: string, params?: unknown[]) => (/set processed_at/.test(sql) ? Promise.reject(new Error("db down")) : app.db.query(sql, params)),
    };
    const brokenDeps: AppDeps = { ...app.deps, db: { ...app.db, query: failing.query } };
    const body = captureWebhook("WH-D1", "PAYMENT.CAPTURE.COMPLETED", pending.paypal_capture_id!);
    await expect(handlePayPalWebhook(brokenDeps, HEADERS, body)).rejects.toThrow("db down");
    expect((await handlePayPalWebhook(app.deps, HEADERS, body)).result).toBe("PROCESSED");
    expect((await handlePayPalWebhook(app.deps, HEADERS, body)).result).toBe("DUPLICATE");
  });
});
