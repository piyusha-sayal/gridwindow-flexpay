import type { ClientOptions } from "./client-options.js";
import type { AuthScheme } from "./core/api-request.js";
import { apiKeyCookieAuth } from "./core/auth/schemes.js";

export type AuthSchemes = {
  readonly operatorCookie: AuthScheme;
};

export function buildAuthSchemes(options: ClientOptions): AuthSchemes {
  return {
    operatorCookie: apiKeyCookieAuth({ name: "gw_op", token: options.operatorCookie }),
  };
}
