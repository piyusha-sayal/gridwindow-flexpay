/**
 * PayPal REST (Orders v2 + Payments v2) client pinned to the SANDBOX host.
 * Endpoints: /v1/oauth2/token, /v2/checkout/orders, /v2/checkout/orders/{id}/authorize,
 * /v2/payments/authorizations/{id}[/capture|/void], /v2/payments/captures/{id},
 * /v1/notifications/verify-webhook-signature.
 * NOT VERIFIED against the live sandbox until a smoke run with real sandbox credentials.
 */
import { z } from "zod";
import { centsToUsd, usdToCents } from "@/domain/units";
import {
  ProviderError,
  type CreateOrderInput,
  type PaymentGateway,
  type ProviderAuthorization,
  type ProviderCapture,
  type ProviderOrder,
  type WebhookHeaders,
} from "./gateway";

export const PAYPAL_SANDBOX_API = "https://api-m.sandbox.paypal.com";
/** The only place a buyer may be sent to approve a sandbox order. */
export const PAYPAL_SANDBOX_CHECKOUT_ORIGIN = "https://www.sandbox.paypal.com";
const DEFAULT_TIMEOUT_MS = 15_000;

const money = z.object({ currency_code: z.string(), value: z.string() });
const link = z.object({ href: z.string(), rel: z.string() });
const authorizationSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: money,
  expiration_time: z.string().optional(),
});
const captureSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: money,
  supplementary_data: z.object({ related_ids: z.object({ authorization_id: z.string().optional() }).optional() }).optional(),
});

function toCapture(c: z.infer<typeof captureSchema>): ProviderCapture {
  return {
    captureId: c.id,
    status: c.status,
    amountCents: usdToCents(c.amount.value),
    currency: c.amount.currency_code,
    authorizationId: c.supplementary_data?.related_ids?.authorization_id ?? null,
  };
}
const orderSchema = z.object({
  id: z.string(),
  status: z.string(),
  links: z.array(link).optional(),
  purchase_units: z
    .array(
      z.object({
        custom_id: z.string().optional(),
        amount: money.optional(),
        payee: z.object({ merchant_id: z.string().optional() }).optional(),
        payments: z.object({ authorizations: z.array(authorizationSchema).optional() }).optional(),
      }),
    )
    .optional(),
});

export interface PayPalSandboxConfig {
  clientId: string;
  clientSecret: string;
  webhookId: string | null;
  brandName: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function toAuthorization(a: z.infer<typeof authorizationSchema>): ProviderAuthorization {
  return {
    authorizationId: a.id,
    status: a.status,
    amountCents: usdToCents(a.amount.value),
    currency: a.amount.currency_code,
    expirationTime: a.expiration_time ?? null,
  };
}

/** Rejects an approval link that would send the buyer anywhere but PayPal's sandbox checkout over HTTPS. */
function checkoutLink(href: string | undefined): string | null {
  if (href === undefined) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new ProviderError("INVALID_RESPONSE", "approval link is not a valid URL");
  }
  if (url.origin !== PAYPAL_SANDBOX_CHECKOUT_ORIGIN) throw new ProviderError("INVALID_RESPONSE", "approval link is not on the PayPal sandbox checkout host");
  return url.toString();
}

function toOrder(o: z.infer<typeof orderSchema>): ProviderOrder {
  const unit = o.purchase_units?.[0];
  const approve = o.links?.find((l) => l.rel === "payer-action" || l.rel === "approve");
  return {
    orderId: o.id,
    status: o.status,
    amountCents: unit?.amount ? usdToCents(unit.amount.value) : null,
    currency: unit?.amount?.currency_code ?? null,
    customId: unit?.custom_id ?? null,
    approveUrl: checkoutLink(approve?.href),
    authorizations: (unit?.payments?.authorizations ?? []).map(toAuthorization),
    payeeMerchantId: unit?.payee?.merchant_id ?? null,
  };
}

export class PayPalSandboxGateway implements PaymentGateway {
  readonly mode = "PAYPAL_SANDBOX" as const;
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: PayPalSandboxConfig) {
    if (!cfg.clientId || !cfg.clientSecret) throw new ProviderError("CONFIG", "PayPal sandbox credentials missing");
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private async raw(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      return await this.fetchImpl(`${PAYPAL_SANDBOX_API}${path}`, { ...init, signal: controller.signal, cache: "no-store" });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw new ProviderError("TIMEOUT", `PayPal request timed out: ${path}`);
      throw new ProviderError("NETWORK", `PayPal network error: ${path}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const res = await this.raw("/v1/oauth2/token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new ProviderError(res.status >= 500 ? "HTTP_5XX" : "HTTP_4XX", "PayPal OAuth failed", res.status, res.headers.get("paypal-debug-id") ?? undefined);
    const body = z.object({ access_token: z.string(), expires_in: z.number() }).parse(await res.json());
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async call<T>(method: "GET" | "POST", path: string, schema: z.ZodType<T> | null, body?: string, requestId?: string): Promise<T | null> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    const res = await this.raw(path, { method, headers, body });
    const debugId = res.headers.get("paypal-debug-id") ?? undefined;
    if (!res.ok) {
      let issue: string | undefined;
      try {
        const err = (await res.json()) as { name?: string; details?: { issue?: string }[] };
        issue = err.details?.[0]?.issue ?? err.name;
      } catch {
        issue = undefined;
      }
      throw new ProviderError(res.status >= 500 ? "HTTP_5XX" : "HTTP_4XX", `PayPal ${method} ${path} failed (${res.status})`, res.status, debugId, issue);
    }
    if (!schema) return null;
    const text = await res.text();
    const parsed = schema.safeParse(text ? JSON.parse(text) : {});
    if (!parsed.success) throw new ProviderError("INVALID_RESPONSE", `unexpected PayPal response for ${path}`, res.status, debugId);
    return parsed.data;
  }

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    const body = JSON.stringify({
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: input.reservationId,
          custom_id: input.reservationId,
          invoice_id: input.reservationId,
          description: input.description.slice(0, 127),
          amount: { currency_code: "USD", value: centsToUsd(input.amountCents) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: this.cfg.brandName.slice(0, 127),
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    });
    return toOrder((await this.call("POST", "/v2/checkout/orders", orderSchema, body, input.requestId))!);
  }

  async getOrder(orderId: string): Promise<ProviderOrder> {
    return toOrder((await this.call("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`, orderSchema))!);
  }

  async authorizeOrder(orderId: string, requestId: string): Promise<ProviderAuthorization> {
    const order = toOrder((await this.call("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, orderSchema, "{}", requestId))!);
    const auth = order.authorizations[0];
    if (!auth) throw new ProviderError("INVALID_RESPONSE", "authorize response had no authorization");
    return auth;
  }

  async getAuthorization(authorizationId: string): Promise<ProviderAuthorization> {
    return toAuthorization((await this.call("GET", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`, authorizationSchema))!);
  }

  async captureAuthorization(authorizationId: string, amountCents: number, invoiceId: string, requestId: string): Promise<ProviderCapture> {
    const body = JSON.stringify({ amount: { currency_code: "USD", value: centsToUsd(amountCents) }, invoice_id: invoiceId, final_capture: true });
    return toCapture((await this.call("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, captureSchema, body, requestId))!);
  }

  async getCapture(captureId: string): Promise<ProviderCapture> {
    return toCapture((await this.call("GET", `/v2/payments/captures/${encodeURIComponent(captureId)}`, captureSchema))!);
  }

  async voidAuthorization(authorizationId: string, requestId: string): Promise<void> {
    await this.call("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, null, undefined, requestId);
  }

  async verifyWebhook(headers: WebhookHeaders, rawBody: string): Promise<boolean> {
    const webhookId = this.cfg.webhookId;
    const h = (name: string) => headers[name] ?? null;
    const fields = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
    if (!webhookId || fields.some((f) => !h(f))) return false;
    try {
      JSON.parse(rawBody);
    } catch {
      return false;
    }
    // Embed the raw body verbatim so the provider verifies exactly the bytes we received.
    const body = `{"auth_algo":${JSON.stringify(h("paypal-auth-algo"))},"cert_url":${JSON.stringify(h("paypal-cert-url"))},"transmission_id":${JSON.stringify(
      h("paypal-transmission-id"),
    )},"transmission_sig":${JSON.stringify(h("paypal-transmission-sig"))},"transmission_time":${JSON.stringify(h("paypal-transmission-time"))},"webhook_id":${JSON.stringify(
      webhookId,
    )},"webhook_event":${rawBody}}`;
    try {
      const res = await this.call("POST", "/v1/notifications/verify-webhook-signature", z.object({ verification_status: z.string() }), body);
      return res?.verification_status === "SUCCESS";
    } catch {
      return false;
    }
  }
}
