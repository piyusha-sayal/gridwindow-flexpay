import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { noneAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import { uuid } from "../core/uuid.js";
import * as s from "../core/validation/index.js";
import {
  apiOffersAcceptRequestInternalSchema,
  type ApiOffersAcceptRequest,
} from "../models/api-offers-accept-request.js";
import {
  apiOffersAcceptResponseSchema,
  type ApiOffersAcceptResponse,
} from "../models/api-offers-accept-response.js";
import { errorSchema, type Error } from "../models/error.js";
import type { Servers } from "../servers.js";

/**
 * Accepting an offer and the PayPal approval round trip
 */
export class Checkout {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;

  constructor(rawClient: RawClient, servers: Servers) {
    this.#rawClient = rawClient;
    this.#servers = servers;
  }

  /**
   * Accept one exact, unexpired offer and create the PayPal authorize order
   *
   * @remarks
   * Requires the driver's explicit consent (`consent: true`) and the `termsHash` the driver saw;
   * tampered or expired terms are refused. Returns the PayPal approval link. Nothing is authorized
   * or charged until the buyer approves in PayPal.
   *
   * @returns Reservation created, waiting for buyer approval
   *
   * @throws {@link Checkout.AcceptOfferError} when the API answers with an error status - narrow on
   * `err.payload.kind`
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  acceptOffer(
    request: Checkout.AcceptOfferRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiOffersAcceptResponse, Checkout.AcceptOfferError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/offers/accept"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiOffersAcceptRequestInternalSchema },
      },
      {
        success: { kind: "json", schema: apiOffersAcceptResponseSchema },
        errorFactory: Checkout.AcceptOfferError,
      },
      options,
    );
  }

  /**
   * PayPal cancel URL. Cancels the pending order, then redirects to the reservation
   *
   * @remarks
   * PayPal cancel URL. Cancels the pending order, then redirects to the reservation.
   *
   * @throws {@link Checkout.CheckoutCancelError} when the API answers with an error status - narrow
   * on `err.payload.kind`
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  checkoutCancel(
    request: Checkout.CheckoutCancelRequest,
    options?: RequestOptions,
  ): ApiPromise<undefined, Checkout.CheckoutCancelError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/checkout/cancel"),
        auth: noneAuth,
        pathParams: [],
        query: [
          { name: "rid", value: request.rid, schema: s.string() },
          { name: "state", value: request.state, schema: s.string() },
        ],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "empty" },
        errorFactory: Checkout.CheckoutCancelError,
      },
      options,
    );
  }

  /**
   * PayPal return URL. Authorizes the approved order, then redirects to the reservation
   *
   * @remarks
   * PayPal return URL. Authorizes the approved order, then redirects to the reservation.
   *
   * @throws {@link Checkout.CheckoutReturnError} when the API answers with an error status - narrow
   * on `err.payload.kind`
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  checkoutReturn(
    request: Checkout.CheckoutReturnRequest,
    options?: RequestOptions,
  ): ApiPromise<undefined, Checkout.CheckoutReturnError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/checkout/return"),
        auth: noneAuth,
        pathParams: [],
        query: [
          { name: "rid", value: request.rid, schema: s.string() },
          { name: "state", value: request.state, schema: s.string() },
          { name: "token", value: request.token, schema: s.string() },
        ],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "empty" },
        errorFactory: Checkout.CheckoutReturnError,
      },
      options,
    );
  }
}

export namespace Checkout {
  export type AcceptOfferRequest = {
    body: ApiOffersAcceptRequest;
  };

  export class AcceptOfferError extends ApiError {
    declare readonly payload: Declared<"error", Error> | Declared<"error2", Error> | Undeclared;

    static readonly errors: ErrorDecoders<AcceptOfferError> = [
      { on: 404, kind: "error", decode: { kind: "json", schema: errorSchema } },
      { on: 409, kind: "error2", decode: { kind: "json", schema: errorSchema } },
    ];
  }

  export type CheckoutCancelRequest = {
    rid: string;
    state: string;
  };

  export class CheckoutCancelError extends ApiError {
    declare readonly payload: Declared<"error303", undefined> | Undeclared;

    static readonly errors: ErrorDecoders<CheckoutCancelError> = [
      { on: 303, kind: "error303", decode: { kind: "empty" } },
    ];
  }

  export type CheckoutReturnRequest = {
    rid: string;
    /** Signed anti-forgery state */
    state: string;
    /** PayPal order id */
    token: string;
  };

  export class CheckoutReturnError extends ApiError {
    declare readonly payload: Declared<"error303", undefined> | Undeclared;

    static readonly errors: ErrorDecoders<CheckoutReturnError> = [
      { on: 303, kind: "error303", decode: { kind: "empty" } },
    ];
  }
}
