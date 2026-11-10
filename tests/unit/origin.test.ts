import { describe, expect, it } from "vitest";
import { allowedOrigins, isAllowedOrigin, parseAllowedOrigin, parseAllowedOrigins } from "@/server/origin";
import { loadEnv } from "@/server/env";

const DEV_BASE = "http://localhost:3000";
const req = (host: string) => `${host}/api/quotes`;

describe("origin allow-list (CSRF layer 1)", () => {
  it("accepts the configured origin and the request's own origin", () => {
    expect(isAllowedOrigin("http://localhost:3000", DEV_BASE, req("http://localhost:3000"))).toBe(true);
    expect(isAllowedOrigin("https://app.example.com", "https://app.example.com", req("http://localhost:3000"))).toBe(true);
    expect(isAllowedOrigin("http://localhost:3108", DEV_BASE, req("http://localhost:3108"))).toBe(true);
  });

  it("accepts the other loopback spellings of the same port in local development (regression: 127.0.0.1 gave 'Request origin not allowed.')", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) expect(isAllowedOrigin(`http://${host}:3000`, DEV_BASE, req("http://localhost:3000"))).toBe(true);
  });

  it("does not widen across ports, schemes or other hosts", () => {
    expect(isAllowedOrigin("http://127.0.0.1:3001", DEV_BASE, req("http://localhost:3000"))).toBe(false);
    expect(isAllowedOrigin("https://127.0.0.1:3000", DEV_BASE, req("http://localhost:3000"))).toBe(false);
    expect(isAllowedOrigin("https://evil.example", DEV_BASE, req("http://localhost:3000"))).toBe(false);
    expect(isAllowedOrigin("http://localhost.evil.example:3000", DEV_BASE, req("http://localhost:3000"))).toBe(false);
  });

  it("refuses a missing or null origin", () => {
    expect(isAllowedOrigin(null, DEV_BASE, req("http://localhost:3000"))).toBe(false);
    expect(isAllowedOrigin("null", DEV_BASE, req("http://localhost:3000"))).toBe(false);
  });

  it("never adds loopback aliases for a public APP_BASE_URL", () => {
    const set = allowedOrigins("https://app.example.com", "https://app.example.com/api/quotes");
    expect([...set]).toEqual(["https://app.example.com"]);
    expect(isAllowedOrigin("http://127.0.0.1:3000", "https://app.example.com", "https://app.example.com/api/quotes")).toBe(false);
  });

  it("ALLOWED_ORIGINS adds exact origins only", () => {
    const extra = parseAllowedOrigins("https://preview-1.example.dev, http://localhost:4000");
    expect(isAllowedOrigin("https://preview-1.example.dev", "https://app.example.com", "https://app.example.com/x", extra)).toBe(true);
    expect(isAllowedOrigin("https://preview-2.example.dev", "https://app.example.com", "https://app.example.com/x", extra)).toBe(false);
  });

  it("rejects wildcard, path, plain-http public and malformed ALLOWED_ORIGINS entries", () => {
    for (const bad of ["*", "https://*.example.dev", "https://x.example.dev/path", "http://x.example.dev", "not a url", "https://x.example.dev?q=1"]) {
      expect(parseAllowedOrigin(bad), bad).toHaveProperty("problem");
    }
    expect(() => loadEnv({ ALLOWED_ORIGINS: "*" })).toThrow();
    expect(loadEnv({ ALLOWED_ORIGINS: "https://x.example.dev" }).ALLOWED_ORIGINS).toBe("https://x.example.dev");
  });
});
