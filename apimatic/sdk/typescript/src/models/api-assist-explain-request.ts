import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiAssistExplainRequest = {
  quoteSetId: string;
  offerId: string;
};

const apiAssistExplainRequestProperties: s.Shape<ApiAssistExplainRequest> = {
  quoteSetId: s.string(),
  offerId: s.string(),
};

export const apiAssistExplainRequestInternalSchema: Schema<ApiAssistExplainRequest> =
  s.object<ApiAssistExplainRequest>(apiAssistExplainRequestProperties);

export const apiAssistExplainRequestSchema: Schema<ApiAssistExplainRequest> = s.lazySchema(() =>
  s.object<ApiAssistExplainRequest>({
    ...apiAssistExplainRequestProperties,
    quoteSetId: s.string().check(s.maxLength(64)),
    offerId: s.string().check(s.maxLength(128)),
  }),
);
