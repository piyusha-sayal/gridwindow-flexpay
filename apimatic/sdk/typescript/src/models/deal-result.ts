import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { aiSourceKindSchema, type AiSourceKind } from "./ai-source-kind.js";
import { evaluationSchema, type Evaluation } from "./evaluation.js";

export type DealResult = {
  evaluation?: Evaluation;
  /** Plain-language recommendation; every figure comes from the server-priced quote */
  summary?: string;
  points?: string[];
  /** Which produced the text. A deterministic fallback is never presented as a model answer. */
  source?: AiSourceKind;
  /** Model that wrote the narrative (present when source is MODEL) */
  model?: string;
  /** Why the deterministic fallback answered (present when source is DETERMINISTIC_FALLBACK) */
  reason?: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const dealResultSchema: Schema<DealResult> = s.object<DealResult>(
  {
    evaluation: s.optional(s.lazy(() => evaluationSchema)),
    summary: s.optional(s.string()),
    points: s.optional(s.array(s.string())),
    source: s.optional(s.lazy(() => aiSourceKindSchema)),
    model: s.optional(s.string()),
    reason: s.optional(s.string()),
  },
  { additionalProperties: s.json() },
);
