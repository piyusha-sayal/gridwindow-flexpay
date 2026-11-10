import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiLlm } from "@/server/ai/geminiLlm";
import { METADATA_APPROVAL_FLAG, planAccessCheck, summarizeAccess } from "../../scripts/geminiAccessCheckFlow";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("planAccessCheck", () => {
  it("is a dry run unless the approval flag is present", () => {
    expect(planAccessCheck([], "gemini-3.6-flash")).toEqual({ approved: false, model: "gemini-3.6-flash" });
    expect(planAccessCheck([METADATA_APPROVAL_FLAG], "gemini-3.6-flash").approved).toBe(true);
  });
  it("takes the model only from an explicit --model flag, never from the environment", () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-3.8-flash");
    expect(planAccessCheck(["--model=gemini-3.6-flash"], "x").model).toBe("gemini-3.6-flash");
    expect(planAccessCheck([], "gemini-3.6-flash").model).toBe("gemini-3.6-flash");
  });
});

describe("summarizeAccess", () => {
  it("records a passing check without any key or message text", () => {
    const e = summarizeAccess("gemini-3.6-flash", { available: true, supportsGenerateContent: true, inputTokenLimit: 1048576 }, 321, "2026-11-10T00:00:00.000Z");
    expect(e).toMatchObject({ kind: "MODEL_ACCESS_METADATA_ONLY", requestsSent: 1, generationRequests: 0, verdict: "PASS", latencyMs: 321, inputTokenLimit: 1048576, diagnostic: null });
  });
  it("records a provider error as FAIL with only category, status codes and the error class", () => {
    const e = summarizeAccess("gemini-3.6-flash", { available: false, supportsGenerateContent: false, diagnostic: { category: "UNAVAILABLE", errorName: "ApiError", httpStatus: 503, providerStatus: "UNAVAILABLE" } }, 4000, "t");
    expect(e.verdict).toBe("FAIL");
    expect(e.diagnostic).toEqual({ category: "UNAVAILABLE", errorName: "ApiError", httpStatus: 503, providerStatus: "UNAVAILABLE" });
  });
  it("a model without generateContent is a FAIL even when it exists", () => {
    expect(summarizeAccess("m", { available: true, supportsGenerateContent: false }, 1, "t").verdict).toBe("FAIL");
  });
});

describe("GeminiLlm.checkModelAccess sends exactly one request and never retries (network stubbed)", () => {
  it("a 503 produces one HTTP request, no generation endpoint, and a sanitized diagnostic", async () => {
    vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "http://127.0.0.1:9");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown) => {
      const url = new URL(typeof input === "string" ? input : (input as { url?: string }).url ?? String(input));
      calls.push(`${url.hostname}${url.pathname}`);
      return new Response(JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "stub" } }), { status: 503, headers: { "content-type": "application/json" } });
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await GeminiLlm.checkModelAccess("dummy-key-not-real", "gemini-3.6-flash");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^127\.0\.0\.1\/v1beta\/models\/gemini-3\.6-flash$/);
    expect(calls.join()).not.toContain("generateContent");
    expect(res).toMatchObject({ available: false, supportsGenerateContent: false, diagnostic: { httpStatus: 503, providerStatus: "UNAVAILABLE" } });
    expect(JSON.stringify(res)).not.toContain("dummy-key-not-real");
  });
});
