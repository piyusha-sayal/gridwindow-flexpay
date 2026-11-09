/**
 * Reconciliation: re-reads provider state using only IDs we stored ourselves and moves
 * local state toward provider truth. Never creates new financial requests except replaying
 * the SAME idempotency key to recover a capture object.
 */
import { canTransition, isTerminal, paymentStateForCapture, type PaymentState, type ProofType } from "@/domain/paymentState";
import { ProviderError, type ProviderAuthorization, type ProviderCapture } from "@/payments/gateway";
import type { AppDeps } from "../deps";
import { appendEvent, getReservation, recordProof, transitionPayment, type EventSource, type ReservationRow } from "../repo";

export interface Truth {
  state: PaymentState;
  proof?: { type: ProofType; ref: string; status: string; amountCents: number | null };
  patch?: Parameters<typeof transitionPayment>[4];
}

/**
 * Provider truth for one capture. CAPTURED requires COMPLETED plus the expected authorization,
 * amount and currency; PENDING stays pending; DECLINED/FAILED is final for automation.
 */
export function truthFromCapture(r: ReservationRow, cap: ProviderCapture, authorizationId: string | null = r.paypal_authorization_id): Truth {
  const patch = { paypal_capture_id: cap.captureId };
  const linked = cap.authorizationId === null || cap.authorizationId === authorizationId;
  if (!linked || cap.amountCents !== r.amount_cents || cap.currency !== "USD") return { state: "NEEDS_RECONCILIATION", patch };
  const state = paymentStateForCapture(cap.status);
  if (state === "CAPTURED") {
    return { state, patch: { ...patch, slots_committed: false }, proof: { type: "CAPTURED", ref: cap.captureId, status: cap.status, amountCents: cap.amountCents } };
  }
  return { state, patch: state === "CAPTURE_DECLINED" ? { ...patch, slots_committed: false } : patch };
}

async function truthFromAuthorization(deps: AppDeps, r: ReservationRow, auth: ProviderAuthorization): Promise<Truth> {
  const patch = { paypal_authorization_id: auth.authorizationId };
  if (auth.amountCents !== r.amount_cents || auth.currency !== "USD") return { state: "NEEDS_RECONCILIATION", patch };
  if (auth.status === "CREATED") {
    const authorizedPatch = {
      ...patch,
      authorized_at: r.authorized_at ?? new Date(deps.now()),
      authorization_expires_at: auth.expirationTime ? new Date(auth.expirationTime) : r.authorization_expires_at,
    };
    return { state: "AUTHORIZED", patch: authorizedPatch, proof: { type: "AUTHORIZED", ref: auth.authorizationId, status: auth.status, amountCents: auth.amountCents } };
  }
  if (auth.status === "VOIDED") {
    return { state: "VOIDED", patch: { ...patch, slots_committed: false }, proof: { type: "VOIDED", ref: auth.authorizationId, status: auth.status, amountCents: auth.amountCents } };
  }
  if (auth.status === "CAPTURED") {
    const ops = await deps.db.query<{ idempotency_key: string }>("select idempotency_key from payment_operations where reservation_id = $1 and kind = 'CAPTURE'", [r.id]);
    if (!ops[0]) {
      // Captured outside this app (no capture request of ours): money moved, so keep the provider
      // evidence and route to review; never let the local record read as "not collected".
      return { state: "NEEDS_RECONCILIATION", patch, proof: { type: "CAPTURED", ref: auth.authorizationId, status: "AUTHORIZATION_CAPTURED", amountCents: auth.amountCents } };
    }
    // Replaying the same PayPal-Request-Id returns the original capture, never a second one.
    const capture = await deps.gateway.captureAuthorization(auth.authorizationId, r.amount_cents, r.id, ops[0].idempotency_key);
    const truth = truthFromCapture(r, await deps.gateway.getCapture(capture.captureId), auth.authorizationId);
    return { ...truth, patch: { ...patch, ...truth.patch } };
  }
  return { state: "NEEDS_RECONCILIATION", patch };
}

async function providerTruth(deps: AppDeps, r: ReservationRow): Promise<Truth | null> {
  if (r.paypal_capture_id) return truthFromCapture(r, await deps.gateway.getCapture(r.paypal_capture_id));
  if (r.paypal_authorization_id) return truthFromAuthorization(deps, r, await deps.gateway.getAuthorization(r.paypal_authorization_id));
  if (r.paypal_order_id) {
    const order = await deps.gateway.getOrder(r.paypal_order_id);
    if (order.amountCents !== r.amount_cents || order.customId !== r.id) return { state: "NEEDS_RECONCILIATION" };
    const auth = order.authorizations[0];
    if (auth) return truthFromAuthorization(deps, r, auth);
    if (order.status === "APPROVED") return { state: "BUYER_APPROVED", proof: { type: "BUYER_APPROVED", ref: order.orderId, status: order.status, amountCents: order.amountCents } };
    if (order.status === "VOIDED") return { state: "CANCELLED" };
    return { state: "ORDER_CREATED" };
  }
  return null;
}

export interface ReconcileOutcome {
  reservation: ReservationRow;
  /** False when the provider could not be reached; callers must not treat the event as handled. */
  providerReachable: boolean;
  /** Provider holds a live authorization although the local row is terminal (FAILED/CANCELLED). */
  orphanAuthorizationId: string | null;
}

export async function reconcileDetailed(deps: AppDeps, rid: string, source: EventSource): Promise<ReconcileOutcome> {
  const r = await getReservation(deps.db, rid);
  if (!r) throw new Error(`reservation ${rid} not found`);
  const done = (reservation: ReservationRow, providerReachable = true, orphanAuthorizationId: string | null = null): ReconcileOutcome => ({
    reservation,
    providerReachable,
    orphanAuthorizationId,
  });
  let truth: Truth | null;
  try {
    truth = await providerTruth(deps, r);
  } catch (err) {
    await appendEvent(deps.db, rid, "RECONCILE_PROVIDER_UNAVAILABLE", source, { kind: err instanceof ProviderError ? err.kind : "UNKNOWN" });
    return done(r, false);
  }
  if (!truth) {
    await appendEvent(deps.db, rid, "MANUAL_REVIEW_REQUIRED", source, { reason: "no provider reference stored" });
    return done(r);
  }
  const proof = truth.proof;
  const record = async () => {
    if (proof) await recordProof(deps.db, rid, proof.type, deps.gateway.mode, proof.ref, proof.status, proof.amountCents);
  };
  if (truth.state === r.payment_state) {
    await record();
    return done(r);
  }
  if (isTerminal(r.payment_state)) {
    await appendEvent(deps.db, rid, "RECONCILIATION_CONFLICT", source, { local: r.payment_state, provider: truth.state });
    // Terminal states are never rewritten automatically, but provider capture evidence is always kept.
    if (proof?.type === "CAPTURED" && r.payment_state !== "CAPTURED") {
      await record();
      await appendEvent(deps.db, rid, "PROVIDER_CAPTURE_CONFLICT", source, { local: r.payment_state, amountCents: proof.amountCents });
    }
    const orphan = (r.payment_state === "FAILED" || r.payment_state === "CANCELLED") && truth.state === "AUTHORIZED" ? (truth.patch?.paypal_authorization_id ?? null) : null;
    return done(r, true, orphan);
  }
  let from = r.payment_state;
  if (!canTransition(from, truth.state)) {
    if (!(await transitionPayment(deps.db, rid, from, "NEEDS_RECONCILIATION"))) return done((await getReservation(deps.db, rid))!);
    from = "NEEDS_RECONCILIATION";
  }
  if (await transitionPayment(deps.db, rid, from, truth.state, truth.patch)) {
    await record();
    await appendEvent(deps.db, rid, "RECONCILED", source, { from: r.payment_state, to: truth.state });
  }
  return done((await getReservation(deps.db, rid))!);
}

export async function reconcileReservation(deps: AppDeps, rid: string, source: EventSource): Promise<ReservationRow> {
  return (await reconcileDetailed(deps, rid, source)).reservation;
}
