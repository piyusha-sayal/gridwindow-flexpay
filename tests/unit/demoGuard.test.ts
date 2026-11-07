import { describe, expect, it } from "vitest";
import { demoToolsAllowed } from "@/server/services/demoService";

describe("demo tools guard", () => {
  it("is enabled only with the opt-in flag, MOCK payments and the embedded database", () => {
    expect(demoToolsAllowed({ DEMO_TOOLS: "true", PAYMENT_MODE: "mock", DATABASE_URL: undefined })).toBe(true);
    expect(demoToolsAllowed({ DEMO_TOOLS: undefined, PAYMENT_MODE: "mock", DATABASE_URL: undefined })).toBe(false);
    expect(demoToolsAllowed({ DEMO_TOOLS: "false", PAYMENT_MODE: "mock", DATABASE_URL: undefined })).toBe(false);
    expect(demoToolsAllowed({ DEMO_TOOLS: "true", PAYMENT_MODE: "paypal_sandbox", DATABASE_URL: undefined })).toBe(false);
    // Never against a real PostgreSQL server: reset truncates tables.
    expect(demoToolsAllowed({ DEMO_TOOLS: "true", PAYMENT_MODE: "mock", DATABASE_URL: "postgres://db/gridwindow" })).toBe(false);
  });
});
