import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { quoteSetInternalSchema, quoteSetSchema, type QuoteSet } from "./quote-set.js";

export type ApiQuotesResponse = {
  quote: QuoteSet;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

const apiQuotesResponseProperties: s.Shape<ApiQuotesResponse> = {
  quote: quoteSetInternalSchema,
};

export const apiQuotesResponseInternalSchema: Schema<ApiQuotesResponse> = s.object<ApiQuotesResponse>(
  apiQuotesResponseProperties,
  { additionalProperties: s.json() },
);

export const apiQuotesResponseSchema: Schema<ApiQuotesResponse> = s.lazySchema(() =>
  s.object<ApiQuotesResponse>(
    {
      ...apiQuotesResponseProperties,
      quote: quoteSetSchema,
    },
    { additionalProperties: s.json() },
  ),
);
