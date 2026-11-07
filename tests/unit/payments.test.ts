import { describe, expect, it } from "vitest";
import { canTransition, PAYMENT_STATES } from "@/domain/paymentState";
import { PAYPAL_SANDBOX_API, PayPalSandboxGateway } from "@/payments/paypalSandbox";
import { ConfigError, loadEnv } from "@/server/env";

describe("payment state machine", () => {
  it("forbids capture after void and any exit from terminal states", () => {
    expect(canTransition("VOIDED", "CAPTURED")).toBe(false);
    expect(canTransition("CAPTURED", "VOIDED")).toBe(false);
    for (const terminal of ["CAPTURED", "VOIDED", "CANCELLED", "FAILED"] as const) {
      for (const to of PAYMENT_STATES) expect(canTransition(terminal, to)).toBe(false);
    }
  });

  it("requires buyer approval and authorization before capture", () => {
    expect(canTransition("ORDER_CREATED", "AUTHORIZED")).toBe(false);
    expect(canTransition("ORDER_CREATED", "CAPTURED")).toBe(false);
    expect(canTransition("BUYER_APPROVED", "CAPTURED")).toBe(false);
    expect(canTransition("AUTHORIZED", "CAPTURED")).toBe(true);
    expect(canTransition("AUTHORIZED", "VOIDED")).toBe(true);
  });
});

describe("environment guard", () => {
  it("refuses any non-sandbox PayPal environment", () => {
    expect(() => loadEnv({ PAYPAL_ENV: "live" })).toThrow(ConfigError);
    expect(() => loadEnv({ PAYPAL_ENV: "production", PAYMENT_MODE: "mock" })).toThrow(ConfigError);
  });

  it("requires explicit sandbox env and credentials for PayPal mode", () => {
    expect(() => loadEnv({ PAYMENT_MODE: "paypal_sandbox" })).toThrow(ConfigError);
    expect(() => loadEnv({ PAYMENT_MODE: "paypal_sandbox", PAYPAL_ENV: "sandbox" })).toThrow(/credentials/);
    const base = { PAYMENT_MODE: "paypal_sandbox", PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s" };
    expect(() => loadEnv(base)).toThrow(/PAYPAL_EXPECTED_MERCHANT_ID/);
    expect(() => loadEnv({ ...base, PAYPAL_EXPECTED_MERCHANT_ID: "lower-case-id" })).toThrow(/PAYPAL_EXPECTED_MERCHANT_ID/);
    expect(loadEnv({ ...base, PAYPAL_EXPECTED_MERCHANT_ID: "ABCDEFGH12345" }).PAYMENT_MODE).toBe("paypal_sandbox");
  });

  it("defaults to the mock provider", () => {
    expect(loadEnv({}).PAYMENT_MODE).toBe("mock");
  });
});

type Call = { url: string; init: RequestInit };

function fakeFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>, calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    return responder(url, init ?? {});
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "paypal-debug-id": "dbg123" } });

function gateway(fetchImpl: typeof fetch, extra: { webhookId?: string | null; timeoutMs?: number } = {}): PayPalSandboxGateway {
  return new PayPalSandboxGateway({ clientId: "id", clientSecret: "secret", webhookId: extra.webhookId ?? null, brandName: "GridWindow", timeoutMs: extra.timeoutMs, fetchImpl });
}

describe("PayPal sandbox REST client (fake transport)", () => {
  it("creates an AUTHORIZE order on the sandbox host with idempotency header and exact amount string", async () => {
    const calls: Call[] = [];
    const gw = gateway(
      fakeFetch(
        () =>
          json({
            id: "O1",
            status: "PAYER_ACTION_REQUIRED",
            links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=O1" }],
            purchase_units: [{ custom_id: "res_1", amount: { currency_code: "USD", value: "12.43" } }],
          }),
        calls,
      ),
    );
    const order = await gw.createOrder({ reservationId: "res_1", amountCents: 1243, description: "d", returnUrl: "http://x/r", cancelUrl: "http://x/c", requestId: "res_1:CREATE_ORDER" });
    expect(order).toMatchObject({ orderId: "O1", amountCents: 1243, currency: "USD", customId: "res_1" });
    expect(calls.every((c) => c.url.startsWith(PAYPAL_SANDBOX_API))).toBe(true);
    const create = calls.find((c) => c.url.endsWith("/v2/checkout/orders"))!;
    expect((create.init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("res_1:CREATE_ORDER");
    const body = JSON.parse(String(create.init.body));
    expect(body.intent).toBe("AUTHORIZE");
    expect(body.purchase_units).toHaveLength(1);
    expect(body.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "12.43" });
    expect(JSON.stringify(calls.filter((c) => !c.url.endsWith("/oauth2/token")).map((c) => c.init.headers))).not.toContain("secret");
  });

  it("maps 5xx to an ambiguous error and 4xx to a definite one", async () => {
    const mk = (status: number) => gateway(fakeFetch(() => json({ name: "X", details: [{ issue: "ISSUE" }] }, status), []));
    await expect(mk(503).getOrder("O1")).rejects.toMatchObject({ kind: "HTTP_5XX", ambiguous: true });
    await expect(mk(422).getOrder("O1")).rejects.toMatchObject({ kind: "HTTP_4XX", ambiguous: false, issue: "ISSUE", debugId: "dbg123" });
  });

  it("treats a timeout as ambiguous", async () => {
    const hang = fakeFetch(
      (_u, init) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
      [],
    );
    await expect(gateway(hang, { timeoutMs: 20 }).getAuthorization("A1")).rejects.toMatchObject({ kind: "TIMEOUT", ambiguous: true });
  });

  it("rejects malformed provider amounts instead of guessing", async () => {
    const gw = gateway(fakeFetch(() => json({ id: "C1", status: "COMPLETED", amount: { currency_code: "USD", value: "12.5x" } }), []));
    await expect(gw.getCapture("C1")).rejects.toThrow();
  });

  it("verifies webhooks by sending the raw body verbatim and fails closed", async () => {
    const calls: Call[] = [];
    const gw = gateway(fakeFetch(() => json({ verification_status: "SUCCESS" }), calls), { webhookId: "WH-ID" });
    const headers = {
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
      "paypal-transmission-id": "t",
      "paypal-transmission-sig": "sig",
      "paypal-transmission-time": "2026-11-05T00:00:00Z",
    };
    const raw = '{"id":"WH-1",  "event_type":"X","resource":{"amount":{"value":"1.10"}}}';
    expect(await gw.verifyWebhook(headers, raw)).toBe(true);
    const sent = String(calls.find((c) => c.url.endsWith("/verify-webhook-signature"))!.init.body);
    expect(sent.endsWith(`"webhook_event":${raw}}`)).toBe(true);
    expect(await gw.verifyWebhook({ ...headers, "paypal-transmission-sig": null }, raw)).toBe(false);
    expect(await gw.verifyWebhook(headers, "not json")).toBe(false);
    expect(await gateway(fakeFetch(() => json({ verification_status: "SUCCESS" }), [])).verifyWebhook(headers, raw)).toBe(false);
    expect(await gateway(fakeFetch(() => json({ verification_status: "FAILURE" }), []), { webhookId: "WH-ID" }).verifyWebhook(headers, raw)).toBe(false);
  });
});
