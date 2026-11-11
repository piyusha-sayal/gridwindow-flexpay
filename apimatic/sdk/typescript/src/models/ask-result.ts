import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { aiSourceKindSchema, type AiSourceKind } from "./ai-source-kind.js";

export type AskResult = {
  answer: string;
  /** False when the question is outside what the assistant may answer */
  inScope: boolean;
  /** Which produced the text. A deterministic fallback is never presented as a model answer. */
  source: AiSourceKind;
  model?: string;
  reason?: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const askResultSchema: Schema<AskResult> = s.object<AskResult>(
  {
    answer: s.string(),
    inScope: s.boolean(),
    source: aiSourceKindSchema,
    model: s.optional(s.string()),
    reason: s.optional(s.string()),
  },
  { additionalProperties: s.json() },
);
