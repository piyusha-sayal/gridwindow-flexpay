import { ApiError } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { noneAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import { siteConfigInternalSchema, type SiteConfig } from "../models/site-config.js";
import type { Servers } from "../servers.js";

/**
 * Station, ports and payment mode
 */
export class Site {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;

  constructor(rawClient: RawClient, servers: Servers) {
    this.#rawClient = rawClient;
    this.#servers = servers;
  }

  /**
   * Station, ports, payment mode, AI status and the default charging window
   *
   * @remarks
   * Station, ports, payment mode, AI status and the default charging window.
   *
   * @returns Site configuration
   *
   * @throws {@link ApiError} when the API answers with an error status
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  getSiteConfig(options?: RequestOptions): ApiPromise<SiteConfig, ApiError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/config"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: siteConfigInternalSchema },
        errorFactory: ApiError,
      },
      options,
    );
  }
}
