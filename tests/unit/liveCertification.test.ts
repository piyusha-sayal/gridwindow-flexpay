/** Live-certification preflight: unmet public-endpoint, webhook ID and proxy settings must fail closed. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clientKey, rateLimit, rateLimitGlobal } from "@/server/http";
import { checkLiveCertification, publicHttpsOriginProblem } from "@/server/liveCertification";

const GOOD = { APP_BASE_URL: "https://demo-gw.ngrok-free.app", PAYPAL_WEBHOOK_ID: "WHKTEST0123456789ABC", TRUST_PROXY: "true" };
const failing = (env: Record<string, string | undefined>) => checkLiveCertification(env).filter((c) => !c.ok).map((c) => c.name.split(" ")[0]);

describe("live certification requirements", () => {
  it("passes a public https origin, a webhook ID and TRUST_PROXY=true", () => {
    expect(failing(GOOD)).toEqual([]);
  });

  it.each([
    ["unset", undefined],
    ["http", "http://demo-gw.ngrok-free.app"],
    ["localhost", "https://localhost:3000"],
    ["loopback IP", "https://127.0.0.1"],
    ["private IP", "https://192.168.1.5"],
    ["bare host", "https://myhost"],
    [".local host", "https://box.local"],
    ["credentials", "https://user:pw@demo-gw.ngrok-free.app"],
    ["path", "https://demo-gw.ngrok-free.app/app"],
    ["query", "https://demo-gw.ngrok-free.app/?a=1"],
    ["not a URL", "not a url"],
  ])("fails APP_BASE_URL when %s", (_label, value) => {
    expect(failing({ ...GOOD, APP_BASE_URL: value })).toEqual(["APP_BASE_URL"]);
    expect(publicHttpsOriginProblem(value)).not.toBeNull();
  });

  it.each([
    ["unset", undefined],
    ["blank", "   "],
    ["too short", "abc"],
    ["contains URL characters", "https://x.example/hook"],
  ])("fails PAYPAL_WEBHOOK_ID when %s", (_label, value) => {
    expect(failing({ ...GOOD, PAYPAL_WEBHOOK_ID: value })).toEqual(["PAYPAL_WEBHOOK_ID"]);
  });

  it.each([undefined, "false", "TRUE", "1"])("fails TRUST_PROXY=%s", (value) => {
    expect(failing({ ...GOOD, TRUST_PROXY: value })).toEqual(["TRUST_PROXY=true"]);
  });

  it("never echoes configured values in the report", () => {
    const text = JSON.stringify(checkLiveCertification({ ...GOOD, PAYPAL_WEBHOOK_ID: "SECRETWEBHOOKID123", APP_BASE_URL: "http://leak.example" }));
    expect(text).not.toContain("SECRETWEBHOOKID123");
    expect(text).not.toContain("leak.example");
  });
});

describe("forwarding headers cannot bypass limits or security", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost/api/x", { headers });
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

  it("ignores X-Forwarded-For entirely when TRUST_PROXY is not true", () => {
    expect(clientKey(req({ "x-forwarded-for": "203.0.113.9" }), false)).toBe("shared");
    expect(clientKey(req({ "x-forwarded-for": "203.0.113.10" }), false)).toBe("shared");
  });

  it("uses only the proxy-appended last hop when trusted, and X-Forwarded-Proto never matters", () => {
    expect(clientKey(req({ "x-forwarded-for": "1.1.1.1, 198.51.100.7", "x-forwarded-proto": "https" }), true)).toBe("198.51.100.7");
    expect(clientKey(req({ "x-forwarded-for": "1.1.1.1, 198.51.100.7", "x-forwarded-proto": "http" }), true)).toBe("198.51.100.7");
  });

  it("the global operator-login backstop holds even when every attempt claims a new client address", () => {
    process.env.TRUST_PROXY = "true";
    const results = Array.from({ length: 8 }, (_, i) =>
      code(() => {
        rateLimit(req({ "x-forwarded-for": `198.51.100.${i}` }), "t-login", 100);
        rateLimitGlobal("t-login", 5);
      }),
    );
    expect(results).toEqual(["OK", "OK", "OK", "OK", "OK", "RATE_LIMITED", "RATE_LIMITED", "RATE_LIMITED"]);
  });

  it("no server code reads X-Forwarded-Proto or X-Forwarded-Host (cookie security and origin checks come from APP_BASE_URL)", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && /x-forwarded-(proto|host)/i.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(path.join(process.cwd(), "src"));
    expect(hits).toEqual([]);
  });
});
