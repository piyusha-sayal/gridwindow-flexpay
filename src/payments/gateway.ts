/** Provider-neutral payment gateway contract. Authoritative money operations go through here only. */

export type ProviderMode = "PAYPAL_SANDBOX" | "MOCK";

/**
 * How long PayPal honours a PayPal-Request-Id for Orders v2 create (6 hours, per
 * https://developer.paypal.com/sdk/orders/v2/orders-create/). After this a same-key replay may
 * create a second order, so replays must finish well inside it.
 */
export const PAYPAL_REQUEST_ID_RETENTION_MS = 6 * 60 * 60_000;

export type ProviderErrorKind = "TIMEOUT" | "NETWORK" | "HTTP_4XX" | "HTTP_5XX" | "INVALID_RESPONSE" | "CONFIG";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly httpStatus?: number,
    readonly debugId?: string,
    readonly issue?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  /** The provider may or may not have applied the operation: reconcile, never blindly re-charge. */
  get ambiguous(): boolean {
    return this.kind === "TIMEOUT" || this.kind === "NETWORK" || this.kind === "HTTP_5XX";
  }
}

export interface CreateOrderInput {
  reservationId: string;
  amountCents: number;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  requestId: string;
}

export interface ProviderOrder {
  orderId: string;
  status: string;
  amountCents: number | null;
  currency: string | null;
  customId: string | null;
  approveUrl: string | null;
  authorizations: ProviderAuthorization[];
  /** Receiving merchant as reported by the provider, when present (used to confirm the sandbox merchant). */
  payeeMerchantId?: string | null;
}

export interface ProviderAuthorization {
  authorizationId: string;
  status: string;
  amountCents: number;
  currency: string;
  expirationTime: string | null;
}

export interface ProviderCapture {
  captureId: string;
  status: string;
  amountCents: number;
  currency: string;
  /** Authorization this capture belongs to, per the provider (`supplementary_data.related_ids`). */
  authorizationId: string | null;
}

export type WebhookHeaders = Record<string, string | null>;

export interface PaymentGateway {
  readonly mode: ProviderMode;
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>;
  getOrder(orderId: string): Promise<ProviderOrder>;
  authorizeOrder(orderId: string, requestId: string): Promise<ProviderAuthorization>;
  getAuthorization(authorizationId: string): Promise<ProviderAuthorization>;
  captureAuthorization(authorizationId: string, amountCents: number, invoiceId: string, requestId: string): Promise<ProviderCapture>;
  getCapture(captureId: string): Promise<ProviderCapture>;
  voidAuthorization(authorizationId: string, requestId: string): Promise<void>;
  /** Verifies a webhook against the exact raw body. Must return false on any doubt. */
  verifyWebhook(headers: WebhookHeaders, rawBody: string): Promise<boolean>;
}
