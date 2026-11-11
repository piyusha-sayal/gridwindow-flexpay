import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { noneAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import { uuid } from "../core/uuid.js";
import * as s from "../core/validation/index.js";
import {
  apiAgentDealsRequestInternalSchema,
  type ApiAgentDealsRequest,
} from "../models/api-agent-deals-request.js";
import {
  apiAssistAskRequestInternalSchema,
  type ApiAssistAskRequest,
} from "../models/api-assist-ask-request.js";
import {
  apiAssistExplainRequestInternalSchema,
  type ApiAssistExplainRequest,
} from "../models/api-assist-explain-request.js";
import {
  apiQuotesParseRequestInternalSchema,
  type ApiQuotesParseRequest,
} from "../models/api-quotes-parse-request.js";
import { dealResultSchema, type DealResult } from "../models/deal-result.js";
import { errorSchema, type Error } from "../models/error.js";
import { parseResultSchema, type ParseResult } from "../models/parse-result.js";
import type { Servers } from "../servers.js";

/**
 * Plain-language parsing, explanations and the deal agent (never sets prices or moves money)
 */
export class AiApi {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;

  constructor(rawClient: RawClient, servers: Servers) {
    this.#rawClient = rawClient;
    this.#servers = servers;
  }

  /**
   * Ask a question about one of the caller's reservations
   *
   * @remarks
   * Ask a question about one of the caller's reservations.
   *
   * @returns Grounded answer and its source
   *
   * @throws {@link AiApi.AskAboutReservationError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  askAboutReservation(
    request: AiApi.AskAboutReservationRequest,
    options?: RequestOptions,
  ): ApiPromise<Record<string, unknown>, AiApi.AskAboutReservationError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/assist/ask"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiAssistAskRequestInternalSchema },
      },
      {
        success: { kind: "json", schema: s.record(s.string(), s.unknown()) },
        errorFactory: AiApi.AskAboutReservationError,
      },
      options,
    );
  }

  /**
   * Explain one of the caller's offers in plain language
   *
   * @remarks
   * Numbers come from the stored quote; model text is checked against them before it is shown.
   *
   * @returns Explanation and its source
   *
   * @throws {@link AiApi.ExplainOfferError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  explainOffer(
    request: AiApi.ExplainOfferRequest,
    options?: RequestOptions,
  ): ApiPromise<Record<string, unknown>, AiApi.ExplainOfferError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/assist/explain"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiAssistExplainRequestInternalSchema },
      },
      {
        success: { kind: "json", schema: s.record(s.string(), s.unknown()) },
        errorFactory: AiApi.ExplainOfferError,
      },
      options,
    );
  }

  /**
   * Turn a plain-language request into form fields
   *
   * @remarks
   * Fills a form only. It sets no price and approves nothing. Falls back to a labelled
   * deterministic parser when no AI provider is available.
   *
   * @returns Parsed fields and their source
   *
   * @throws {@link AiApi.ParseChargingRequestError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  parseChargingRequest(
    request: AiApi.ParseChargingRequestRequest,
    options?: RequestOptions,
  ): ApiPromise<ParseResult, AiApi.ParseChargingRequestError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/quotes/parse"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiQuotesParseRequestInternalSchema },
      },
      {
        success: { kind: "json", schema: parseResultSchema },
        errorFactory: AiApi.ParseChargingRequestError,
      },
      options,
    );
  }

  /**
   * Ask the deal agent to pick one of the caller's offers for a goal
   *
   * @remarks
   * Read-only. It evaluates only offers the backend already priced and never accepts or pays.
   *
   * @returns The recommendation and the evaluation behind it
   *
   * @throws {@link AiApi.RecommendOfferError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  recommendOffer(
    request: AiApi.RecommendOfferRequest,
    options?: RequestOptions,
  ): ApiPromise<DealResult, AiApi.RecommendOfferError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/agent/deals"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiAgentDealsRequestInternalSchema },
      },
      {
        success: { kind: "json", schema: dealResultSchema },
        errorFactory: AiApi.RecommendOfferError,
      },
      options,
    );
  }
}

export namespace AiApi {
  export type AskAboutReservationRequest = {
    body: ApiAssistAskRequest;
  };

  export class AskAboutReservationError extends ApiError {
    declare readonly payload: Declared<"error", Error> | Undeclared;

    static readonly errors: ErrorDecoders<AskAboutReservationError> = [
      { on: 404, kind: "error", decode: { kind: "json", schema: errorSchema } },
    ];
  }

  export type ExplainOfferRequest = {
    body: ApiAssistExplainRequest;
  };

  export class ExplainOfferError extends ApiError {
    declare readonly payload: Declared<"error", Error> | Undeclared;

    static readonly errors: ErrorDecoders<ExplainOfferError> = [
      { on: 404, kind: "error", decode: { kind: "json", schema: errorSchema } },
    ];
  }

  export type ParseChargingRequestRequest = {
    body: ApiQuotesParseRequest;
  };

  export class ParseChargingRequestError extends ApiError {
    declare readonly payload: Declared<"error", Error> | Declared<"error2", Error> | Undeclared;

    static readonly errors: ErrorDecoders<ParseChargingRequestError> = [
      { on: 400, kind: "error", decode: { kind: "json", schema: errorSchema } },
      { on: 429, kind: "error2", decode: { kind: "json", schema: errorSchema } },
    ];
  }

  export type RecommendOfferRequest = {
    body: ApiAgentDealsRequest;
  };

  export class RecommendOfferError extends ApiError {
    declare readonly payload: Declared<"error", Error> | Declared<"error2", Error> | Undeclared;

    static readonly errors: ErrorDecoders<RecommendOfferError> = [
      { on: 404, kind: "error", decode: { kind: "json", schema: errorSchema } },
      { on: 409, kind: "error2", decode: { kind: "json", schema: errorSchema } },
    ];
  }
}
