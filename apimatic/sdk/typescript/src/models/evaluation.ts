import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

export type Evaluation = {
  status?: string;
  recommendedOfferId?: string | null;
  candidates?: Record<string, unknown>[];
  backendRejected?: Record<string, unknown>[];
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const evaluationSchema: Schema<Evaluation> = s.object<Evaluation>(
  {
    status: s.optional(s.string()),
    recommendedOfferId: s.optionalNullable(s.string()),
    candidates: s.optional(s.array(s.record(s.string(), s.unknown()))),
    backendRejected: s.optional(s.array(s.record(s.string(), s.unknown()))),
  },
  { additionalProperties: s.json() },
);
