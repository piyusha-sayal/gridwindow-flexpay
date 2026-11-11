import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { currencySchema, type Currency } from "./currency.js";

/** The exact agreement. `termsHash` is the SHA-256 of its canonical JSON. */
export type OfferTerms = {
  version?: string;
  quoteSetId?: string;
  offerId?: string;
  stationId?: string;
  merchantRef?: string;
  portId?: string;
  currency?: Currency;
  amountCents?: number;
  listPriceCents?: number;
  targetBatteryWh?: number;
  plugInMs?: number;
  departMs?: number;
  gridStartMs?: number;
  /** Planned charging power per quarter-hour slot */
  powerW?: number[];
  expiresAtMs?: number;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const offerTermsSchema: Schema<OfferTerms> = s.object<OfferTerms>(
  {
    version: s.optional(s.string()),
    quoteSetId: s.optional(s.string()),
    offerId: s.optional(s.string()),
    stationId: s.optional(s.string()),
    merchantRef: s.optional(s.string()),
    portId: s.optional(s.string()),
    currency: s.optional(s.lazy(() => currencySchema)),
    amountCents: s.optional(s.int()),
    listPriceCents: s.optional(s.int()),
    targetBatteryWh: s.optional(s.int()),
    plugInMs: s.optional(s.int()),
    departMs: s.optional(s.int()),
    gridStartMs: s.optional(s.int()),
    powerW: s.optional(s.array(s.int())),
    expiresAtMs: s.optional(s.int()),
  },
  { additionalProperties: s.json() },
);
