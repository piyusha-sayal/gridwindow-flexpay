/** Review finding #4: rate limits cannot be bypassed with a client-supplied X-Forwarded-For. */
import { afterEach, describe, expect, it } from "vitest";
import { rateLimit } from "@/server/http";

const req = (xff?: string) => new Request("http://localhost/api/x", { headers: xff ? { "x-forwarded-for": xff } : {} });
const code = (fn: () => void) => {
  try {
    fn();
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? "ERROR";
  }
};

afterEach(() => {
  delete process.env.TRUST_PROXY;
});

describe("rate limiting (#4)", () => {
  it("without TRUST_PROXY, rotating X-Forwarded-For does not grant a fresh bucket", () => {
    const results = Array.from({ length: 7 }, (_, i) => code(() => rateLimit(req(`203.0.113.${i}`), "t-no-proxy", 5)));
    expect(results).toEqual(["OK", "OK", "OK", "OK", "OK", "RATE_LIMITED", "RATE_LIMITED"]);
  });

  it("with TRUST_PROXY, only the proxy-appended last hop identifies the client", () => {
    process.env.TRUST_PROXY = "true";
    // Spoofed leading hops vary; the proxy-appended last hop is the same client.
    const same = Array.from({ length: 6 }, (_, i) => code(() => rateLimit(req(`10.0.0.${i}, 198.51.100.7`), "t-proxy", 5)));
    expect(same.slice(-1)).toEqual(["RATE_LIMITED"]);
    expect(code(() => rateLimit(req("10.0.0.1, 198.51.100.8"), "t-proxy", 5))).toBe("OK");
  });

  it("many distinct clients do not grow memory without bound or reset a limited client early", () => {
    process.env.TRUST_PROXY = "true";
    for (let i = 0; i < 5; i++) rateLimit(req("192.0.2.1"), "t-flood", 5);
    expect(code(() => rateLimit(req("192.0.2.1"), "t-flood", 5))).toBe("RATE_LIMITED");
    for (let i = 0; i < 12_000; i++) code(() => rateLimit(req(`100.64.${i >> 8}.${i & 255}`), "t-flood-other", 5));
    // Bounded map: a flood of new clients evicts unlimited entries, never the limited client.
    expect(code(() => rateLimit(req("192.0.2.1"), "t-flood", 5))).toBe("RATE_LIMITED");
  });
});
