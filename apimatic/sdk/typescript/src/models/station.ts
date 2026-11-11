import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

export type Station = {
  name?: string;
  timeZone?: string;
  stationCapW?: number;
  ports?: Record<string, unknown>[];
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const stationSchema: Schema<Station> = s.object<Station>(
  {
    name: s.optional(s.string()),
    timeZone: s.optional(s.string()),
    stationCapW: s.optional(s.int()),
    ports: s.optional(s.array(s.record(s.string(), s.unknown()))),
  },
  { additionalProperties: s.json() },
);
