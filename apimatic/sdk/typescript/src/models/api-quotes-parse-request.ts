import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiQuotesParseRequest = {
  text: string;
};

const apiQuotesParseRequestProperties: s.Shape<ApiQuotesParseRequest> = {
  text: s.string(),
};

export const apiQuotesParseRequestInternalSchema: Schema<ApiQuotesParseRequest> =
  s.object<ApiQuotesParseRequest>(apiQuotesParseRequestProperties);

export const apiQuotesParseRequestSchema: Schema<ApiQuotesParseRequest> = s.lazySchema(() =>
  s.object<ApiQuotesParseRequest>({
    ...apiQuotesParseRequestProperties,
    text: s.string().check(s.maxLength(1000)),
  }),
);
