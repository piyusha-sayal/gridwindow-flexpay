import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

export type ParseResult = {
  /** Fields to pre-fill: targetBatteryKWh, departLocal, minSavingsCents, preference, notes */
  parsed?: Record<string, unknown>;
  source?: string;
  reason?: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const parseResultSchema: Schema<ParseResult> = s.object<ParseResult>(
  {
    parsed: s.optional(s.record(s.string(), s.unknown())),
    source: s.optional(s.string()),
    reason: s.optional(s.string()),
  },
  { additionalProperties: s.json() },
);
