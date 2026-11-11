import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

/** Provider evidence read back from PayPal (or MOCK) before any paid or voided label */
export type ProofView = {
  type?: string;
  ref?: string;
  status?: string;
  amountCents?: number;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const proofViewSchema: Schema<ProofView> = s.object<ProofView>(
  {
    type: s.optional(s.string()),
    ref: s.optional(s.string()),
    status: s.optional(s.string()),
    amountCents: s.optional(s.int()),
  },
  { additionalProperties: s.json() },
);
