import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

export type Economics = {
  listPriceCents?: number;
  priceCents?: number;
  discountCents?: number;
  energyCostCents?: number;
  baselineEnergyCostCents?: number | null;
  operatorImprovementCents?: number;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const economicsSchema: Schema<Economics> = s.object<Economics>(
  {
    listPriceCents: s.optional(s.int()),
    priceCents: s.optional(s.int()),
    discountCents: s.optional(s.int()),
    energyCostCents: s.optional(s.int()),
    baselineEnergyCostCents: s.optionalNullable(s.int()),
    operatorImprovementCents: s.optional(s.int()),
  },
  { additionalProperties: s.json() },
);
