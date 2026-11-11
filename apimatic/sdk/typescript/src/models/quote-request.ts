import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type QuoteRequest = {
  portId: string;
  nightOf: string;
  /** Station-local time */
  plugInLocal: string;
  /** Station-local ready-by time (next morning) */
  departLocal: string;
  /** At most 2 decimals */
  targetBatteryKWh: number;
  spendCapCents: number;
  /** Mandatory minimum saving versus immediate charging; accept refuses offers that save less */
  requiredMinSavingsCents?: number;
};

const quoteRequestProperties: s.Shape<QuoteRequest> = {
  portId: s.string(),
  nightOf: s.string(),
  plugInLocal: s.string(),
  departLocal: s.string(),
  targetBatteryKWh: s.float64(),
  spendCapCents: s.int(),
  requiredMinSavingsCents: s.optional(s.int()),
};

export const quoteRequestInternalSchema: Schema<QuoteRequest> =
  s.object<QuoteRequest>(quoteRequestProperties);

export const quoteRequestSchema: Schema<QuoteRequest> = s.lazySchema(() =>
  s.object<QuoteRequest>({
    ...quoteRequestProperties,
    portId: s.string().check(s.maxLength(32)),
    nightOf: s.string().check(s.pattern("^\\d{4}-\\d{2}-\\d{2}$")),
    plugInLocal: s.string().check(s.pattern("^\\d{2}:\\d{2}$")),
    departLocal: s.string().check(s.pattern("^\\d{2}:\\d{2}$")),
    targetBatteryKWh: s.float64().check(s.gte(0.01), s.lte(120)),
    spendCapCents: s.int().check(s.gte(100), s.lte(50000)),
    requiredMinSavingsCents: s.optional(s.int().check(s.gte(1), s.lte(50000))),
  }),
);
