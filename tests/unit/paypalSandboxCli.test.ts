/**
 * Diagnostics shared by the PayPal Sandbox CLIs: .env.local parsing matches the app, the REST app
 * is identified by a one-way fingerprint, and a 404 lookup is explained without exposing secrets.
 */
import { describe, expect, it } from "vitest";
import { ProviderError } from "@/payments/gateway";
import { PayPalSandboxGateway } from "@/payments/paypalSandbox";
import { credentialFingerprint, describeLookupFailure, parseDotEnv } from "../../scripts/paypalSandboxCli";

describe("PayPal sandbox CLI diagnostics", () => {
  it("parses .env.local like Next.js: CRLF, surrounding quotes and comments", () => {
    const env = parseDotEnv('# comment\r\nPAYPAL_CLIENT_ID="abc123"\r\nPAYPAL_ENV=sandbox \nPAYPAL_EXPECTED_MERCHANT_ID=\'MERCH12345\'\nexport X=1\n');
    expect(env).toEqual({ PAYPAL_CLIENT_ID: "abc123", PAYPAL_ENV: "sandbox", PAYPAL_EXPECTED_MERCHANT_ID: "MERCH12345" });
  });

  it("fingerprints a client ID one-way and stably, ignoring stray whitespace", () => {
    const fp = credentialFingerprint("AbCdEf-client-id");
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
    expect(credentialFingerprint(" AbCdEf-client-id ")).toBe(fp);
    expect(credentialFingerprint("other-client-id")).not.toBe(fp);
    expect(fp).not.toContain("AbCdEf");
  });

  it("explains a 404 order lookup with the debug ID and no credential material", () => {
    const lines = describeLookupFailure(new ProviderError("HTTP_4XX", "PayPal GET failed (404)", 404, "f824323014a0e", "INVALID_RESOURCE_ID")).join("\n");
    expect(lines).toContain("INVALID_RESOURCE_ID");
    expect(lines).toContain("f824323014a0e");
    expect(lines).toContain("different sandbox REST app");
    expect(lines).not.toMatch(/secret|Bearer|token=[A-Z0-9]/);
  });

  it("adds nothing for other failures", () => {
    expect(describeLookupFailure(new ProviderError("HTTP_4XX", "x", 422, "d", "UNPROCESSABLE_ENTITY"))).toEqual([]);
    expect(describeLookupFailure(new Error("x"))).toEqual([]);
  });

  it("looks the order up at the sandbox Orders v2 path with the bearer token from OAuth", async () => {
    const calls: { url: string; auth: string | null; method: string }[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), auth: headers.get("Authorization"), method: init?.method ?? "GET" });
      if (String(url).endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      return new Response(JSON.stringify({ name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] }), { status: 404, headers: { "paypal-debug-id": "dbg1" } });
    };
    const gw = new PayPalSandboxGateway({ clientId: "id", clientSecret: "secret", webhookId: null, brandName: "t", fetchImpl });
    const err = await gw.getOrder("ORDERTEST0123456789").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ httpStatus: 404, issue: "INVALID_RESOURCE_ID", debugId: "dbg1" });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://api-m.sandbox.paypal.com/v1/oauth2/token",
      "GET https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDERTEST0123456789",
    ]);
    expect(calls[1]?.auth).toBe("Bearer tok");
  });
});
