import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiOperatorSessionRequest = {
  passphrase: string;
};

const apiOperatorSessionRequestProperties: s.Shape<ApiOperatorSessionRequest> = {
  passphrase: s.string(),
};

export const apiOperatorSessionRequestInternalSchema: Schema<ApiOperatorSessionRequest> =
  s.object<ApiOperatorSessionRequest>(apiOperatorSessionRequestProperties);

export const apiOperatorSessionRequestSchema: Schema<ApiOperatorSessionRequest> = s.lazySchema(() =>
  s.object<ApiOperatorSessionRequest>({
    ...apiOperatorSessionRequestProperties,
    passphrase: s.string().check(s.minLength(1), s.maxLength(256)),
  }),
);
