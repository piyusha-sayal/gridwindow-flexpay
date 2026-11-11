import { describe, expect, it } from "vitest";
import { createLlm, fallbackConfigured, selectProvider } from "@/server/ai/llmFactory";
import { ConfigError, loadEnv } from "@/server/env";

const ISOLATED = { GW_ISOLATED_DB: "true", PAYMENT_MODE: "mock" };

describe("isolated test runs fail closed", () => {
  it("accepts an isolated run with no external services", () => {
    expect(loadEnv({ ...ISOLATED, DATABASE_URL: "", GEMINI_API_KEY: "" }).GW_ISOLATED_DB).toBe("true");
  });

  it.each([
    ["DATABASE_URL", { DATABASE_URL: "postgres://u:p@ep-x-pooler.neon.tech/db" }],
    ["MIGRATION_DATABASE_URL", { MIGRATION_DATABASE_URL: "postgres://u:p@ep-x.neon.tech/db" }],
    ["GEMINI_API_KEY", { GEMINI_API_KEY: "k" }],
    ["ANTHROPIC_API_KEY", { ANTHROPIC_API_KEY: "k" }],
    ["PAYMENT_MODE", { PAYMENT_MODE: "paypal_sandbox", PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "i", PAYPAL_CLIENT_SECRET: "s", PAYPAL_EXPECTED_MERCHANT_ID: "ABCDEFGH12345" }],
  ])("refuses to start when %s is configured", (name, extra) => {
    let message = "";
    try {
      loadEnv({ ...ISOLATED, ...extra });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      message = (err as Error).message;
    }
    expect(message).toContain(name);
    expect(message).not.toMatch(/neon\.tech|postgres:\/\//);
  });

  it("does not restrict normal runs", () => {
    expect(loadEnv({ DATABASE_URL: "postgres://u:p@h/db", GEMINI_API_KEY: "k" }).DATABASE_URL).toBeDefined();
  });
});

describe("OpenRouter key handling (I1)", () => {
  const key = (v: string | undefined) => ({ ...ISOLATED, AI_FALLBACK_PROVIDER: "openrouter", ...(v === undefined ? {} : { OPENROUTER_API_KEY: v }) });

  it("treats an absent, empty or whitespace-only key as not configured, so an isolated run starts", () => {
    for (const v of [undefined, "", " ", "   \t\n"]) {
      const env = loadEnv(key(v));
      expect(env.OPENROUTER_API_KEY, JSON.stringify(v)).toBeUndefined();
      expect(fallbackConfigured(env)).toBe(false);
    }
  });

  it("refuses an isolated run when a real key is set, naming the variable but never the value", () => {
    let message = "";
    try {
      loadEnv(key("sk-or-v1-secretvalue"));
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      message = (err as Error).message;
    }
    expect(message).toContain("OPENROUTER_API_KEY");
    expect(message).not.toContain("secretvalue");
  });

  it("keeps a valid key working in a normal run", () => {
    const env = loadEnv({ AI_FALLBACK_PROVIDER: "openrouter", OPENROUTER_API_KEY: "sk-or-v1-abc", GEMINI_API_KEY: "g" });
    expect(fallbackConfigured(env)).toBe(true);
  });

  it("never selects a provider or a fallback from blank keys, even when handed raw environment values", () => {
    expect(selectProvider({ GEMINI_API_KEY: "  ", ANTHROPIC_API_KEY: "" })).toBeNull();
    expect(selectProvider({ AI_PROVIDER: "gemini", GEMINI_API_KEY: " " })).toBeNull();
    expect(selectProvider({ GEMINI_API_KEY: " ", ANTHROPIC_API_KEY: "a" })).toBe("anthropic");
    expect(fallbackConfigured({ AI_FALLBACK_PROVIDER: "openrouter", OPENROUTER_API_KEY: "   " })).toBe(false);
    expect(createLlm({ GEMINI_API_KEY: "   " })).toBeNull();
  });

  it("the Playwright web server blanks the OpenRouter variables so .env.local cannot enable a real provider", async () => {
    const { default: config } = await import("../../playwright.config");
    const webEnv = (config.webServer as { env: Record<string, string> }).env;
    expect(webEnv.OPENROUTER_API_KEY).toBe("");
    expect(webEnv.AI_FALLBACK_PROVIDER).toBe("");
    expect(webEnv.GEMINI_API_KEY).toBe("");
    expect(webEnv.ANTHROPIC_API_KEY).toBe("");
    expect(webEnv.GW_ISOLATED_DB).toBe("true");
  });
});
