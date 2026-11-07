import type { Tone } from "@/components/ui";
import type { PaymentState } from "@/domain/paymentState";
import { formatUsd } from "@/domain/units";
import type { ReservationView } from "@/server/services/viewService";

/** Customer copy per payment state. Only CAPTURED, backed by a provider proof, reads as a completed charge. */
export const PAYMENT_COPY: Record<PaymentState, { tone: Tone; title: string; body: string }> = {
  QUOTE_ACCEPTED: { tone: "neutral", title: "Starting checkout…", body: "No payment has been taken." },
  ORDER_CREATED: { tone: "neutral", title: "Waiting for your approval on the payment page.", body: "Nothing is authorized until you approve." },
  BUYER_APPROVED: { tone: "info", title: "Approved, authorizing…", body: "This page updates automatically." },
  AUTHORIZED: {
    tone: "info",
    title: "Authorized, not captured. Payment is captured only after the energy is delivered and the provider confirms it.",
    body: "A hold for this amount is on your payment method and your charging window is reserved. No payment has been collected.",
  },
  CAPTURE_PENDING: {
    tone: "warn",
    title: "Capture submitted after delivery; the payment provider reports it as pending. The outcome is not final yet. This page updates when the provider confirms or declines it.",
    body: "The payment may still complete. No second capture will ever be attempted while this is pending.",
  },
  CAPTURED: { tone: "success", title: "Captured after delivery was verified.", body: "Your FlexReceipt is below." },
  CAPTURE_DECLINED: {
    tone: "danger",
    title: "The payment provider declined the capture, so no payment was collected. No new charge will be attempted without your new approval.",
    body: "The operator may contact you about the delivered energy.",
  },
  VOIDED: {
    tone: "neutral",
    title: "Authorization voided. No payment was collected.",
    body: "The payment provider voided the authorization, so it can no longer be captured. Your bank may take some time to remove the pending hold from your statement. A void is not a refund: nothing was charged to refund.",
  },
  CANCELLED: { tone: "neutral", title: "Checkout cancelled. No authorization was made.", body: "You can request new offers at any time." },
  FAILED: { tone: "danger", title: "Payment could not be started. No charge was made.", body: "Please request new offers." },
  NEEDS_RECONCILIATION: { tone: "warn", title: "Payment status is being reconciled with the provider. No new charge will be attempted.", body: "We confirm the provider's record before showing any result." },
};

type Copy = (typeof PAYMENT_COPY)[PaymentState];

/** Delivered but not yet settled: the capture has been requested and the provider has not answered. */
export const CAPTURE_REQUESTED_COPY: Copy = {
  tone: "info",
  title: "Charging delivered. Capture requested, awaiting the payment provider's confirmation.",
  body: "Nothing is shown as paid until the provider confirms the capture. No second capture will be attempted.",
};

/** Copy for the driver page; payment state is authoritative, service state only refines AUTHORIZED. */
export function paymentCopyFor(paymentState: PaymentState, serviceState: string): Copy {
  if (paymentState === "AUTHORIZED" && serviceState === "DELIVERED") return CAPTURE_REQUESTED_COPY;
  return PAYMENT_COPY[paymentState];
}

export type StepStatus = "done" | "in-progress" | "failed" | "not-started";

/** A provider CAPTURED proof that the local payment state does not reflect: money may have moved, so nothing reads as final. */
export function hasUnreconciledCapture(r: Pick<ReservationView, "paymentState" | "proofs">): boolean {
  return r.paymentState !== "CAPTURED" && r.proofs.some((p) => p.type === "CAPTURED");
}

/** Driver-page copy for a reservation; a contradiction with the provider record reads as reconciliation. */
export function paymentCopyForView(r: Pick<ReservationView, "paymentState" | "serviceState" | "proofs">): Copy {
  return hasUnreconciledCapture(r) ? PAYMENT_COPY.NEEDS_RECONCILIATION : paymentCopyFor(r.paymentState, r.serviceState);
}

/** Final progress step: names the provider-confirmed outcome; a pending capture is never shown as complete. */
export function settlementStep(r: Pick<ReservationView, "paymentState" | "proofs">): { label: string; status: StepStatus } {
  const has = (t: string) => r.proofs.some((p) => p.type === t);
  if (hasUnreconciledCapture(r)) return { label: "Provider recorded a capture: reconciling, not final", status: "in-progress" };
  if (r.paymentState === "CAPTURED" && has("CAPTURED")) return { label: "Payment captured (provider-confirmed)", status: "done" };
  if (r.paymentState === "VOIDED" && has("VOIDED")) return { label: "Authorization voided: not charged (provider-confirmed)", status: "done" };
  if (r.paymentState === "CAPTURE_PENDING") return { label: "Capture pending: not final", status: "in-progress" };
  if (r.paymentState === "CAPTURE_DECLINED") return { label: "Capture declined: not charged", status: "failed" };
  return { label: "Capture or void (provider-confirmed)", status: "not-started" };
}

/** Payment-panel amount: "paid" only with a provider CAPTURED proof; $0.00 once nothing can be collected. */
export function amountLine(r: Pick<ReservationView, "paymentState" | "proofs" | "economics">): { amount: string; note: string; tone: Tone } {
  const price = formatUsd(r.economics.priceCents);
  const capture = r.proofs.find((p) => p.type === "CAPTURED");
  if (capture && r.paymentState !== "CAPTURED") return { amount: formatUsd(capture.amountCents ?? r.economics.priceCents), note: "captured by provider · reconciling, not final", tone: "warn" };
  switch (r.paymentState) {
    case "CAPTURED":
      return capture ? { amount: formatUsd(capture.amountCents ?? r.economics.priceCents), note: "paid", tone: "success" } : { amount: price, note: "not collected · being confirmed", tone: "warn" };
    case "AUTHORIZED":
      return { amount: price, note: "held, not collected", tone: "info" };
    case "CAPTURE_PENDING":
      return { amount: price, note: "held, capture not final", tone: "warn" };
    case "NEEDS_RECONCILIATION":
      return { amount: price, note: "not collected · being confirmed", tone: "warn" };
    case "VOIDED":
    case "CAPTURE_DECLINED":
    case "CANCELLED":
    case "FAILED":
      return { amount: formatUsd(0), note: "not collected", tone: "neutral" };
    default:
      return { amount: price, note: "not yet authorized", tone: "neutral" };
  }
}
