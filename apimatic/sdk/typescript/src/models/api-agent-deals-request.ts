import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { preferenceSchema, type Preference } from "./preference.js";

export type ApiAgentDealsRequest = {
  quoteSetId: string;
  minSavingsCents: number | null;
  preference: Preference;
};

const apiAgentDealsRequestProperties: s.Shape<ApiAgentDealsRequest> = {
  quoteSetId: s.string(),
  minSavingsCents: s.nullable(s.int()),
  preference: preferenceSchema,
};

export const apiAgentDealsRequestInternalSchema: Schema<ApiAgentDealsRequest> =
  s.object<ApiAgentDealsRequest>(apiAgentDealsRequestProperties);

export const apiAgentDealsRequestSchema: Schema<ApiAgentDealsRequest> = s.lazySchema(() =>
  s.object<ApiAgentDealsRequest>({
    ...apiAgentDealsRequestProperties,
    quoteSetId: s.string().check(s.maxLength(64)),
    minSavingsCents: s.nullable(s.int().check(s.gte(1), s.lte(50000))),
  }),
);
