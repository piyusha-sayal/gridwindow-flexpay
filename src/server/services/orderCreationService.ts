/**
 * Crash-safe PayPal order creation (review finding #9).
 *
 * The CREATE_ORDER operation — stable PayPal-Request-Id, exact request payload and the accepted
 * offer's terms hash/amount — is committed in the same transaction as the reservation, before any
 * provider call. A retry replays that stored request under the same key, so a lost response returns
 * the order PayPal already created instead of a second one. Replays happen only while the accepted
 * quote is unexpired and only by the worker holding the operation lease. The approve link is never
 * returned before the order id is committed, so an order whose response was lost was never shown to
 * the buyer: abandoning it after expiry cannot leave an approved payment behind.
 */
import { PAYPAL_REQUEST_ID_RETENTION_MS, ProviderError, type CreateOrderInput } from "@/payments/gateway";
import type { AppDeps } from "../deps";
import { assertProviderScope } from "../providerScope";
import {
  appendEvent,
  finishOperation,
  getReservation,
  leaseOperation,
  OPERATION_LEASE_MS,
  patchReservation,
  providerSource,
  recordProof,
  transitionPayment,
  type EventSource,
  type OperationRow,
  type ReservationRow,
} from "../repo";

/**
 * Replays happen only before quote expiry (plus one lease for an in-flight call), so that window
 * must sit inside PayPal's idempotency-key retention; otherwise a "replay" could open a second order.
 */
export function assertReplayWindowWithinRetention(quoteTtlMs: number): void {
  if (quoteTtlMs + OPERATION_LEASE_MS >= PAYPAL_REQUEST_ID_RETENTION_MS) {
    throw new Error("quote TTL must be shorter than the PayPal-Request-Id retention window");
  }
}

/** Order-creation input as persisted before the call; the idempotency key is the operation's own. */
export type StoredOrderRequest = Omit<CreateOrderInput, "requestId">;

const PENDING_ORDER_STATES = new Set(["QUOTE_ACCEPTED", "NEEDS_RECONCILIATION"]);

/** True for a reservation that was accepted but has no provider order id committed yet. */
export function awaitingOrder(r: ReservationRow): boolean {
  return !r.paypal_order_id && PENDING_ORDER_STATES.has(r.payment_state);
}

async function createOrderOperation(deps: AppDeps, rid: string): Promise<OperationRow | null> {
  const rows = await deps.db.query<OperationRow>(
    "select idempotency_key, kind, status, provider_ref, attempts, request, terms_hash, amount_cents from payment_operations where reservation_id = $1 and kind = 'CREATE_ORDER'",
    [rid],
  );
  return rows[0] ?? null;
}

async function quoteExpiresAtMs(deps: AppDeps, quoteSetId: string): Promise<number> {
  const rows = await deps.db.query<{ expires_at: Date }>("select expires_at from quote_sets where id = $1", [quoteSetId]);
  return rows[0] ? new Date(rows[0].expires_at).getTime() : 0;
}

function boundToOffer(r: ReservationRow, op: OperationRow): op is OperationRow & { request: StoredOrderRequest } {
  const req = op.request as Partial<StoredOrderRequest> | null;
  return !!req && op.terms_hash === r.terms_hash && op.amount_cents === r.amount_cents && req.amountCents === r.amount_cents && req.reservationId === r.id;
}

async function fail(deps: AppDeps, r: ReservationRow, key: string, code: string, orderId: string | null): Promise<ReservationRow> {
  await finishOperation(deps.db, key, "FAILED", orderId, code);
  await transitionPayment(deps.db, r.id, r.payment_state, "FAILED");
  await appendEvent(deps.db, r.id, "ORDER_CREATE_FAILED", "APP", { ambiguous: false, code });
  return (await getReservation(deps.db, r.id))!;
}

/**
 * One provider attempt. The caller must hold the operation lease (see `leaseOperation`).
 * Any error that is not a definitive provider rejection — including a failure after the provider
 * applied the request — is AMBIGUOUS and resolved by replaying the same key later.
 */
export async function attemptCreateOrder(deps: AppDeps, rid: string, op: OperationRow): Promise<ReservationRow> {
  const r = (await getReservation(deps.db, rid))!;
  assertProviderScope(deps, r);
  if (!awaitingOrder(r)) return r;
  if (!boundToOffer(r, op)) return fail(deps, r, op.idempotency_key, "BINDING_MISMATCH", null);

  let order;
  try {
    order = await deps.gateway.createOrder({ ...op.request, requestId: op.idempotency_key });
  } catch (err) {
    const definitive = err instanceof ProviderError && !err.ambiguous;
    const code = err instanceof ProviderError ? (err.issue ?? err.kind) : "UNKNOWN";
    if (definitive) return fail(deps, r, op.idempotency_key, code, null);
    await finishOperation(deps.db, op.idempotency_key, "AMBIGUOUS", null, code);
    if (r.payment_state === "QUOTE_ACCEPTED") await transitionPayment(deps.db, rid, "QUOTE_ACCEPTED", "NEEDS_RECONCILIATION");
    await appendEvent(deps.db, rid, "ORDER_CREATE_FAILED", "APP", { ambiguous: true, code, attempt: op.attempts });
    return (await getReservation(deps.db, rid))!;
  }

  const mismatch = order.amountCents !== r.amount_cents || order.currency !== "USD" || !order.approveUrl || (order.customId !== null && order.customId !== r.id);
  if (mismatch) return fail(deps, r, op.idempotency_key, "ORDER_MISMATCH", order.orderId);
  await deps.db.tx(async (q) => {
    await finishOperation(q, op.idempotency_key, "SUCCEEDED", order.orderId);
    if (await transitionPayment(q, rid, r.payment_state, "ORDER_CREATED", { paypal_order_id: order.orderId, approve_url: order.approveUrl })) {
      await recordProof(q, rid, "ORDER_CREATED", deps.gateway.mode, order.orderId, order.status, order.amountCents);
      await appendEvent(q, rid, "ORDER_CREATED", providerSource(deps.gateway.mode), { orderId: order.orderId, status: order.status, attempt: op.attempts });
    } else {
      // The reservation moved on (e.g. abandoned after quote expiry) while this response was in flight.
      // The order is never linked or shown to the buyer; keep its id on record for a human to close out.
      await appendEvent(q, rid, "ORDER_CREATED_AFTER_ABANDONMENT", providerSource(deps.gateway.mode), { orderId: order.orderId, status: order.status, attempt: op.attempts });
      await appendEvent(q, rid, "MANUAL_REVIEW_REQUIRED", "APP", { reason: "provider order created for an abandoned reservation; never shown to the buyer", orderId: order.orderId });
    }
  });
  return (await getReservation(deps.db, rid))!;
}

/**
 * Resumes order creation for an accepted reservation with no committed order id (after a crash,
 * timeout or lost response). Safe to call repeatedly and from concurrent workers.
 */
export async function resumeOrderCreation(deps: AppDeps, rid: string, source: EventSource): Promise<ReservationRow> {
  const r = await getReservation(deps.db, rid);
  if (!r) throw new Error(`reservation ${rid} not found`);
  assertProviderScope(deps, r);
  if (!awaitingOrder(r)) return r;
  const op = await createOrderOperation(deps, rid);
  if (!op) {
    await appendEvent(deps.db, rid, "MANUAL_REVIEW_REQUIRED", source, { reason: "accepted reservation has no CREATE_ORDER operation" });
    return r;
  }
  if (op.status === "FAILED") {
    await transitionPayment(deps.db, rid, r.payment_state, "FAILED");
    return (await getReservation(deps.db, rid))!;
  }
  if (deps.now() >= (await quoteExpiresAtMs(deps, r.quote_set_id))) {
    // Never replay after expiry: a replay could create an order for terms the buyer can no longer accept.
    if (await transitionPayment(deps.db, rid, r.payment_state, "CANCELLED")) {
      await patchReservation(deps.db, rid, { service_state: "CANCELLED" });
      await finishOperation(deps.db, op.idempotency_key, "FAILED", null, "QUOTE_EXPIRED");
      await appendEvent(deps.db, rid, "ORDER_CREATION_ABANDONED", source, { reason: "QUOTE_EXPIRED", lastStatus: op.status, attempts: op.attempts });
      if (op.attempts > 0) {
        // A provider order may exist that we never saw. It was never shown to the buyer, so it carries no
        // payment obligation, but it is left for a human to confirm rather than resolved by another create.
        await appendEvent(deps.db, rid, "MANUAL_REVIEW_REQUIRED", source, { reason: "ambiguous order creation abandoned; check provider for an unapproved orphan order" });
      }
    }
    return (await getReservation(deps.db, rid))!;
  }
  const leased = await leaseOperation(deps.db, op.idempotency_key, deps.now());
  if (!leased) return r; // another worker has this attempt in flight
  return attemptCreateOrder(deps, rid, leased);
}
