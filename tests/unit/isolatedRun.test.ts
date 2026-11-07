import { describe, expect, it } from "vitest";
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
