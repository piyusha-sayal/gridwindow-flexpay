/**
 * Local-only expiry of abandoned checkouts. An ORDER_CREATED or BUYER_APPROVED reservation whose approval deadline
 * (the start of its first charging slot) has passed can no longer be honored: the return handler would refuse it, but
 * only if the driver came back. This closes such rows without any provider call. It never touches a row that has an
 * authorization or capture id, or any AUTHORIZE/CAPTURE/VOID operation (those belong to reconciliation and settlement),
 * and every decision is re-derived under the row lock with a compare-and-set transition, so a concurrent return or
 * sweep either wins cleanly or changes nothing.
 */
import { approvalDeadlineMs } from "@/domain/terms";
import type { AppDeps } from "../deps";
import { appendEvent, getReservationForUpdate, transitionPayment, type ReservationRow } from "../repo";

export const CHECKOUT_EXPIRED_UNPAID = "CHECKOUT_EXPIRED_UNPAID";

const NO_FINANCIAL_OPERATION = `not exists (select 1 from payment_operations o where o.reservation_id = reservations.id and o.kind in ('AUTHORIZE', 'CAPTURE', 'VOID'))`;

const CANDIDATES = `select id, terms from reservations
  where provider_mode = $1
    and payment_state in ('ORDER_CREATED', 'BUYER_APPROVED')
    and paypal_authorization_id is null and paypal_capture_id is null
    and ${NO_FINANCIAL_OPERATION}
  order by created_at, id
  limit $2`;

export interface ExpiryResult {
  examined: number;
  closed: number;
  failed: number;
}

/** Closes one abandoned checkout under the row lock. Returns true only when this call performed the transition. */
export async function expireAbandonedCheckout(deps: AppDeps, rid: string): Promise<boolean> {
  return deps.db.tx(async (q) => {
    const r: ReservationRow | null = await getReservationForUpdate(q, rid);
    if (!r || r.provider_mode !== deps.gateway.mode) return false;
    if (r.payment_state !== "ORDER_CREATED" && r.payment_state !== "BUYER_APPROVED") return false;
    if (r.paypal_authorization_id || r.paypal_capture_id) return false;
    const deadline = approvalDeadlineMs(r.terms);
    if (deps.now() < deadline) return false;
    const operations = await q.query("select 1 from payment_operations where reservation_id = $1 and kind in ('AUTHORIZE', 'CAPTURE', 'VOID') limit 1", [rid]);
    if (operations.length > 0) return false;
    const to = r.payment_state === "ORDER_CREATED" ? "CANCELLED" : "FAILED";
    if (!(await transitionPayment(q, rid, r.payment_state, to, { service_state: "CANCELLED" }))) return false;
    await appendEvent(q, rid, CHECKOUT_EXPIRED_UNPAID, "APP", { from: r.payment_state, to, deadline: new Date(deadline).toISOString(), providerCalls: 0 });
    return true;
  });
}

/** Sweeps this runtime's provider mode only. One failing row never blocks the others. */
export async function expireAbandonedCheckouts(deps: AppDeps, limit = 200): Promise<ExpiryResult> {
  const rows = await deps.db.query<{ id: string; terms: ReservationRow["terms"] }>(CANDIDATES, [deps.gateway.mode, limit]);
  const now = deps.now();
  const due = rows.filter((r) => now >= approvalDeadlineMs(r.terms));
  let closed = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      if (await expireAbandonedCheckout(deps, id)) closed += 1;
    } catch (err) {
      failed += 1;
      console.warn("[gridwindow] checkout expiry failed:", err instanceof Error ? err.name : "UNKNOWN");
    }
  }
  return { examined: due.length, closed, failed };
}
