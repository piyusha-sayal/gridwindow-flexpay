import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { pricedOfferInternalSchema, pricedOfferSchema, type PricedOffer } from "./priced-offer.js";
import { rejectedSchema, type Rejected } from "./rejected.js";

export type QuoteSet = {
  quoteSetId?: string;
  stationId?: string;
  createdAtMs?: number;
  expiresAtMs?: number;
  offers?: PricedOffer[];
  rejected?: Rejected[];
  /** Immediate-charging comparison */
  baseline?: Record<string, unknown>;
  /** Tariff, economics and forecast labels; provenance is SYNTHETIC */
  assumptions?: Record<string, unknown>;
  requiredMinSavingsCents?: number | null;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

const quoteSetProperties: s.Shape<QuoteSet> = {
  quoteSetId: s.optional(s.string()),
  stationId: s.optional(s.string()),
  createdAtMs: s.optional(s.int()),
  expiresAtMs: s.optional(s.int()),
  offers: s.optional(s.array(s.lazy(() => pricedOfferInternalSchema))),
  rejected: s.optional(s.array(s.lazy(() => rejectedSchema))),
  baseline: s.optional(s.record(s.string(), s.unknown())),
  assumptions: s.optional(s.record(s.string(), s.unknown())),
  requiredMinSavingsCents: s.optionalNullable(s.int()),
};

export const quoteSetInternalSchema: Schema<QuoteSet> = s.object<QuoteSet>(quoteSetProperties, {
  additionalProperties: s.json(),
});

export const quoteSetSchema: Schema<QuoteSet> = s.lazySchema(() =>
  s.object<QuoteSet>(
    {
      ...quoteSetProperties,
      offers: s.optional(s.array(s.lazy(() => pricedOfferSchema))),
    },
    { additionalProperties: s.json() },
  ),
);
