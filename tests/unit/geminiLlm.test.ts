/**
 * GeminiLlm and provider selection against an injected fake transport: no network, no API key use.
 * Proves request shape (no tools), failure mapping and that a model can only ever return validated JSON.
 */
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_GEMINI_MODEL, GeminiLlm } from "@/server/ai/geminiLlm";
import { createLlm, selectProvider } from "@/server/ai/llmFactory";

const schema = z.object({ answer: z.string().max(200), n: z.number().nullable() });
const req = { system: "sys", user: "<driver_text>hi</driver_text>", schema, maxTokens: 300 };

function reply(text: string | undefined, finishReason: string | undefined = "STOP", extra: Record<string, unknown> = {}): GenerateContentResponse {
  return { text, candidates: [{ finishReason }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 5, thoughtsTokenCount: 7 }, modelVersion: "gemini-3.6-flash-001", ...extra } as unknown as GenerateContentResponse;
}

function transport(respond: (p: GenerateContentParameters) => Promise<GenerateContentResponse>, timeoutMs?: number) {
  const sent: GenerateContentParameters[] = [];
  return { sent, llm: new GeminiLlm("test-key", undefined, { timeoutMs, generate: async (p) => (sent.push(p), respond(p)) }) };
}

describe("GeminiLlm (offline)", () => {
  it("returns schema-validated output, with thinking counted as output tokens", async () => {
    const t = transport(async () => reply(JSON.stringify({ answer: "ok", n: null })));
    expect(await t.llm.generate(req)).toEqual({ ok: true, value: { answer: "ok", n: null }, model: "gemini-3.6-flash-001", usage: { inputTokens: 11, outputTokens: 12 } });
  });

  it("sends a JSON-schema constrained request and no tools, search grounding or function calling", async () => {
    const t = transport(async () => reply(JSON.stringify({ answer: "ok", n: 1 })));
    await t.llm.generate(req);
    const p = t.sent[0]!;
    expect(p.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(p.contents).toBe(req.user);
    expect(p.config).toMatchObject({ systemInstruction: "sys", responseMimeType: "application/json" });
    expect(p.config?.responseJsonSchema).toMatchObject({ type: "object", properties: { answer: { type: "string" } } });
    for (const forbidden of ["tools", "toolConfig", "automaticFunctionCalling"]) expect(p.config).not.toHaveProperty(forbidden);
    expect(JSON.stringify(p)).not.toContain("test-key");
  });

  it("maps a thrown provider error to UNAVAILABLE", async () => {
    const t = transport(async () => {
      throw new Error("503 overloaded");
    });
    expect(await t.llm.generate(req)).toMatchObject({ ok: false, reason: "UNAVAILABLE", diagnostic: { category: "CLIENT_ERROR", errorName: "Error" } });
  });

  it("maps a hung request to TIMEOUT even if the transport ignores the abort signal", async () => {
    const t = transport(() => new Promise<GenerateContentResponse>(() => undefined), 50);
    expect(await t.llm.generate(req)).toEqual({ ok: false, reason: "TIMEOUT" });
  });

  it("separates malformed, truncated and schema-violating output", async () => {
    const cases: [GenerateContentResponse, string][] = [
      [reply("not json"), "INVALID_OUTPUT"],
      [reply(undefined), "INVALID_OUTPUT"],
      [reply('{"answer":"cut of', "MAX_TOKENS"), "INVALID_OUTPUT"],
      [reply(JSON.stringify({ answer: "ok", n: null }), "FINISH_REASON_UNSPECIFIED"), "INVALID_OUTPUT"],
      [reply(JSON.stringify({ answer: "x".repeat(500), n: null })), "SCHEMA_MISMATCH"],
      [reply(JSON.stringify({ other: 1 })), "SCHEMA_MISMATCH"],
    ];
    for (const [response, reason] of cases) {
      const t = transport(async () => response);
      expect(await t.llm.generate(req), reason).toMatchObject({ ok: false, reason });
    }
  });

  it("reports provider blocks and safety stops as REFUSED", async () => {
    for (const response of [reply(undefined, undefined, { promptFeedback: { blockReason: "SAFETY" } }), reply("I can't help.", "SAFETY"), reply("x", "PROHIBITED_CONTENT")]) {
      const t = transport(async () => response);
      expect(await t.llm.generate(req)).toMatchObject({ ok: false, reason: "REFUSED" });
    }
  });
});

describe("provider selection", () => {
  it("is unconfigured without keys, so the deterministic fallback runs", () => {
    expect(selectProvider({})).toBeNull();
    expect(createLlm({})).toBeNull();
  });

  it("prefers Gemini when only its key is set, and honors an explicit provider", () => {
    expect(selectProvider({ GEMINI_API_KEY: "g" })).toBe("gemini");
    expect(selectProvider({ ANTHROPIC_API_KEY: "a" })).toBe("anthropic");
    expect(selectProvider({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })).toBe("gemini");
    expect(selectProvider({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", AI_PROVIDER: "anthropic" })).toBe("anthropic");
  });

  it("never falls back to another provider when the chosen one has no key", () => {
    expect(selectProvider({ ANTHROPIC_API_KEY: "a", AI_PROVIDER: "gemini" })).toBeNull();
    expect(selectProvider({ GEMINI_API_KEY: "g", AI_PROVIDER: "anthropic" })).toBeNull();
  });

  it("builds a Gemini adapter with the default or configured model without any network call", () => {
    expect(createLlm({ GEMINI_API_KEY: "g" })?.llm.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(createLlm({ GEMINI_API_KEY: "g", GEMINI_MODEL: "gemini-3.5-flash-lite" })?.llm.model).toBe("gemini-3.5-flash-lite");
  });
});
