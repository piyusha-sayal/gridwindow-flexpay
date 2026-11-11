import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

/** One product */
export type Item = {
  /** Channel3 product id */
  id?: string;
  /** Product title */
  title?: string;
  /** Brand name */
  brand?: string | null;
  /** Product image */
  imageUrl?: string | null;
  /** Price in US cents */
  priceCents?: number;
  /** Pre-discount price in cents */
  compareAtCents?: number | null;
  /** Currency code */
  currency?: string;
  /** Merchant offer link */
  url?: string;
  /** Merchant domain */
  domain?: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const itemSchema: Schema<Item> = s.object<Item>(
  {
    id: s.optional(s.string()),
    title: s.optional(s.string()),
    brand: s.optionalNullable(s.string()),
    imageUrl: s.optionalNullable(s.string()),
    priceCents: s.optional(s.int()),
    compareAtCents: s.optionalNullable(s.int()),
    currency: s.optional(s.string()),
    url: s.optional(s.string()),
    domain: s.optional(s.string()),
  },
  { additionalProperties: s.json() },
);
