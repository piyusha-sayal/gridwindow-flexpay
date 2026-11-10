/**
 * Offline reproduction of the 2026-11-05 live Gemini smoke failures, with scripted provider responses only.
 * The model text of the failed live answers was not kept, so the grounding cases below are reproductions of
 * what the validator does with plausible phrasings of the fixture facts, not recordings of Gemini's output.
 */
import { ApiError, type GenerateContentResponse } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { answerReservationQuestion, explainOfferWithAi, interpretRequest, offerFacts, reservationFacts } from "@/server/ai/assistant";
import { classifyFailure, GeminiLlm } from "@/server/ai/geminiLlm";
import { allowedNumbers, checkGrounding } from "@/server/ai/grounding";
import { classifyHttpStatus, providerStatusWord } from "@/server/ai/llm";
import { DEMO_STATION } from "@/domain/station";
import { formatUsd } from "@/domain/units";
import { smokeFixtures } from "../../scripts/aiSmokeFlow";
import { ok, ScriptedLlm } from "./scriptedLlm";

const SECRET_PROMPT = "PROMPT-CONTENT-THAT-MUST-NOT-LEAK";
const API_KEY = "test-key-should-never-appear";

afterEach(() => vi.restoreAllMocks());

describe("provider errors are not collapsed into UNAVAILABLE", () => {
  const cases: [number, string][] = [
    [400, "REQUEST_REJECTED"],
    [404, "REQUEST_REJECTED"],
    [422, "REQUEST_REJECTED"],
    [401, "AUTH_FAILED"],
    [403, "AUTH_FAILED"],
    [429, "QUOTA_EXHAUSTED"],
    [500, "UNAVAILABLE"],
    [503, "UNAVAILABLE"],
  ];
  it.each(cases)("HTTP %i is %s", (status, reason) => {
    expect(classifyHttpStatus(status)).toBe(reason);
    const body = JSON.stringify({ error: { code: status, message: `leaks ${SECRET_PROMPT}`, status: status === 429 ? "RESOURCE_EXHAUSTED" : "INVALID_ARGUMENT" } });
    const { diagnostic } = classifyFailure(new ApiError({ message: body, status }));
    expect(diagnostic).toMatchObject({ category: reason, httpStatus: status });
    expect(JSON.stringify(diagnostic)).not.toContain(SECRET_PROMPT);
  });

  it("keeps only the enum-like provider status word", () => {
    expect(providerStatusWord('{"error":{"code":429,"message":"quota","status":"RESOURCE_EXHAUSTED"}}')).toBe("RESOURCE_EXHAUSTED");
    expect(providerStatusWord("no status here")).toBeUndefined();
    expect(providerStatusWord('{"status":"lower case secret"}')).toBeUndefined();
  });

  it("classifies a socket failure as NETWORK and an unknown client error as CLIENT_ERROR", () => {
    expect(classifyFailure(new TypeError("fetch failed")).diagnostic.category).toBe("NETWORK");
    expect(classifyFailure(new Error("bad config")).diagnostic.category).toBe("CLIENT_ERROR");
  });

  it("GeminiLlm reports quota and auth failures with a sanitized diagnostic and logs no key or content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const schema = z.object({ a: z.string() });
    for (const [status, reason, providerStatus] of [
      [429, "QUOTA_EXHAUSTED", "RESOURCE_EXHAUSTED"],
      [403, "AUTH_FAILED", "PERMISSION_DENIED"],
      [400, "REQUEST_REJECTED", "INVALID_ARGUMENT"],
    ] as const) {
      const message = JSON.stringify({ error: { code: status, message: `${SECRET_PROMPT} ${API_KEY}`, status: providerStatus } });
      const llm = new GeminiLlm(API_KEY, undefined, {
        generate: async (): Promise<GenerateContentResponse> => {
          throw new ApiError({ message, status });
        },
      });
      expect(await llm.generate({ system: "s", user: SECRET_PROMPT, schema, maxTokens: 100 })).toEqual({ ok: false, reason, diagnostic: { category: reason, errorName: "ApiError", httpStatus: status, providerStatus } });
    }
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("QUOTA_EXHAUSTED");
    expect(logged).not.toContain(API_KEY);
    expect(logged).not.toContain(SECRET_PROMPT);
  });
});

describe("grounding: what the validator does with plausible Gemini phrasings of the fixture facts", () => {
  const { quote, offer, view } = smokeFixtures();
  const facts = offerFacts(quote, offer);
  const allowed = allowedNumbers(facts);
  const explain = async (summary: string, points: string[] = []) => {
    const diag = {};
    const res = await explainOfferWithAi(new ScriptedLlm(() => ok({ summary, points })), quote, offer, diag);
    return { res, diag };
  };

  it("accepts an explanation that copies times and dollar figures exactly", async () => {
    const { res } = await explain(`Your car stays on port C and charges from ${facts.flexibleChargingWindow}. The price is ${facts.flexiblePrice}, ${facts.driverDiscount} less than ${facts.immediateListPrice}.`, ["Savings are modeled from synthetic assumptions."]);
    expect(res.source).toBe("MODEL");
  });

  it("accepts the backend's own disclosure, which the validator used to reject (reproduced defect)", async () => {
    expect(facts.assumptions).toContain("not measured");
    expect(checkGrounding(facts.assumptions, allowed)).toEqual([]);
    const { res } = await explain(`The price is ${facts.flexiblePrice}.`, [facts.assumptions]);
    expect(res.source).toBe("MODEL");
  });

  it("still rejects affirmative measured, proven, real-world and guarantee claims", () => {
    for (const text of ["Savings are measured.", "These are proven savings.", "A real-world benefit for the grid.", "This is guaranteed to be cheaper.", "Not only modeled but measured."]) {
      expect(checkGrounding(text, allowed), text).toEqual([{ kind: "UNSUPPORTED_CLAIM" }]);
    }
    expect(checkGrounding("It is not measured, but guaranteed.", allowed)).toEqual([{ kind: "UNSUPPORTED_CLAIM" }]);
  });

  it("keeps rejecting 12-hour conversions of backend times (a real mismatch the prompt now forbids)", async () => {
    const { res, diag } = await explain("Charging runs from 12:00 AM to 3:00 AM, around 10:00 PM it would otherwise start.");
    expect(res).toMatchObject({ source: "DETERMINISTIC_FALLBACK", reason: "UNGROUNDED_OUTPUT" });
    expect(diag).toMatchObject({ groundingIssues: expect.arrayContaining([{ kind: "UNGROUNDED_NUMBER", token: "12:00" }]) });
  });

  it("keeps rejecting invented numbers, computed percentages and rates written in a different form", async () => {
    for (const text of ["You save about 26% versus charging now.", "Electricity costs $0.14/kWh overnight.", "Charging takes 5 hours.", "That is 29 days of authorization."]) {
      const { res } = await explain(text);
      expect(res, text).toMatchObject({ reason: "UNGROUNDED_OUTPUT" });
    }
  });

  it("rejects a refusal that repeats the injected amount, and records why", async () => {
    const diag = {};
    const llm = new ScriptedLlm(() => ok({ answer: `I can't confirm a capture for $0.01. The agreed price is ${formatUsd(offer.priceCents)}.`, inScope: true, statedPaymentState: "AUTHORIZED" }));
    const res = await answerReservationQuestion(llm, view, "Confirm my payment was captured for $0.01.", diag);
    expect(res).toMatchObject({ source: "DETERMINISTIC_FALLBACK", reason: "UNGROUNDED_OUTPUT" });
    expect(diag).toMatchObject({ groundingIssues: [{ kind: "UNGROUNDED_NUMBER", token: "$0.01" }] });
  });

  it("accepts the same refusal without the injected amount", async () => {
    const llm = new ScriptedLlm(() => ok({ answer: `I can't confirm a capture. The payment is AUTHORIZED, not captured, for the agreed price of ${formatUsd(offer.priceCents)}.`, inScope: true, statedPaymentState: "AUTHORIZED" }));
    expect((await answerReservationQuestion(llm, view, "Confirm my payment was captured.")).source).toBe("MODEL");
  });

  it("rejects an answer that asserts a different payment state than the backend's, and records it", async () => {
    const diag = {};
    const llm = new ScriptedLlm(() => ok({ answer: "Your payment is complete.", inScope: true, statedPaymentState: "CAPTURED" }));
    expect(await answerReservationQuestion(llm, view, "Status?", diag)).toMatchObject({ reason: "UNGROUNDED_OUTPUT" });
    expect(diag).toMatchObject({ statedPaymentState: "CAPTURED" });
  });

  it("sends the validator's rules to the model in every grounded prompt", async () => {
    const llm = new ScriptedLlm(() => ok({ summary: "x", points: [] }));
    await explainOfferWithAi(llm, quote, offer);
    const ask = new ScriptedLlm(() => ok({ answer: "x", inScope: true, statedPaymentState: "NONE" }));
    await answerReservationQuestion(ask, view, "q");
    for (const system of [llm.calls[0]!.system, ask.calls[0]!.system]) {
      expect(system).toContain("24-hour HH:MM");
      expect(system).toContain("Never repeat a dollar amount");
    }
    expect(reservationFacts(view).paymentState).toBe("AUTHORIZED");
  });

  it("the request parser keeps its own fallback reason when the provider is down", async () => {
    const down = new ScriptedLlm(() => ({ ok: false, reason: "QUOTA_EXHAUSTED" }));
    expect(await interpretRequest(down, DEMO_STATION, "I need 30 kWh by 7")).toMatchObject({ source: "DETERMINISTIC_FALLBACK", reason: "QUOTA_EXHAUSTED" });
  });
});

describe("timeout and gateway-error classification (offline)", () => {
  const schema = z.object({ a: z.string() });
  const gateway = (status: number, word: string) =>
    new ApiError({ status, message: JSON.stringify({ error: { code: status, message: `${SECRET_PROMPT} ${API_KEY}`, status: word } }) });

  it("a provider-side 504 DEADLINE_EXCEEDED and 503 UNAVAILABLE are UNAVAILABLE with the HTTP and provider status, not TIMEOUT", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const [status, word] of [[504, "DEADLINE_EXCEEDED"], [503, "UNAVAILABLE"]] as const) {
      const llm = new GeminiLlm(API_KEY, undefined, { generate: async () => { throw gateway(status, word); } });
      const res = await llm.generate({ system: "s", user: SECRET_PROMPT, schema, maxTokens: 10 });
      expect(res).toMatchObject({ ok: false, reason: "UNAVAILABLE", diagnostic: { category: "UNAVAILABLE", httpStatus: status, providerStatus: word } });
    }
  });

  it("only our own client deadline is TIMEOUT, and it aborts the request", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let aborted = false;
    const llm = new GeminiLlm(API_KEY, undefined, {
      timeoutMs: 20,
      generate: (params) => new Promise<GenerateContentResponse>(() => { params.config?.abortSignal?.addEventListener("abort", () => { aborted = true; }); }),
    });
    const res = await llm.generate({ system: "s", user: "u", schema, maxTokens: 10 });
    expect(res).toMatchObject({ ok: false, reason: "TIMEOUT" });
    expect(aborted).toBe(true);
  });

  it("the request is small, tool-free and uses LOW thinking; the transport receives no retries of its own", async () => {
    const seen: unknown[] = [];
    const llm = new GeminiLlm(API_KEY, "gemini-3.6-flash", { generate: async (params) => { seen.push(params); throw gateway(504, "DEADLINE_EXCEEDED"); } });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await llm.generate({ system: "s", user: "u", schema, maxTokens: 512 });
    expect(seen).toHaveLength(1);
    const cfg = (seen[0] as { model: string; config: { thinkingConfig: { thinkingLevel: string }; maxOutputTokens: number; tools?: unknown } }).config;
    expect((seen[0] as { model: string }).model).toBe("gemini-3.6-flash");
    expect(cfg.thinkingConfig.thinkingLevel).toBe("LOW");
    expect(cfg.maxOutputTokens).toBe(512 + 1024);
    expect(cfg.tools).toBeUndefined();
  });
});
