import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

export const PaymentState = {
  QuoteAccepted: "QUOTE_ACCEPTED",
  OrderCreated: "ORDER_CREATED",
  BuyerApproved: "BUYER_APPROVED",
  Authorized: "AUTHORIZED",
  CapturePending: "CAPTURE_PENDING",
  Captured: "CAPTURED",
  CaptureDeclined: "CAPTURE_DECLINED",
  Voided: "VOIDED",
  Cancelled: "CANCELLED",
  Failed: "FAILED",
  NeedsReconciliation: "NEEDS_RECONCILIATION",
} as const;
export type PaymentState = (typeof PaymentState)[keyof typeof PaymentState] | (string & {});

export const paymentStateSchema: EnumSchema<PaymentState> = s.enumOf<PaymentState>(PaymentState);
