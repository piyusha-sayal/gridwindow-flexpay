import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { noneAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import { uuid } from "../core/uuid.js";
import * as s from "../core/validation/index.js";
import type { Servers } from "../servers.js";

/**
 * PayPal Sandbox webhooks
 */
export class Webhooks {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;

  constructor(rawClient: RawClient, servers: Servers) {
    this.#rawClient = rawClient;
    this.#servers = servers;
  }

  /**
   * PayPal Sandbox webhook receiver
   *
   * @remarks
   * Verifies the PayPal signature against the unaltered body, then re-reads provider state. A
   * webhook alone never marks a payment captured or voided.
   *
   * @returns Accepted
   *
   * @throws {@link Webhooks.PaypalWebhookError} when the API answers with an error status — narrow
   * on `err.payload.kind`
   *
   * @throws {@link GridWindowFlexPayApiError} when no usable response was produced: a connection
   * failure, a timeout, a body that would not decode, a value that would not encode, or a
   * credential that could not be obtained
   */
  paypalWebhook(
    request: Webhooks.PaypalWebhookRequest,
    options?: RequestOptions,
  ): ApiPromise<undefined, Webhooks.PaypalWebhookError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/webhooks/paypal"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: s.record(s.string(), s.unknown()) },
      },
      {
        success: { kind: "empty" },
        errorFactory: Webhooks.PaypalWebhookError,
      },
      options,
    );
  }
}

export namespace Webhooks {
  export type PaypalWebhookRequest = {
    body: Record<string, unknown>;
  };

  export class PaypalWebhookError extends ApiError {
    declare readonly payload: Declared<"error400", undefined> | Undeclared;

    static readonly errors: ErrorDecoders<PaypalWebhookError> = [
      { on: 400, kind: "error400", decode: { kind: "empty" } },
    ];
  }
}
