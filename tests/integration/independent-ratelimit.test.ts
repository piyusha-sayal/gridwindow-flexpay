/**
 * QA-2 reproduction: without TRUST_PROXY every caller shares one rate-limit bucket, so an anonymous party can exhaust
 * the operator-login limit and lock the real operator out. Documents current behavior and the intended mitigation
 * with the existing TRUST_PROXY setting. Pure in-memory; no network.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ cookies: new Map<string, string>(), runtime: null as unknown }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (fake.cookies.has(n) ? { name: n, value: fake.cookies.get(n)! } : undefined),
    set: (n: string, v: string) => void fake.cookies.set(n, v),
    delete: (n: string) => void fake.cookies.delete(n),
  }),
}));
vi.mock("@/server/runtime", () => ({ getRuntime: async () => fake.runtime }));

const { POST: login } = await import("@/app/api/operator/session/route");
const ORIGIN = "http://test.local";
const PASS = "correct-horse-battery";

const attempt = (passphrase: string, forwardedFor: string) =>
  login(new Request(`${ORIGIN}/api/operator/session`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": forwardedFor }, body: JSON.stringify({ passphrase }) }));

let n = 0;
beforeEach(() => {
  vi.useFakeTimers();
  // Each test starts a fresh rate-limit window: buckets are keyed by route and reset after 60 s.
  vi.setSystemTime(new Date(Date.UTC(2030, 0, 1) + ++n * 3_600_000));
  fake.cookies.clear();
  fake.runtime = { env: { APP_BASE_URL: ORIGIN }, sessionKey: Buffer.alloc(32, 3), operatorPassHash: createHash("sha256").update(PASS).digest(), deps: {}, llm: null };
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TRUST_PROXY;
});

describe("QA-2: operator-login rate limiting", () => {
  it("REPRODUCED without TRUST_PROXY: five bad guesses from five different addresses block the real operator", async () => {
    delete process.env.TRUST_PROXY;
    for (let i = 0; i < 5; i++) expect((await attempt("wrong-guess", `203.0.113.${i + 1}`)).status).toBe(401);
    // The legitimate operator, from yet another address, with the right passphrase, is refused.
    const res = await attempt(PASS, "198.51.100.7");
    expect(res.status).toBe(429);
    expect(fake.cookies.has("gw_op")).toBe(false);
  });

  it("the lockout is temporary: the window reopens after 60 seconds, then the right passphrase works", async () => {
    delete process.env.TRUST_PROXY;
    for (let i = 0; i < 5; i++) await attempt("wrong-guess", "203.0.113.1");
    expect((await attempt(PASS, "198.51.100.7")).status).toBe(429);
    vi.setSystemTime(Date.now() + 61_000);
    expect((await attempt(PASS, "198.51.100.7")).status).toBe(200);
  });

  it("with TRUST_PROXY=true the proxy-appended address isolates clients: an attacker's address cannot block the operator's", async () => {
    process.env.TRUST_PROXY = "true";
    for (let i = 0; i < 5; i++) expect((await attempt("wrong-guess", "203.0.113.9")).status).toBe(401);
    expect((await attempt("wrong-guess", "203.0.113.9")).status).toBe(429);
    expect((await attempt(PASS, "198.51.100.7")).status).toBe(200);
  });

  it("brute force stays bounded either way: the global login cap (30/min) holds even if client addresses rotate", async () => {
    process.env.TRUST_PROXY = "true";
    let blocked = 0;
    for (let i = 0; i < 40; i++) if ((await attempt("wrong-guess", `203.0.113.${(i % 250) + 1}`)).status === 429) blocked++;
    expect(blocked).toBeGreaterThanOrEqual(10);
  });
});
