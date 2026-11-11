import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { kindSchema, type Kind } from "./kind.js";
import { offerTermsSchema, type OfferTerms } from "./offer-terms.js";

export type PricedOffer = {
  offerId?: string;
  kind?: Kind;
  label?: string;
  chargeStartMs?: number;
  chargeEndMs?: number;
  listPriceCents?: number;
  priceCents?: number;
  discountCents?: number;
  energyCostCents?: number;
  operatorImprovementCents?: number;
  powerW?: number[];
  /** The exact agreement. `termsHash` is the SHA-256 of its canonical JSON. */
  terms?: OfferTerms;
  termsHash?: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

const pricedOfferProperties: s.Shape<PricedOffer> = {
  offerId: s.optional(s.string()),
  kind: s.optional(s.lazy(() => kindSchema)),
  label: s.optional(s.string()),
  chargeStartMs: s.optional(s.int()),
  chargeEndMs: s.optional(s.int()),
  listPriceCents: s.optional(s.int()),
  priceCents: s.optional(s.int()),
  discountCents: s.optional(s.int()),
  energyCostCents: s.optional(s.int()),
  operatorImprovementCents: s.optional(s.int()),
  powerW: s.optional(s.array(s.int())),
  terms: s.optional(s.lazy(() => offerTermsSchema)),
  termsHash: s.optional(s.string()),
};

export const pricedOfferInternalSchema: Schema<PricedOffer> = s.object<PricedOffer>(pricedOfferProperties, {
  additionalProperties: s.json(),
});

export const pricedOfferSchema: Schema<PricedOffer> = s.lazySchema(() =>
  s.object<PricedOffer>(
    {
      ...pricedOfferProperties,
      termsHash: s.optional(s.string().check(s.pattern("^[0-9a-f]{64}$"))),
    },
    { additionalProperties: s.json() },
  ),
);
