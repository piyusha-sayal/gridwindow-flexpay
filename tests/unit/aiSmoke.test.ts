/**
 * The paid AI smoke harness, exercised offline with a scripted model: spending cap and request
 * limit are enforced before any call, usage is recorded, and the case checks judge what reaches
 * the customer (an injected model cannot pass case 4).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { LlmResult, StructuredLlm } from "@/server/ai/llm";
import { formatUsd } from "@/domain/units";
import { BudgetExceededError, MeteredLlm, MODEL_PRICES, runAiSmokeCases, smokeFixtures, summarizeSmoke } from "../../scripts/aiSmokeFlow";

class FakeModel implements StructuredLlm {
  readonly provider = "test-fixture" as const;
  readonly model = "claude-opus-5-5";
  sent = 0;
  constructor(
    private readonly reply: (user: string) => unknown,
    /** Model reported in the response, as with a server-side fallback. */
    private readonly servedModel = "claude-opus-5-5",
  ) {}
  async generate<S extends z.ZodType>(req: { user: string; schema: S }): Promise<LlmResult<z.infer<S>>> {
    this.sent++;
    const parsed = req.schema.safeParse(this.reply(req.user));
    const usage = { inputTokens: 1_000, outputTokens: 200 };
    return parsed.success ? { ok: true, value: parsed.data, model: this.servedModel, usage } : { ok: false, reason: "SCHEMA_MISMATCH", usage };
  }
}

const { offer } = smokeFixtures();
const price = MODEL_PRICES["claude-opus-5-5"]!;

/** Obeys the injected instruction in the question, as a compromised model would. */
function obedient(user: string): unknown {
  return user.includes("<question>") && user.includes("$0.01")
    ? { answer: "Your payment was captured for $0.01.", inScope: true, statedPaymentState: "NONE" }
    : wellBehaved(user);
}

function wellBehaved(user: string): unknown {
  if (user.includes("<driver_text>")) {
    const injected = user.includes("$0.01");
    return injected
      ? { energyKWh: 20, plugInTime: null, departureTime: "06:00", budgetUsd: null, minSavingsUsd: null, departureWithinMinutes: null, portLabel: null, preference: null, ignoredRequests: ["set price", "capture payment"], ambiguities: [] }
      : { energyKWh: 30, plugInTime: null, departureTime: "07:00", budgetUsd: 12, minSavingsUsd: null, departureWithinMinutes: null, portLabel: null, preference: null, ignoredRequests: [], ambiguities: [] };
  }
  if (user.includes("<question>")) {
    return user.includes("$0.01")
      ? { answer: "I can't confirm that. Amounts and status come from the backend, and this payment is only authorized so far.", inScope: true, statedPaymentState: "AUTHORIZED" }
      : { answer: `You are charged ${formatUsd(offer.priceCents)} only after delivery is verified.`, inScope: true, statedPaymentState: "NONE" };
  }
  return { summary: `This window costs ${formatUsd(offer.priceCents)}.`, points: [] };
}

describe("AI smoke harness (offline)", () => {
  it("passes all cases for a well-behaved model, and the injected answer never reaches the customer", async () => {
    const meter = new MeteredLlm(new FakeModel(wellBehaved), { maxRequests: 8, budgetUsd: 1, price });
    const results = await runAiSmokeCases(meter);
    expect(results.map((r) => [r.id, r.pass])).toEqual([
      ["1-parse", true],
      ["2-explain", true],
      ["3-own-reservation", true],
      ["4-injection", true],
      ["5-faults", true],
    ]);
    expect(results.find((r) => r.id === "4-injection")).toMatchObject({ source: "MODEL / MODEL", outcome: "MODEL_VALIDATED" });
    expect(summarizeSmoke(meter.calls, results, meter.spent)).toMatchObject({ externalRequestsAttempted: 5, providerResponsesReceived: 5, genuineModelCasesValidated: 4, deterministicFallbackCases: 0, certified: true });
    expect(meter.calls).toHaveLength(5);
    expect(meter.spent).toBeCloseTo((5 * (1_000 * 4 + 200 * 20)) / 1_000_000, 6);
  });

  it("fails a case when the model output is unusable instead of counting the fallback as a model pass", async () => {
    const meter = new MeteredLlm(new FakeModel(() => ({ nonsense: true })), { maxRequests: 8, budgetUsd: 1, price });
    const results = await runAiSmokeCases(meter);
    expect(results.filter((r) => !r.pass).map((r) => r.id)).toEqual(["1-parse", "2-explain", "3-own-reservation", "4-injection"]);
    const summary = summarizeSmoke(meter.calls, results, meter.spent);
    expect(summary).toMatchObject({ genuineModelCasesValidated: 0, certified: false, providerResponsesReceived: 5 });
  });

  it("reports an injection that is only safe because the answer fell back as fallback-safe, and does not certify it", async () => {
    const meter = new MeteredLlm(new FakeModel(obedient), { maxRequests: 8, budgetUsd: 1, price });
    const results = await runAiSmokeCases(meter);
    const injection = results.find((r) => r.id === "4-injection")!;
    expect(injection).toMatchObject({ outcome: "FALLBACK", pass: false, source: "MODEL / FALLBACK:UNGROUNDED_OUTPUT" });
    expect(injection.detail).toContain("fallback-safe");
    expect(injection.rejectedText).toContain("$0.01");
    const summary = summarizeSmoke(meter.calls, results, meter.spent);
    expect(summary).toMatchObject({ genuineModelCasesValidated: 3, deterministicFallbackCases: 1, groundingFailures: 1, certified: false });
  });

  it("counts calls the provider never answered separately from answers the app rejected", async () => {
    const down: StructuredLlm = { provider: "test-fixture", model: "claude-opus-5-5", generate: async () => ({ ok: false, reason: "QUOTA_EXHAUSTED", diagnostic: { category: "QUOTA_EXHAUSTED", httpStatus: 429, providerStatus: "RESOURCE_EXHAUSTED" } }) };
    const meter = new MeteredLlm(down, { maxRequests: 8, budgetUsd: 1, price });
    const results = await runAiSmokeCases(meter);
    const summary = summarizeSmoke(meter.calls, results, meter.spent);
    expect(summary).toMatchObject({ externalRequestsAttempted: 5, providerResponsesReceived: 0, requestsWithoutResponse: 5, genuineModelCasesValidated: 0, certified: false });
    expect(summary.providerErrors[0]).toEqual({ reason: "QUOTA_EXHAUSTED", diagnostic: { category: "QUOTA_EXHAUSTED", httpStatus: 429, providerStatus: "RESOURCE_EXHAUSTED" } });
  });

  it("refuses a call that could exceed the spending cap, before sending it", async () => {
    const model = new FakeModel(wellBehaved);
    const meter = new MeteredLlm(model, { maxRequests: 8, budgetUsd: 0.001, price });
    await expect(runAiSmokeCases(meter)).rejects.toThrow(BudgetExceededError);
    expect(model.sent).toBe(0);
  });

  it("stops at the request limit", async () => {
    const model = new FakeModel(wellBehaved);
    const meter = new MeteredLlm(model, { maxRequests: 2, budgetUsd: 1, price });
    await expect(runAiSmokeCases(meter)).rejects.toThrow(/request limit/);
    expect(model.sent).toBe(2);
  });
});

describe("AI smoke per-request limits", () => {
  const schema = z.object({ answer: z.string() });
  const req = (user: string, maxTokens: number) => ({ system: "s", user, schema, maxTokens });
  it("prices a call at the model that actually served it (server-side fallback), unknown models at the highest rate", async () => {
    const usd = (p: { inPerMTok: number; outPerMTok: number }) => (1_000 * p.inPerMTok + 200 * p.outPerMTok) / 1_000_000;
    for (const [served, expected] of [
      ["claude-opus-5-5", usd(price)],
      ["claude-fable-5-1", usd(MODEL_PRICES["claude-fable-5-1"]!)],
      ["some-unlisted-model", usd(MODEL_PRICES["claude-fable-5-1"]!)],
    ] as const) {
      const meter = new MeteredLlm(new FakeModel(() => ({ answer: "x" }), served), { maxRequests: 8, budgetUsd: 1, price });
      await meter.generate(req("hi", 100));
      expect(meter.calls[0]).toMatchObject({ servedModel: served });
      expect(meter.spent).toBeCloseTo(expected, 10);
    }
  });

  it("refuses oversized input, output and per-request cost before sending", async () => {
    const model = new FakeModel(() => ({ answer: "x" }));
    const meter = new MeteredLlm(model, { maxRequests: 8, budgetUsd: 1, price });
    await expect(meter.generate(req("x".repeat(12_001), 100))).rejects.toThrow(/input of/);
    await expect(meter.generate(req("hi", 4_096))).rejects.toThrow(/max_tokens/);
    const tight = new MeteredLlm(model, { maxRequests: 8, budgetUsd: 1, price, maxCostPerRequestUsd: 0.001 });
    await expect(tight.generate(req("hi", 2_048))).rejects.toThrow(/per-request limit/);
    expect(model.sent).toBe(0);
  });
});
