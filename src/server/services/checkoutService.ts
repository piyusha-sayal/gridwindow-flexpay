/**
 * Human approval → PayPal order → buyer approval → authorization → atomic capacity commit.
 * The server recomputes every amount from the stored offer; the client only names it.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { validateOfferEconomics } from "@/domain/economics";
import { meetsRequiredSaving } from "@/domain/quotes";
import { approvalDeadlineMs, settlementPolicyOf, termsHash } from "@/domain/terms";
import { validateWithEnvelope } from "@/domain/disturbance";
import { ProviderError } from "@/payments/gateway";
import { ServiceError, type AppDeps } from "../deps";
import {
  appendEvent,
  claimOperation,
  committedPlans,
  finishOperation,
  getReservation,
  getReservationForUpdate,
  digestOfEventIds,
  getReservationByOffer,
  leaseOperation,
  nightDisturbances,
  patchReservation,
  planOf,
  providerSource,
  recordProof,
  transitionPayment,
  type OperationRow,
  type ReservationRow,
} from "../repo";
import { attemptCreateOrder, awaitingOrder, resumeOrderCreation, type StoredOrderRequest } from "./orderCreationService";
import { getQuoteSet } from "./quoteService";
import { nightContext } from "./scheduleService";
import { recoverReservation } from "./recoveryService";
import { voidAuthorization } from "./settlementService";

export const acceptSchema = z
  .object({
    quoteSetId: z.string().min(1).max(64),
    offerId: z.string().min(1).max(128),
    termsHash: z.string().regex(/^[0-9a-f]{64}$/),
    consent: z.literal(true),
  })
  .strict();

export type AcceptInput = z.infer<typeof acceptSchema>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface AcceptResult {
  reservationId: string;
  approveUrl: string;
  providerMode: string;
}

/** Driver explicitly accepts one exact, unexpired offer; creates the PayPal AUTHORIZE order. */
export async function acceptOffer(deps: AppDeps, driverSession: string, input: AcceptInput): Promise<AcceptResult> {
  const { quote, nightOf } = await getQuoteSet(deps, driverSession, input.quoteSetId);
  if (deps.now() >= quote.expiresAtMs) throw new ServiceError("QUOTE_EXPIRED", "This offer has expired. Please request new offers.", 409);
  const offer = quote.offers.find((o) => o.offerId === input.offerId);
  if (!offer) throw new ServiceError("OFFER_NOT_FOUND", "Offer not found.", 404);

  // Tamper checks: stored hash must match a fresh hash of stored terms AND the hash the driver saw.
  const recomputed = termsHash(offer.terms);
  if (!safeEqualHex(recomputed, offer.termsHash) || !safeEqualHex(recomputed, input.termsHash)) {
    throw new ServiceError("TERMS_MISMATCH", "Offer terms do not match. Please review the offer again.", 409);
  }
  if (offer.terms.amountCents !== offer.priceCents || offer.terms.merchantRef !== deps.merchantRef || offer.terms.currency !== "USD") {
    throw new ServiceError("TERMS_MISMATCH", "Offer terms do not match.", 409);
  }
  const economics = validateOfferEconomics(deps.economics, {
    priceCents: offer.terms.amountCents,
    listPriceCents: offer.terms.listPriceCents,
    energyCostCents: offer.energyCostCents,
    baselineEnergyCostCents: quote.baseline.energyCostCents ?? 0,
  });
  if (economics.length > 0) throw new ServiceError("ECONOMICS_INVALID", "Offer failed economic validation.", 409);
  // Refuse before creating any order once charging should already have begun (the return re-checks too).
  if (deps.now() >= approvalDeadlineMs(offer.terms)) {
    throw new ServiceError("APPROVAL_TOO_LATE", "Scheduled charging has already started, so this offer can no longer be honored. No payment was taken; please request new offers.", 409);
  }
  // The driver's confirmed minimum saving, stored with the quote, checked against the hashed terms.
  if (!meetsRequiredSaving(quote, offer)) {
    throw new ServiceError("MIN_SAVING_NOT_MET", "This offer saves less than the minimum you required. No payment was taken; choose an offer that meets it or change your requirements.", 409);
  }

  const existing = await getReservationByOffer(deps.db, offer.offerId);
  if (existing) {
    if (existing.driver_session !== driverSession) throw new ServiceError("OFFER_NOT_FOUND", "Offer not found.", 404);
    // A retry after a crash or timeout resumes the SAME order creation (same PayPal-Request-Id).
    return toAcceptResult(await resumeOrderCreation(deps, existing.id, "DRIVER"), true);
  }

  // A disturbance recorded for this station-night after the quote was priced makes its offers unverified: fail closed.
  const disturbed = await nightDisturbances(deps.db, deps.station.id, nightOf);
  if (digestOfEventIds(disturbed.eventIds) !== (quote.disturbanceDigest ?? digestOfEventIds([]))) {
    throw new ServiceError("QUOTE_STALE", "A disturbance was recorded at this station tonight after these offers were made. No payment was taken; please request new offers.", 409);
  }

  // Capacity may have changed since quoting: re-validate against current commitments.
  const { scenario, envelope } = await nightContext(deps.db, deps.station, nightOf);
  const committed = await committedPlans(deps.db, deps.station.id, nightOf);
  const plan = { sessionId: "candidate", portId: offer.terms.portId, plugInMs: offer.terms.plugInMs, departMs: offer.terms.departMs, powerW: offer.terms.powerW };
  if (validateWithEnvelope({ station: deps.station, grid: scenario.grid, forecastBaseLoadW: scenario.forecastBaseLoadW, envelope, plans: [...committed, plan] }).length > 0) {
    throw new ServiceError("CAPACITY_CHANGED", "Station capacity changed since this offer was made. Please request new offers.", 409);
  }

  const reservationId = deps.newId("res");
  const stateToken = randomBytes(24).toString("base64url");
  const request: StoredOrderRequest = {
    reservationId,
    amountCents: offer.terms.amountCents,
    description: `GridWindow flexible overnight charge ${offer.terms.portId} (sandbox demo)`,
    returnUrl: `${deps.baseUrl}/api/checkout/return?rid=${encodeURIComponent(reservationId)}&state=${encodeURIComponent(stateToken)}`,
    cancelUrl: `${deps.baseUrl}/api/checkout/cancel?rid=${encodeURIComponent(reservationId)}&state=${encodeURIComponent(stateToken)}`,
  };
  let op: OperationRow;
  try {
    // Reservation, acceptance event and the leased CREATE_ORDER operation commit together, before any provider call.
    op = await deps.db.tx(async (q) => {
      await q.query(
        `insert into reservations (id, quote_set_id, offer_id, driver_session, station_id, night_of, port_id, plug_in_at, depart_at,
           amount_cents, currency, terms_hash, terms, payment_state, service_state, provider_mode, checkout_state_hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'USD',$11,$12,'QUOTE_ACCEPTED','AWAITING_PAYMENT',$13,$14)`,
        [
          reservationId,
          quote.quoteSetId,
          offer.offerId,
          driverSession,
          deps.station.id,
          nightOf,
          offer.terms.portId,
          new Date(offer.terms.plugInMs).toISOString(),
          new Date(offer.terms.departMs).toISOString(),
          offer.terms.amountCents,
          recomputed,
          JSON.stringify(offer.terms),
          deps.gateway.mode,
          sha256(stateToken),
        ],
      );
      await appendEvent(q, reservationId, "OFFER_ACCEPTED", "DRIVER", {
        offerId: offer.offerId,
        termsHash: recomputed,
        amountCents: offer.terms.amountCents,
        settlementPolicy: settlementPolicyOf(offer.terms),
      });
      const claimed = await claimOperation(q, reservationId, "CREATE_ORDER", { termsHash: recomputed, amountCents: offer.terms.amountCents, request });
      return (await leaseOperation(q, claimed.op.idempotency_key, deps.now()))!;
    });
  } catch (err) {
    // Unique(offer_id) race from a double click.
    if ((err as { code?: string }).code === "23505") throw new ServiceError("ALREADY_ACCEPTED", "This offer was already accepted.", 409);
    throw err;
  }
  return toAcceptResult(await attemptCreateOrder(deps, reservationId, op), false);
}

function toAcceptResult(r: ReservationRow, isRetry: boolean): AcceptResult {
  if (r.payment_state === "ORDER_CREATED" && r.approve_url) return { reservationId: r.id, approveUrl: r.approve_url, providerMode: r.provider_mode };
  if (awaitingOrder(r)) throw new ServiceError("CHECKOUT_PENDING", "Checkout is still starting. No payment was taken; please try again in a moment.", 503);
  if (isRetry && r.payment_state !== "FAILED") throw new ServiceError("ALREADY_ACCEPTED", "This offer was already accepted.", 409);
  throw new ServiceError("PROVIDER_UNAVAILABLE", "Could not start checkout. No payment was taken.", 502);
}

async function loadForReturn(deps: AppDeps, driverSession: string, rid: string, state: string): Promise<ReservationRow> {
  const r = await getReservation(deps.db, rid);
  if (!r || r.driver_session !== driverSession || !safeEqualHex(sha256(state), r.checkout_state_hash)) {
    throw new ServiceError("CHECKOUT_STATE_INVALID", "Checkout session could not be verified.", 403);
  }
  return r;
}

/**
 * Buyer returned from the provider's approval page. Verifies the order with the provider,
 * authorizes exactly once, then commits station capacity or voids on conflict.
 */
export async function handleCheckoutReturn(deps: AppDeps, driverSession: string, rid: string, state: string, token: string): Promise<ReservationRow> {
  const r = await loadForReturn(deps, driverSession, rid, state);
  if (!r.paypal_order_id || token !== r.paypal_order_id) throw new ServiceError("CHECKOUT_STATE_INVALID", "Checkout session could not be verified.", 403);
  if (r.payment_state === "NEEDS_RECONCILIATION") return (await recoverReservation(deps, rid, "RECONCILER")).reservation;
  if (r.payment_state === "AUTHORIZED") return commitCapacityOrVoid(deps, rid); // idempotent revisit
  if (r.payment_state !== "ORDER_CREATED" && r.payment_state !== "BUYER_APPROVED") return r;

  // Approval that arrives after scheduled charging should have begun cannot honor the accepted
  // terms: stop before authorizing, so no funds are ever held.
  if (deps.now() >= approvalDeadlineMs(r.terms)) {
    await transitionPayment(deps.db, rid, r.payment_state, r.payment_state === "ORDER_CREATED" ? "CANCELLED" : "FAILED", { service_state: "CANCELLED" });
    await appendEvent(deps.db, rid, "APPROVAL_AFTER_DEADLINE", "APP", { deadline: new Date(approvalDeadlineMs(r.terms)).toISOString(), from: r.payment_state });
    throw new ServiceError("APPROVAL_TOO_LATE", "Scheduled charging has already started, so this offer can no longer be honored. No payment was taken; please request new offers.", 409);
  }

  // Always read the order before authorizing: a webhook or reconciliation may already have advanced the state to
  // BUYER_APPROVED, and that path must not skip the amount, currency and merchant checks.
  const order = await deps.gateway.getOrder(r.paypal_order_id);
  if (r.payment_state === "ORDER_CREATED" && order.status !== "APPROVED") {
    await appendEvent(deps.db, rid, "RETURN_WITHOUT_APPROVAL", providerSource(deps.gateway.mode), { status: order.status });
    return r;
  }
  // The merchant must be the configured sandbox business account, and the provider must say so: a missing payee fails closed.
  const merchantMismatch = deps.expectedMerchantId ? order.payeeMerchantId !== deps.expectedMerchantId : false;
  if (order.amountCents !== r.amount_cents || order.currency !== "USD" || order.customId !== r.id || merchantMismatch) {
    await transitionPayment(deps.db, rid, r.payment_state, "NEEDS_RECONCILIATION");
    await appendEvent(deps.db, rid, "ORDER_MISMATCH", "APP", { expectedCents: r.amount_cents, providerCents: order.amountCents, currency: order.currency, merchantMismatch });
    throw new ServiceError("PROVIDER_MISMATCH", "Approved order does not match the accepted terms. No authorization was attempted.", 409);
  }
  if (r.payment_state === "ORDER_CREATED") {
    await recordProof(deps.db, rid, "BUYER_APPROVED", deps.gateway.mode, order.orderId, order.status, order.amountCents);
    await transitionPayment(deps.db, rid, "ORDER_CREATED", "BUYER_APPROVED");
    await appendEvent(deps.db, rid, "BUYER_APPROVED", providerSource(deps.gateway.mode), { orderId: order.orderId });
  }
  return authorizeAndCommit(deps, rid);
}

async function authorizeAndCommit(deps: AppDeps, rid: string): Promise<ReservationRow> {
  const r = (await getReservation(deps.db, rid))!;
  const claimed = await claimOperation(deps.db, rid, "AUTHORIZE", { termsHash: r.terms_hash, amountCents: r.amount_cents });
  const op = await leaseOperation(deps.db, claimed.op.idempotency_key, deps.now());
  if (!op) return r; // a concurrent return is already authorizing with the same key
  try {
    const auth = await deps.gateway.authorizeOrder(r.paypal_order_id!, op.idempotency_key);
    if (auth.amountCents !== r.amount_cents || auth.currency !== "USD" || auth.status !== "CREATED") {
      await finishOperation(deps.db, op.idempotency_key, "FAILED", auth.authorizationId, "AUTH_MISMATCH");
      await transitionPayment(deps.db, rid, "BUYER_APPROVED", "NEEDS_RECONCILIATION", { paypal_authorization_id: auth.authorizationId });
      await appendEvent(deps.db, rid, "AUTHORIZATION_MISMATCH", "APP", { status: auth.status, providerCents: auth.amountCents });
      return (await getReservation(deps.db, rid))!;
    }
    await finishOperation(deps.db, op.idempotency_key, "SUCCEEDED", auth.authorizationId);
    const moved = await transitionPayment(deps.db, rid, "BUYER_APPROVED", "AUTHORIZED", {
      paypal_authorization_id: auth.authorizationId,
      authorization_expires_at: auth.expirationTime ? new Date(auth.expirationTime) : null,
      authorized_at: new Date(deps.now()),
    });
    if (!moved) {
      // The row left BUYER_APPROVED while the authorize was in flight (for example a late return set it FAILED).
      // Keep the provider id so the sweep reconciles it and voids the orphan; never record it as authorized here.
      await patchReservation(deps.db, rid, { paypal_authorization_id: auth.authorizationId });
      await appendEvent(deps.db, rid, "AUTHORIZATION_AFTER_LOCAL_CHANGE", providerSource(deps.gateway.mode), { authorizationId: auth.authorizationId });
      return (await getReservation(deps.db, rid))!;
    }
    await recordProof(deps.db, rid, "AUTHORIZED", deps.gateway.mode, auth.authorizationId, auth.status, auth.amountCents);
    await appendEvent(deps.db, rid, "AUTHORIZED", providerSource(deps.gateway.mode), { authorizationId: auth.authorizationId, status: auth.status });
  } catch (err) {
    // Even a 4xx (e.g. a concurrent request already authorized) may leave a live authorization
    // at the provider, so never conclude FAILED locally: re-read provider truth instead.
    const ambiguous = err instanceof ProviderError && err.ambiguous;
    await finishOperation(deps.db, op.idempotency_key, ambiguous ? "AMBIGUOUS" : "FAILED", null, err instanceof ProviderError ? (err.issue ?? err.kind) : "UNKNOWN");
    await transitionPayment(deps.db, rid, "BUYER_APPROVED", "NEEDS_RECONCILIATION");
    await appendEvent(deps.db, rid, "AUTHORIZATION_FAILED", "APP", { ambiguous });
    return (await recoverReservation(deps, rid, "RECONCILER")).reservation;
  }
  return commitCapacityOrVoid(deps, rid);
}

/** Only an authorized reservation still waiting for capacity may commit, or be cancelled and voided, from here. */
function awaitingCapacity(r: ReservationRow): boolean {
  return r.payment_state === "AUTHORIZED" && !r.slots_committed && r.service_state === "AWAITING_PAYMENT";
}

/**
 * Atomic capacity commit serialized per station-night; voids the authorization on conflict. The state is re-read
 * under the reservation row lock inside the station-night transaction, so a concurrent commit, simulation or void
 * that won the race is never overwritten.
 */
export async function commitCapacityOrVoid(deps: AppDeps, rid: string): Promise<ReservationRow> {
  const r = (await getReservation(deps.db, rid))!;
  if (!awaitingCapacity(r)) return r;
  const release = await deps.db.tx(async (q) => {
    const locked = await getReservationForUpdate(q, rid);
    if (!locked || !awaitingCapacity(locked)) return null;
    const voids = await q.query("select 1 from payment_operations where reservation_id = $1 and kind = 'VOID'", [rid]);
    if (voids.length > 0) return null; // a void was already attempted; never re-commit capacity
    // An authorization confirmed only after charging should have started (e.g. a lost provider
    // response recovered later) cannot honor the accepted schedule: release it, never commit.
    if (deps.now() >= approvalDeadlineMs(locked.terms)) {
      await patchReservation(q, rid, { service_state: "CANCELLED" });
      await appendEvent(q, rid, "AUTHORIZATION_AFTER_DEADLINE", "APP", { deadline: new Date(approvalDeadlineMs(locked.terms)).toISOString() });
      return "AUTHORIZATION_AFTER_DEADLINE";
    }
    const { scenario, envelope } = await nightContext(q, deps.station, locked.night_of);
    const others = await committedPlans(q, locked.station_id, locked.night_of, locked.id);
    const violations = validateWithEnvelope({ station: deps.station, grid: scenario.grid, forecastBaseLoadW: scenario.forecastBaseLoadW, envelope, plans: [...others, planOf(locked)],
      targets: [{ sessionId: locked.id, targetBatteryWh: locked.terms.targetBatteryWh, efficiencyBp: locked.terms.efficiencyBp }],
    });
    if (violations.length > 0) {
      await appendEvent(q, rid, "CAPACITY_CONFLICT", "APP", { violations: violations.slice(0, 5).map((v) => v.code) });
      await patchReservation(q, rid, { service_state: "CANCELLED" });
      return "CAPACITY_CONFLICT";
    }
    await patchReservation(q, rid, { slots_committed: true, service_state: "SCHEDULED" });
    await appendEvent(q, rid, "CAPACITY_COMMITTED", "APP", {});
    return null;
  }, `${r.station_id}:${r.night_of}`);
  if (release) return voidAuthorization(deps, rid, release);
  return (await getReservation(deps.db, rid))!;
}

/** Buyer cancelled on the provider page: no authorization exists, nothing to void. */
export async function handleCheckoutCancel(deps: AppDeps, driverSession: string, rid: string, state: string): Promise<ReservationRow> {
  const r = await loadForReturn(deps, driverSession, rid, state);
  if (r.payment_state === "ORDER_CREATED") {
    await transitionPayment(deps.db, rid, "ORDER_CREATED", "CANCELLED", { service_state: "CANCELLED" });
    await appendEvent(deps.db, rid, "CHECKOUT_CANCELLED", "DRIVER", {});
  }
  return (await getReservation(deps.db, rid))!;
}
