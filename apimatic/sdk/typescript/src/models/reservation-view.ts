import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { economicsSchema, type Economics } from "./economics.js";
import { paymentStateSchema, type PaymentState } from "./payment-state.js";
import { proofViewSchema, type ProofView } from "./proof-view.js";
import { providerModeSchema, type ProviderMode } from "./provider-mode.js";
import { serviceStateSchema, type ServiceState } from "./service-state.js";

export type ReservationView = {
  id?: string;
  providerMode?: ProviderMode;
  paymentState?: PaymentState;
  serviceState?: ServiceState;
  slotsCommitted?: boolean;
  portLabel?: string;
  merchantName?: string;
  timeZone?: string;
  plugInMs?: number;
  departMs?: number;
  targetBatteryWh?: number;
  powerW?: number[];
  termsHash?: string;
  economics?: Economics;
  proofs?: ProofView[];
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const reservationViewSchema: Schema<ReservationView> = s.object<ReservationView>(
  {
    id: s.optional(s.string()),
    providerMode: s.optional(s.lazy(() => providerModeSchema)),
    paymentState: s.optional(s.lazy(() => paymentStateSchema)),
    serviceState: s.optional(s.lazy(() => serviceStateSchema)),
    slotsCommitted: s.optional(s.boolean()),
    portLabel: s.optional(s.string()),
    merchantName: s.optional(s.string()),
    timeZone: s.optional(s.string()),
    plugInMs: s.optional(s.int()),
    departMs: s.optional(s.int()),
    targetBatteryWh: s.optional(s.int()),
    powerW: s.optional(s.array(s.int())),
    termsHash: s.optional(s.string()),
    economics: s.optional(s.lazy(() => economicsSchema)),
    proofs: s.optional(s.array(s.lazy(() => proofViewSchema))),
  },
  { additionalProperties: s.json() },
);
