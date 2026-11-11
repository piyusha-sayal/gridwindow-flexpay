import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

export type Ai = {
  enabled?: boolean;
  model?: string | null;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const aiSchema: Schema<Ai> = s.object<Ai>(
  {
    enabled: s.optional(s.boolean()),
    model: s.optionalNullable(s.string()),
  },
  { additionalProperties: s.json() },
);
