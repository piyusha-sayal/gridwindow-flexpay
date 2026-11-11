import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** Which produced the text. A deterministic fallback is never presented as a model answer. */
export const AiSourceKind = {
  Model: "MODEL",
  DeterministicFallback: "DETERMINISTIC_FALLBACK",
} as const;
export type AiSourceKind = (typeof AiSourceKind)[keyof typeof AiSourceKind] | (string & {});

export const aiSourceKindSchema: EnumSchema<AiSourceKind> = s.enumOf<AiSourceKind>(AiSourceKind);
