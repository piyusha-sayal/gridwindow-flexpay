import type { PaymentState } from "./paymentState";

/**
 * Whether a reservation's charging plan counts as station load on its night.
 * Capacity-holding (committed) sessions count. Settled-by-capture and capture-in-flight sessions still count,
 * because that energy was or is being delivered. VOIDED, FAILED, CANCELLED, expired and never-committed sessions
 * release their capacity and count for nothing, whatever their old plan said.
 */
export function holdsCapacity(r: { paymentState: PaymentState; slotsCommitted: boolean }): boolean {
  return r.slotsCommitted || r.paymentState === "CAPTURED" || r.paymentState === "CAPTURE_PENDING" || r.paymentState === "CAPTURE_DECLINED";
}
