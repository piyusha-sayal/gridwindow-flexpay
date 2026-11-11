import type { AuthSchemes } from "../auth-schemes.js";
import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { noneAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import { uuid } from "../core/uuid.js";
import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import {
  apiOperatorSessionRequestInternalSchema,
  type ApiOperatorSessionRequest,
} from "../models/api-operator-session-request.js";
import {
  apiOperatorSessionResponseSchema,
  type ApiOperatorSessionResponse,
} from "../models/api-operator-session-response.js";
import { errorSchema, type Error } from "../models/error.js";
import { operatorSessionStateSchema, type OperatorSessionState } from "../models/operator-session-state.js";
import type { Servers } from "../servers.js";

/**
 * Operator session and night dashboard
 */
export class Operator {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;
  readonly #auth: AuthSchemes;

  constructor(rawClient: RawClient, servers: Servers, auth: AuthSchemes) {
    this.#rawClient = rawClient;
    this.#servers = servers;
    this.#auth = auth;
  }

  /**
   * Every reservation of a night with load, ports and payment states
   *
   * @remarks
   * Every reservation of a night with load, ports and payment states.
   *
   * @returns Dashboard data
   *
   * @throws {@link Operator.GetOperatorDashboardError} when the API answers with an error status - 
   * narrow on `err.payload.kind`
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  getOperatorDashboard(
    request: Operator.GetOperatorDashboardRequest = {},
    options?: RequestOptions,
  ): ApiPromise<Record<string, unknown>, Operator.GetOperatorDashboardError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/operator/dashboard"),
        auth: this.#auth.operatorCookie,
        pathParams: [],
        query: [{ name: "night", value: request.night, schema: s.optional(s.string()) }],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: s.record(s.string(), s.unknown()) },
        errorFactory: Operator.GetOperatorDashboardError,
      },
      options,
    );
  }

  /**
   * Whether the caller holds an operator session
   *
   * @remarks
   * Whether the caller holds an operator session.
   *
   * @returns Session state
   *
   * @throws {@link ApiError} when the API answers with an error status
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  getOperatorSession(options?: RequestOptions): ApiPromise<ApiOperatorSessionResponse, ApiError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/operator/session"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: apiOperatorSessionResponseSchema },
        errorFactory: ApiError,
      },
      options,
    );
  }

  /**
   * Sign in with the operator passphrase
   *
   * @remarks
   * Sign in with the operator passphrase.
   *
   * @returns Signed in; sets the operator cookie
   *
   * @throws {@link Operator.OperatorSignInError} when the API answers with an error status - narrow
   * on `err.payload.kind`
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  operatorSignIn(
    request: Operator.OperatorSignInRequest,
    options?: RequestOptions,
  ): ApiPromise<OperatorSessionState, Operator.OperatorSignInError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/operator/session"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiOperatorSessionRequestInternalSchema },
      },
      {
        success: { kind: "json", schema: operatorSessionStateSchema },
        errorFactory: Operator.OperatorSignInError,
      },
      options,
    );
  }

  /**
   * Sign out
   *
   * @remarks
   * Sign out.
   *
   * @returns Signed out; clears the operator cookie
   *
   * @throws {@link ApiError} when the API answers with an error status
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  operatorSignOut(options?: RequestOptions): ApiPromise<OperatorSessionState, ApiError> {
    return this.#rawClient.execute(
      {
        method: "DELETE",
        urlTemplate: this.#servers.default("/api/operator/session"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: operatorSessionStateSchema },
        errorFactory: ApiError,
      },
      options,
    );
  }
}

export namespace Operator {
  export type GetOperatorDashboardRequest = {
    /** Night to show (YYYY-MM-DD, station-local). Defaults to the current charging night. */
    night?: string;
  };

  export const getOperatorDashboardRequestSchema: Schema<GetOperatorDashboardRequest> = s.lazySchema(() =>
    s.object<GetOperatorDashboardRequest>({
      night: s.optional(s.string().check(s.pattern("^\\d{4}-\\d{2}-\\d{2}$"))),
    }),
  );

  export class GetOperatorDashboardError extends ApiError {
    declare readonly payload: Declared<"error", Error> | Undeclared;

    static readonly errors: ErrorDecoders<GetOperatorDashboardError> = [
      { on: 401, kind: "error", decode: { kind: "json", schema: errorSchema } },
    ];
  }

  export type OperatorSignInRequest = {
    body: ApiOperatorSessionRequest;
  };

  export class OperatorSignInError extends ApiError {
    declare readonly payload: Declared<"error", Error> | Undeclared;

    static readonly errors: ErrorDecoders<OperatorSignInError> = [
      { on: 401, kind: "error", decode: { kind: "json", schema: errorSchema } },
    ];
  }
}
