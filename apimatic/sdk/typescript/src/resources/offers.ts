import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { noneAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import { uuid } from "../core/uuid.js";
import * as s from "../core/validation/index.js";
import { apiQuotesResponseInternalSchema, type ApiQuotesResponse } from "../models/api-quotes-response.js";
import { errorSchema, type Error } from "../models/error.js";
import { quoteRequestInternalSchema, type QuoteRequest } from "../models/quote-request.js";
import type { Servers } from "../servers.js";

/**
 * Priced charging offers with exact terms
 */
export class Offers {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;

  constructor(rawClient: RawClient, servers: Servers) {
    this.#rawClient = rawClient;
    this.#servers = servers;
  }

  /**
   * Request priced charging offers for one port and night
   *
   * @remarks
   * Creates the driver session cookie if absent. Each offer carries exact terms and their SHA-256
   * `termsHash`, which accept must echo.
   *
   * @returns The quote set
   *
   * @throws {@link Offers.RequestOffersError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  requestOffers(
    request: Offers.RequestOffersRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiQuotesResponse, Offers.RequestOffersError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/quotes"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: quoteRequestInternalSchema },
      },
      {
        success: { kind: "json", schema: apiQuotesResponseInternalSchema },
        errorFactory: Offers.RequestOffersError,
      },
      options,
    );
  }
}

export namespace Offers {
  export type RequestOffersRequest = {
    body: QuoteRequest;
  };

  export class RequestOffersError extends ApiError {
    declare readonly payload:
      | Declared<"error", Error>
      | Declared<"error2", Error>
      | Declared<"error3", Error>
      | Declared<"error4", Error>
      | Undeclared;

    static readonly errors: ErrorDecoders<RequestOffersError> = [
      { on: 400, kind: "error", decode: { kind: "json", schema: errorSchema } },
      { on: 403, kind: "error2", decode: { kind: "json", schema: errorSchema } },
      { on: 409, kind: "error3", decode: { kind: "json", schema: errorSchema } },
      { on: 429, kind: "error4", decode: { kind: "json", schema: errorSchema } },
    ];
  }
}
