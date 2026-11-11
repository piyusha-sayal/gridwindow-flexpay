import type { TokenProvider } from "./core/auth/credentials.js";
import type { CoreClientOptions } from "./core/client-options.js";
import { ServerEnvironment } from "./servers.js";

export type ClientOptions = SdkClientOptions & CoreClientOptions;

type SdkClientOptions = ServerOptions & {
  /** Signed operator session cookie set by POST /api/operator/session. */
  readonly operatorCookie?: TokenProvider | undefined;
};

type ServerOptions =
  | {
      readonly serverEnvironment?: typeof ServerEnvironment.Production;
      /** Hosted demo (Render free tier; the first request after idle wakes the service) */
      readonly serverOptions?: {
        baseUrl?: string;
      };
    }
  | {
      readonly serverEnvironment: typeof ServerEnvironment.Environment2;
      /** Hosted demo (Render free tier; the first request after idle wakes the service) */
      readonly serverOptions?: {
        baseUrl?: string;
      };
    };
