import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

export type ApiOperatorSessionResponse = {
  operator?: boolean;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const apiOperatorSessionResponseSchema: Schema<ApiOperatorSessionResponse> =
  s.object<ApiOperatorSessionResponse>(
    {
      operator: s.optional(s.boolean()),
    },
    { additionalProperties: s.json() },
  );
