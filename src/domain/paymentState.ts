/**
 * Payment lifecycle (provider-truth) and service lifecycle are tracked independently.
 * One order -> one buyer approval -> one authorization -> exactly one of capture | void.
 */

export const PAYMENT_STATES = [
  "QUOTE_ACCEPTED",
  "ORDER_CREATED",
  "BUYER_APPROVED",
  "AUTHORIZED",
  "CAPTURE_PENDING",
  "CAPTURED",
  "CAPTURE_DECLINED",
  "VOIDED",
  "CANCELLED",
  "FAILED",
  "NEEDS_RECONCILIATION",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const SERVICE_STATES = ["AWAITING_PAYMENT", "SCHEDULED", "DELIVERED", "FAILED", "CANCELLED"] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

/** CAPTURE_DECLINED is terminal for automation: any further charge needs operator review or renewed buyer consent. */
const TERMINAL: ReadonlySet<PaymentState> = new Set(["CAPTURED", "CAPTURE_DECLINED", "VOIDED", "CANCELLED", "FAILED"]);

const TRANSITIONS: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
  QUOTE_ACCEPTED: ["ORDER_CREATED", "FAILED", "CANCELLED", "NEEDS_RECONCILIATION"],
  ORDER_CREATED: ["BUYER_APPROVED", "CANCELLED", "NEEDS_RECONCILIATION"],
  BUYER_APPROVED: ["AUTHORIZED", "FAILED", "NEEDS_RECONCILIATION"],
  AUTHORIZED: ["CAPTURE_PENDING", "CAPTURED", "CAPTURE_DECLINED", "VOIDED", "NEEDS_RECONCILIATION"],
  CAPTURE_PENDING: ["CAPTURED", "CAPTURE_DECLINED", "NEEDS_RECONCILIATION"],
  NEEDS_RECONCILIATION: ["ORDER_CREATED", "BUYER_APPROVED", "AUTHORIZED", "CAPTURE_PENDING", "CAPTURED", "CAPTURE_DECLINED", "VOIDED", "CANCELLED", "FAILED"],
  CAPTURED: [],
  CAPTURE_DECLINED: [],
  VOIDED: [],
  CANCELLED: [],
  FAILED: [],
};

/**
 * Maps a provider capture status (Payments v2 `capture_status` enum) to local payment state.
 * Only COMPLETED finalizes; anything unexpected fails closed into reconciliation.
 */
export function paymentStateForCapture(status: string): "CAPTURED" | "CAPTURE_PENDING" | "CAPTURE_DECLINED" | "NEEDS_RECONCILIATION" {
  switch (status) {
    case "COMPLETED":
      return "CAPTURED";
    case "PENDING":
      return "CAPTURE_PENDING";
    case "DECLINED":
    case "FAILED":
      return "CAPTURE_DECLINED";
    default:
      // REFUNDED / PARTIALLY_REFUNDED were never initiated by this app; unknown values are not trusted.
      return "NEEDS_RECONCILIATION";
  }
}

export function isTerminal(state: PaymentState): boolean {
  return TERMINAL.has(state);
}

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: PaymentState,
    readonly to: PaymentState,
  ) {
    super(`illegal payment transition ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: PaymentState, to: PaymentState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/** Proof types recorded only from provider API responses (or verified webhooks re-checked against the API). */
export const PROOF_TYPES = ["ORDER_CREATED", "BUYER_APPROVED", "AUTHORIZED", "CAPTURED", "VOIDED"] as const;
export type ProofType = (typeof PROOF_TYPES)[number];

/**
 * Whether a reservation's modeled economics are realized (provider-confirmed capture), still projected
 * (payment not final) or not realized (voided, cancelled, failed or declined: nothing was collected).
 */
export type EconomicOutcome = "REALIZED" | "PROJECTED" | "NOT_REALIZED";

const NOT_REALIZED: ReadonlySet<PaymentState> = new Set(["VOIDED", "CANCELLED", "FAILED", "CAPTURE_DECLINED"]);

export function economicOutcome(state: PaymentState): EconomicOutcome {
  if (state === "CAPTURED") return "REALIZED";
  return NOT_REALIZED.has(state) ? "NOT_REALIZED" : "PROJECTED";
}
