import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { noneAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { apiGearResponseSchema, type ApiGearResponse } from "../models/api-gear-response.js";
import { errorSchema, type Error } from "../models/error.js";
import type { Servers } from "../servers.js";

/**
 * EV accessory search through Channel3 (read-only)
 */
export class Gear {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;

  constructor(rawClient: RawClient, servers: Servers) {
    this.#rawClient = rawClient;
    this.#servers = servers;
  }

  /**
   * Find in-stock EV charging accessories across merchants
   *
   * @remarks
   * Read-only product search through Channel3. Returns merchant links; nothing is bought. `enabled`
   * is false when no Channel3 key is configured on the server.
   *
   * @returns Search result
   *
   * @throws {@link Gear.FindEvGearError} when the API answers with an error status - narrow on
   * `err.payload.kind`
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  findEvGear(
    request: Gear.FindEvGearRequest = {},
    options?: RequestOptions,
  ): ApiPromise<ApiGearResponse, Gear.FindEvGearError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/gear"),
        auth: noneAuth,
        pathParams: [],
        query: [
          { name: "q", value: request.q, schema: s.optional(s.string()) },
          { name: "maxPriceCents", value: request.maxPriceCents, schema: s.optional(s.int()) },
          { name: "limit", value: request.limit, schema: s.optional(s.int()) },
        ],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: apiGearResponseSchema },
        errorFactory: Gear.FindEvGearError,
      },
      options,
    );
  }
}

export namespace Gear {
  export type FindEvGearRequest = {
    /** Search text; defaults to common EV charging accessories. */
    q?: string;
    /** Price cap in US cents. */
    maxPriceCents?: number;
    /** Number of results (1-12). */
    limit?: number;
  };

  export const findEvGearRequestSchema: Schema<FindEvGearRequest> = s.lazySchema(() =>
    s.object<FindEvGearRequest>({
      q: s.optional(s.string().check(s.maxLength(200))),
      maxPriceCents: s.optional(s.int().check(s.gte(100), s.lte(500000))),
      limit: s.optional(s.int().check(s.gte(1), s.lte(12))),
    }),
  );

  export class FindEvGearError extends ApiError {
    declare readonly payload: Declared<"error", Error> | Undeclared;

    static readonly errors: ErrorDecoders<FindEvGearError> = [
      { on: 429, kind: "error", decode: { kind: "json", schema: errorSchema } },
    ];
  }
}
