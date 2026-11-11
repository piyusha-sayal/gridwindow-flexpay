import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { noneAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import * as s from "../core/validation/index.js";
import {
  apiReservationsResponseSchema,
  type ApiReservationsResponse,
} from "../models/api-reservations-response.js";
import {
  apiReservationsResponse1Schema,
  type ApiReservationsResponse1,
} from "../models/api-reservations-response1.js";
import { errorSchema, type Error } from "../models/error.js";
import type { Servers } from "../servers.js";

/**
 * Reservation, payment state and provider proofs
 */
export class Reservations {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;

  constructor(rawClient: RawClient, servers: Servers) {
    this.#rawClient = rawClient;
    this.#servers = servers;
  }

  /**
   * One reservation with payment state, provider proofs and receipt data
   *
   * @remarks
   * One reservation with payment state, provider proofs and receipt data.
   *
   * @returns The reservation
   *
   * @throws {@link Reservations.GetReservationError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  getReservation(
    request: Reservations.GetReservationRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiReservationsResponse1, Reservations.GetReservationError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/reservations/{id}"),
        auth: noneAuth,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: apiReservationsResponse1Schema },
        errorFactory: Reservations.GetReservationError,
      },
      options,
    );
  }

  /**
   * Reservations made in the caller's driver session
   *
   * @remarks
   * Reservations made in the caller's driver session.
   *
   * @returns The caller's reservations (empty without a session)
   *
   * @throws {@link ApiError} when the API answers with an error status
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  listMyReservations(options?: RequestOptions): ApiPromise<ApiReservationsResponse, ApiError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/reservations"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: apiReservationsResponseSchema },
        errorFactory: ApiError,
      },
      options,
    );
  }
}

export namespace Reservations {
  export type GetReservationRequest = {
    id: string;
  };

  export class GetReservationError extends ApiError {
    declare readonly payload: Declared<"error", Error> | Undeclared;

    static readonly errors: ErrorDecoders<GetReservationError> = [
      { on: 404, kind: "error", decode: { kind: "json", schema: errorSchema } },
    ];
  }
}
