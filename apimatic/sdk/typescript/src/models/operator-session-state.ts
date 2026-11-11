import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

export type OperatorSessionState = {
  /** Whether the caller holds an operator session after this call */
  operator: boolean;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const operatorSessionStateSchema: Schema<OperatorSessionState> = s.object<OperatorSessionState>(
  {
    operator: s.boolean(),
  },
  { additionalProperties: s.json() },
);
