/**
 * Drives a reservation forward after reconciliation: resumes order creation interrupted before an
 * order id was committed, commits capacity for a newly confirmed authorization, finishes a
 * settlement interrupted after the synthetic run, and voids orphan authorizations held for locally
 * terminal reservations. Never initiates a payment the buyer has not approved.
 */
import { ProviderError } from "@/payments/gateway";
import type { AppDeps } from "../deps";
import { appendEvent, appendEventOnce, claimOperation, finishOperation, getReservation, leaseOperation, recordProof, SettlementConflictError, type EventSource, type ReservationRow } from "../repo";
import { commitCapacityOrVoid } from "./checkoutService";
import { awaitingOrder, resumeOrderCreation } from "./orderCreationService";
import { reconcileDetailed } from "./reconcileService";
import { settleFromExistingRun, voidAuthorization } from "./settlementService";

async function voidOrphanAuthorization(deps: AppDeps, rid: string, authorizationId: string, source: EventSource): Promise<void> {
  let key: string;
  try {
    const claim = await claimOperation(deps.db, rid, "VOID");
    // A succeeded void already released the orphan; a live lease belongs to another worker. Neither may void again.
    if (claim.op.status === "SUCCEEDED") return;
    const leased = await leaseOperation(deps.db, claim.op.idempotency_key, deps.now());
    if (!leased) return;
    key = leased.idempotency_key;
  } catch (err) {
    if (err instanceof SettlementConflictError) return; // a capture exists; never void after capture
    throw err;
  }
  try {
    await deps.gateway.voidAuthorization(authorizationId, key);
    const auth = await deps.gateway.getAuthorization(authorizationId);
    await finishOperation(deps.db, key, "SUCCEEDED", authorizationId);
    if (auth.status === "VOIDED") await recordProof(deps.db, rid, "VOIDED", deps.gateway.mode, authorizationId, auth.status, auth.amountCents);
    await appendEvent(deps.db, rid, "ORPHAN_AUTHORIZATION_VOIDED", source, { status: auth.status });
  } catch (err) {
    const ambiguous = err instanceof ProviderError && err.ambiguous;
    await finishOperation(deps.db, key, ambiguous ? "AMBIGUOUS" : "FAILED", null, err instanceof ProviderError ? (err.issue ?? err.kind) : "UNKNOWN");
    await appendEventOnce(deps.db, rid, "ORPHAN_AUTHORIZATION_VOID_FAILED", source, { ambiguous });
  }
}

export async function recoverReservation(deps: AppDeps, rid: string, source: EventSource): Promise<{ reservation: ReservationRow; providerReachable: boolean }> {
  const current = await getReservation(deps.db, rid);
  if (!current) throw new Error(`reservation ${rid} not found`);
  if (awaitingOrder(current)) {
    const r = await resumeOrderCreation(deps, rid, source);
    return { reservation: r, providerReachable: true };
  }
  const outcome = await reconcileDetailed(deps, rid, source);
  if (outcome.orphanAuthorizationId) await voidOrphanAuthorization(deps, rid, outcome.orphanAuthorizationId, source);
  let r = outcome.reservation;
  if (r.payment_state === "AUTHORIZED" && !r.slots_committed && r.service_state === "AWAITING_PAYMENT") r = await commitCapacityOrVoid(deps, rid);
  if (r.payment_state === "AUTHORIZED" && r.service_state === "CANCELLED") r = await voidAuthorization(deps, rid, "CAPACITY_CONFLICT_RETRY");
  if (r.payment_state === "AUTHORIZED") r = await settleFromExistingRun(deps, rid);
  return { reservation: r, providerReachable: outcome.providerReachable };
}

/**
 * Restart sweep: re-drives every reservation left mid-flight (crash, timeout, pending capture).
 * Each reservation is independent; one failure never blocks the rest.
 */
export async function recoverPendingReservations(deps: AppDeps, limit = 50): Promise<{ attempted: number; failed: number }> {
  const rows = await deps.db.query<{ id: string }>(
    `select id from reservations
     where payment_state in ('QUOTE_ACCEPTED','NEEDS_RECONCILIATION','CAPTURE_PENDING')
        or (payment_state = 'AUTHORIZED' and service_state in ('DELIVERED','FAILED','CANCELLED'))
     order by updated_at limit $1`,
    [limit],
  );
  let failed = 0;
  for (const { id } of rows) {
    try {
      await recoverReservation(deps, id, "RECONCILER");
    } catch (err) {
      failed += 1;
      await appendEvent(deps.db, id, "RECOVERY_ERROR", "RECONCILER", { error: err instanceof Error ? err.name : "UNKNOWN" });
    }
  }
  return { attempted: rows.length, failed };
}
