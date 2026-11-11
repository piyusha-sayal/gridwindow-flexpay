import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { itemSchema, type Item } from "./item.js";

/** Gear search result */
export type ApiGearResponse = {
  /** False when the server has no Channel3 key */
  enabled?: boolean;
  /** Products, cheapest in-stock offer each */
  items?: Item[];
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const apiGearResponseSchema: Schema<ApiGearResponse> = s.object<ApiGearResponse>(
  {
    enabled: s.optional(s.boolean()),
    items: s.optional(s.array(s.lazy(() => itemSchema))),
  },
  { additionalProperties: s.json() },
);
