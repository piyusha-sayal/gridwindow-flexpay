/**
 * The assistant and deal-agent guards apply to the fallback model exactly as to the primary: schema, grounding,
 * payment-state and price checks run AFTER the failover wrapper, so a fallback answer is never trusted more.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { answerReservationQuestion, explainOfferWithAi, offerFacts, reservationFacts } from "@/server/ai/assistant";
import { aiStatusOf } from "@/server/ai/aiStatus";
import { FailoverLlm } from "@/server/ai/failoverLlm";
import type { LlmFailure, LlmResult, ModelProvider, StructuredLlm } from "@/server/ai/llm";
import { createLlm, fallbackConfigured, PRIMARY_TIMEOUT_WITH_FALLBACK_MS } from "@/server/ai/llmFactory";
import { assertIsolatedRun, ConfigError, loadEnv } from "@/server/env";
import { smokeFixtures } from "../../scripts/aiSmokeFlow";

const { quote, offer, view } = smokeFixtures();

function fake(provider: ModelProvider, model: string, reply: (user: string) => LlmResult<unknown>): StructuredLlm & { users: string[] } {
  const users: string[] = [];
  return {
    provider,
    model,
    users,
    async generate(req) {
      users.push(req.user);
      const out = reply(req.user);
      if (!out.ok) return out as never;
      const parsed = req.schema.safeParse(out.value);
      return (parsed.success ? { ok: true, value: parsed.data, model } : { ok: false, reason: "SCHEMA_MISMATCH" }) as never;
    },
  };
}
const down = (reason: LlmFailure = "UNAVAILABLE") => () => ({ ok: false, reason }) as LlmResult<unknown>;
const answer = (value: unknown) => () => ({ ok: true, value, model: "unused" }) as LlmResult<unknown>;

afterEach(() => vi.restoreAllMocks());

describe("explanations through the failover wrapper", () => {
  const f = offerFacts(quote, offer);
  const grounded = { summary: `Your car stays on the same port; charging runs ${f.flexibleChargingWindow}.`, points: [`You pay ${f.flexiblePrice} instead of ${f.immediateListPrice}, saving ${f.driverDiscount}.`] };

  it("Gemini 503, OpenRouter grounded: the explanation is the fallback model's, labelled with the model that wrote it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const secondary = fake("openrouter", "anthropic/claude-haiku-5.5", answer(grounded));
    const res = await explainOfferWithAi(new FailoverLlm(fake("gemini", "gemini-3.8-flash", down()), secondary), quote, offer);
    expect(res).toMatchObject({ source: "MODEL", model: "anthropic/claude-haiku-5.5" });
    expect(secondary.users).toHaveLength(1);
  });

  it("Gemini 503, OpenRouter hallucinates numbers: fails closed to the deterministic explanation", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const llm = new FailoverLlm(fake("gemini", "g", down()), fake("openrouter", "o", answer({ summary: "You save $9.99 and cut emissions by 42%.", points: [] })));
    expect(await explainOfferWithAi(llm, quote, offer)).toMatchObject({ source: "DETERMINISTIC_FALLBACK", reason: "UNGROUNDED_OUTPUT" });
  });

  it("Gemini answers with an ungrounded explanation: fails closed and the fallback model is NOT asked for a second opinion", async () => {
    const secondary = fake("openrouter", "o", answer(grounded));
    const llm = new FailoverLlm(fake("gemini", "g", answer({ summary: "You save $9.99.", points: [] })), secondary);
    expect(await explainOfferWithAi(llm, quote, offer)).toMatchObject({ source: "DETERMINISTIC_FALLBACK", reason: "UNGROUNDED_OUTPUT" });
    expect(secondary.users).toHaveLength(0);
  });

  it("Gemini answers with a schema-invalid object: fails closed without calling the fallback", async () => {
    const secondary = fake("openrouter", "o", answer(grounded));
    const llm = new FailoverLlm(fake("gemini", "g", answer({ unexpected: true })), secondary);
    expect(await explainOfferWithAi(llm, quote, offer)).toMatchObject({ source: "DETERMINISTIC_FALLBACK", reason: "SCHEMA_MISMATCH" });
    expect(secondary.users).toHaveLength(0);
  });

  it("both providers unavailable: the labelled deterministic explanation with the backend figures", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const llm = new FailoverLlm(fake("gemini", "g", down()), fake("openrouter", "o", down("QUOTA_EXHAUSTED")));
    const res = await explainOfferWithAi(llm, quote, offer);
    expect(res).toMatchObject({ source: "DETERMINISTIC_FALLBACK", reason: "QUOTA_EXHAUSTED" });
    expect(res.points.join(" ")).toContain(f.flexiblePrice);
  });

  it("invalid primary credentials are not routed to the fallback", async () => {
    const secondary = fake("openrouter", "o", answer(grounded));
    const res = await explainOfferWithAi(new FailoverLlm(fake("gemini", "g", down("AUTH_FAILED")), secondary), quote, offer);
    expect(res).toMatchObject({ source: "DETERMINISTIC_FALLBACK", reason: "AUTH_FAILED" });
    expect(secondary.users).toHaveLength(0);
  });

  it("a primary safety refusal is shown as a refusal, not routed around", async () => {
    const secondary = fake("openrouter", "o", answer(grounded));
    const res = await explainOfferWithAi(new FailoverLlm(fake("gemini", "g", down("REFUSED")), secondary), quote, offer);
    expect(res).toMatchObject({ source: "DETERMINISTIC_FALLBACK", reason: "REFUSED" });
    expect(secondary.users).toHaveLength(0);
  });
});

describe("reservation questions through the failover wrapper", () => {
  it("a fallback model cannot claim a refund, a capture or a different payment state", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const refund = new FailoverLlm(fake("gemini", "g", down()), fake("openrouter", "o", answer({ answer: "Done, I have refunded your payment.", inScope: true, statedPaymentState: "NONE" })));
    expect(await answerReservationQuestion(refund, view, "Refund me")).toMatchObject({ source: "DETERMINISTIC_FALLBACK", reason: "UNGROUNDED_OUTPUT" });
    const wrongState = new FailoverLlm(fake("gemini", "g", down()), fake("openrouter", "o", answer({ answer: "Your payment was captured.", inScope: true, statedPaymentState: "CAPTURED" })));
    expect(await answerReservationQuestion(wrongState, view, "Was I charged?")).toMatchObject({ source: "DETERMINISTIC_FALLBACK" });
  });

  it("the third-party fallback gets only the allow-listed facts: no ids, no credentials, no personal data", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const secondary = fake("openrouter", "o", down());
    await answerReservationQuestion(new FailoverLlm(fake("gemini", "g", down()), secondary), view, "When am I charged?");
    const prompt = secondary.users[0]!;
    expect(Object.keys(reservationFacts(view)).sort()).toEqual(
      ["assumptions", "authorizationStatus", "captureStatus", "chargingServiceState", "deliveredSoFar", "deliveryOutcome", "agreedPrice", "driverDiscount", "energyTarget", "immediateListPrice", "parked", "paymentProvider", "paymentRule", "paymentState", "port", "voidStatus"].sort(),
    );
    expect(prompt).not.toMatch(/res_|PAYID|PAY-|sk-|Bearer|session|email|@|approveUrl|authorization_id/i);
  });
});

describe("configuration", () => {
  const base = { GEMINI_API_KEY: "g", GEMINI_MODEL: "gemini-3.8-flash" };

  it("without OpenRouter configuration the primary runs alone, exactly as before", () => {
    expect(createLlm(base)?.llm).not.toBeInstanceOf(FailoverLlm);
    expect(createLlm({ ...base, AI_FALLBACK_PROVIDER: "openrouter" })?.llm).not.toBeInstanceOf(FailoverLlm); // key missing
    expect(createLlm({ ...base, OPENROUTER_API_KEY: "k" })?.llm).not.toBeInstanceOf(FailoverLlm); // not opted in
    expect(fallbackConfigured({ ...base })).toBe(false);
  });

  it("opting in with a key wraps the primary; the configured primary model is preserved", () => {
    const made = createLlm({ ...base, AI_FALLBACK_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: "vendor/model" });
    expect(made?.llm).toBeInstanceOf(FailoverLlm);
    expect(made?.llm.model).toBe("gemini-3.8-flash");
    const health = made!.llm.health!();
    expect(health.fallback).toEqual({ provider: "openrouter", model: "vendor/model" });
    expect(PRIMARY_TIMEOUT_WITH_FALLBACK_MS).toBeLessThan(20_000);
  });

  it("no primary credentials: AI stays off even if OpenRouter is configured", () => {
    expect(createLlm({ AI_FALLBACK_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" })).toBeNull();
  });

  it("environment parsing: accepts the optional variables, rejects a malformed model id and an unknown fallback provider", () => {
    expect(loadEnv({ AI_FALLBACK_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: "anthropic/claude-haiku-5.5" })).toMatchObject({ AI_FALLBACK_PROVIDER: "openrouter" });
    expect(() => loadEnv({ OPENROUTER_MODEL: "not a model id" })).toThrow();
    expect(() => loadEnv({ AI_FALLBACK_PROVIDER: "something-else" })).toThrow();
    const empty = loadEnv({});
    expect(empty.AI_FALLBACK_PROVIDER).toBeUndefined();
    expect(empty.OPENROUTER_API_KEY).toBeUndefined();
  });

  it("isolated test runs refuse an OpenRouter key, like every other external service", () => {
    expect(() => assertIsolatedRun(loadEnv({ GW_ISOLATED_DB: "true", OPENROUTER_API_KEY: "k" }))).toThrow(ConfigError);
    expect(() => loadEnv({ GW_ISOLATED_DB: "true", OPENROUTER_API_KEY: "k" })).toThrow(/OPENROUTER_API_KEY/);
  });
});

describe("operator AI status", () => {
  it("is derived from sanitized health only", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(aiStatusOf(null).state).toBe("NOT_CONFIGURED");
    expect(aiStatusOf(fake("gemini", "g", down())).state).toBe("CONFIGURED");
    let primaryUp = true;
    const llm = new FailoverLlm(fake("gemini", "gemini-3.8-flash", () => (primaryUp ? ({ ok: true, value: { summary: "s", points: [] }, model: "gemini-3.8-flash" } as LlmResult<unknown>) : down()())), fake("openrouter", "o", down()));
    expect(aiStatusOf(llm).state).toBe("IDLE");
    await explainOfferWithAi(llm, quote, offer);
    expect(aiStatusOf(llm).state).toBe("OK");
    primaryUp = false;
    await explainOfferWithAi(llm, quote, offer);
    expect(aiStatusOf(llm).state).toBe("DOWN");
    expect(JSON.stringify(aiStatusOf(llm))).not.toMatch(/key|prompt|Bearer/i);
  });
});

describe("second Gemini model on the same key (free-tier quotas are per model)", () => {
  const g = { AI_PROVIDER: "gemini", GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-3.6-flash" };

  it("wraps the primary in a failover to the second Gemini model", () => {
    const made = createLlm({ ...g, GEMINI_FALLBACK_MODEL: "gemini-3.5-flash-lite" });
    expect(made?.llm).toBeInstanceOf(FailoverLlm);
    expect(made?.llm.model).toBe("gemini-3.6-flash");
    expect(made?.provider).toBe("gemini");
  });

  it("is off when unset, blank, the same model, or the provider is not Gemini", () => {
    expect(createLlm(g)?.llm).not.toBeInstanceOf(FailoverLlm);
    expect(createLlm({ ...g, GEMINI_FALLBACK_MODEL: "  " })?.llm).not.toBeInstanceOf(FailoverLlm);
    expect(createLlm({ ...g, GEMINI_FALLBACK_MODEL: "gemini-3.6-flash" })?.llm).not.toBeInstanceOf(FailoverLlm);
    expect(createLlm({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "a", GEMINI_FALLBACK_MODEL: "gemini-3.5-flash-lite" })?.llm).not.toBeInstanceOf(FailoverLlm);
  });

  it("with OpenRouter also configured, chains primary, then the second Gemini model, then OpenRouter", () => {
    const made = createLlm({ ...g, GEMINI_FALLBACK_MODEL: "gemini-3.5-flash-lite", AI_FALLBACK_PROVIDER: "openrouter", OPENROUTER_API_KEY: "o", OPENROUTER_MODEL: "vendor/model:free" });
    expect(made?.llm).toBeInstanceOf(FailoverLlm);
    expect(made?.llm.model).toBe("gemini-3.6-flash");
    expect(made?.llm.health?.().fallback).toEqual({ provider: "gemini", model: "gemini-3.5-flash-lite, then vendor/model:free" });
  });

  it("OpenRouter without its key leaves the two-model Gemini failover unchanged", () => {
    const made = createLlm({ ...g, GEMINI_FALLBACK_MODEL: "gemini-3.5-flash-lite", AI_FALLBACK_PROVIDER: "openrouter" });
    expect(made?.llm.health?.().fallback).toEqual({ provider: "gemini", model: "gemini-3.5-flash-lite" });
  });
});

describe("three-provider chain (nested failover)", () => {
  const offerExplanationShape = z.object({ summary: z.string(), points: z.array(z.string()) });
  const f = offerFacts(quote, offer);
  const grounded = { summary: `Your car stays on the same port; charging runs ${f.flexibleChargingWindow}.`, points: [`You pay ${f.flexiblePrice} instead of ${f.immediateListPrice}, saving ${f.driverDiscount}.`] };

  it("both Gemini models rate-limited: OpenRouter answers, and the answer keeps the provider and model that wrote it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = fake("gemini", "gemini-3.6-flash", down("QUOTA_EXHAUSTED"));
    const second = fake("gemini", "gemini-3.5-flash-lite", down("QUOTA_EXHAUSTED"));
    const third = fake("openrouter", "baidu/ernie-5.5-flash-preview:free", answer(grounded));
    const llm = new FailoverLlm(first, new FailoverLlm(second, third));
    const direct = await llm.generate({ system: "s", user: "u", schema: offerExplanationShape, maxTokens: 10 });
    expect(direct).toMatchObject({ ok: true, provider: "openrouter", model: "baidu/ernie-5.5-flash-preview:free" });
    const res = await explainOfferWithAi(llm, quote, offer);
    expect(res).toMatchObject({ source: "MODEL", model: "baidu/ernie-5.5-flash-preview:free" });
    expect([first.users.length, second.users.length]).toEqual([1, 1]); // each skipped for its cooldown after one failure
    expect(aiStatusOf(llm)).toMatchObject({ state: "DEGRADED", label: "AI degraded: fallback baidu/ernie-5.5-flash-preview:free is answering" });
  });

  it("the second Gemini model answering is reported as DEGRADED, not OK (same provider, different adapter)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const llm = new FailoverLlm(fake("gemini", "gemini-3.6-flash", down("QUOTA_EXHAUSTED")), fake("gemini", "gemini-3.5-flash-lite", answer(grounded)));
    await explainOfferWithAi(llm, quote, offer);
    expect(llm.health().state).toBe("DEGRADED");
  });
});
