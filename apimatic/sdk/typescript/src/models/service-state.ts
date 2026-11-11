import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

export const ServiceState = {
  AwaitingPayment: "AWAITING_PAYMENT",
  Scheduled: "SCHEDULED",
  Delivered: "DELIVERED",
  Failed: "FAILED",
  Cancelled: "CANCELLED",
} as const;
export type ServiceState = (typeof ServiceState)[keyof typeof ServiceState] | (string & {});

export const serviceStateSchema: EnumSchema<ServiceState> = s.enumOf<ServiceState>(ServiceState);
