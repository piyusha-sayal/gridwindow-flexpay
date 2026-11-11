import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

export type Rejected = {
  kind?: string;
  reason?: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const rejectedSchema: Schema<Rejected> = s.object<Rejected>(
  {
    kind: s.optional(s.string()),
    reason: s.optional(s.string()),
  },
  { additionalProperties: s.json() },
);
