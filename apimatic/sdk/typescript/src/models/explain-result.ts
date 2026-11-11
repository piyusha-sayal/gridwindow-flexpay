import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { aiSourceKindSchema, type AiSourceKind } from "./ai-source-kind.js";

export type ExplainResult = {
  summary: string;
  points: string[];
  /** Which produced the text. A deterministic fallback is never presented as a model answer. */
  source: AiSourceKind;
  model?: string;
  reason?: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const explainResultSchema: Schema<ExplainResult> = s.object<ExplainResult>(
  {
    summary: s.string(),
    points: s.array(s.string()),
    source: aiSourceKindSchema,
    model: s.optional(s.string()),
    reason: s.optional(s.string()),
  },
  { additionalProperties: s.json() },
);
