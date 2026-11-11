import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { evaluationSchema, type Evaluation } from "./evaluation.js";

export type DealResult = {
  evaluation?: Evaluation;
  /** Which model or the deterministic fallback produced the narrative */
  source?: Record<string, unknown>;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const dealResultSchema: Schema<DealResult> = s.object<DealResult>(
  {
    evaluation: s.optional(s.lazy(() => evaluationSchema)),
    source: s.optional(s.record(s.string(), s.unknown())),
  },
  { additionalProperties: s.json() },
);
