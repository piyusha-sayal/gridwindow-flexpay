/** Failover routing, budgets and health, offline: both providers are scripted fakes. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FailoverLlm, OVERALL_BUDGET_MS, PRIMARY_COOLDOWN_MS } from "@/server/ai/failoverLlm";
import type { LlmFailure, LlmResult, ModelProvider, StructuredLlm } from "@/server/ai/llm";
import { recordedModelProvider } from "@/server/services/recoveryProvenance";
import type { RunTraceEntry } from "@/server/services/recoveryRuns";

const API_KEY = "key-that-must-never-be-recorded";
const SECRET_PROMPT = "PROMPT-CONTENT-THAT-MUST-NOT-LEAK";
const schema = z.object({ summary: z.string() });
const req = { system: "sys", user: SECRET_PROMPT, schema, maxTokens: 100 };

type Script = () => Promise<LlmResult<unknown>> | LlmResult<unknown>;
class Fake implements StructuredLlm {
  calls = 0;
  constructor(
    readonly provider: ModelProvider,
    readonly model: string,
    private script: Script,
  ) {}
  async generate<S extends z.ZodType>(): Promise<LlmResult<z.infer<S>>> {
    this.calls += 1;
    return (await this.script()) as LlmResult<z.infer<S>>;
  }
}
const good = (model: string): LlmResult<unknown> => ({ ok: true, value: { summary: "fine" }, model, usage: { inputTokens: 10, outputTokens: 5 } });
const bad = (reason: LlmFailure): LlmResult<unknown> => ({ ok: false, reason });

function setup(primary: Script, fallback: Script, options: ConstructorParameters<typeof FailoverLlm>[2] = {}) {
  const p = new Fake("gemini", "gemini-3.8-flash", primary);
  const f = new Fake("openrouter", "anthropic/claude-haiku-5.5", fallback);
  const clock = { t: 1_000_000 };
  const llm = new FailoverLlm(p, f, { now: () => clock.t, ...options });
  return { p, f, llm, clock };
}

afterEach(() => vi.restoreAllMocks());

describe("routing", () => {
  it("Gemini succeeds: the fallback is not called", async () => {
    const { p, f, llm } = setup(() => good("gemini-3.8-flash"), () => good("x"));
    const res = await llm.generate(req);
    expect(res).toMatchObject({ ok: true, provider: "gemini", model: "gemini-3.8-flash" });
    expect([p.calls, f.calls]).toEqual([1, 0]);
  });

  it.each<[string, LlmFailure]>([
    ["503 / network (UNAVAILABLE)", "UNAVAILABLE"],
    ["429 (QUOTA_EXHAUSTED)", "QUOTA_EXHAUSTED"],
    ["timeout", "TIMEOUT"],
  ])("Gemini %s: the fallback answers once and is tagged as the serving provider", async (_name, reason) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { p, f, llm } = setup(() => bad(reason), () => good("anthropic/claude-haiku-5.5-20260101"));
    const res = await llm.generate(req);
    expect(res).toMatchObject({ ok: true, provider: "openrouter", model: "anthropic/claude-haiku-5.5-20260101" });
    expect([p.calls, f.calls]).toEqual([1, 1]);
  });

  it.each<LlmFailure>(["AUTH_FAILED", "REQUEST_REJECTED", "REFUSED", "INVALID_OUTPUT", "SCHEMA_MISMATCH", "NOT_CONFIGURED"])(
    "primary %s is returned as is: not an outage to route around, no second provider, no retry",
    async (reason) => {
      const { p, f, llm } = setup(() => bad(reason), () => good("x"));
      expect(await llm.generate(req)).toEqual({ ok: false, reason });
      expect([p.calls, f.calls]).toEqual([1, 0]);
    },
  );

  it("a primary that throws counts as UNAVAILABLE and is routed to the fallback", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { llm } = setup(() => Promise.reject(new Error(`boom ${API_KEY}`)), () => good("m"));
    expect(await llm.generate(req)).toMatchObject({ ok: true, provider: "openrouter" });
  });

  it("fallback also fails: its failure is returned (the caller then shows the deterministic answer); each provider is asked once", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { p, f, llm } = setup(() => bad("UNAVAILABLE"), () => bad("QUOTA_EXHAUSTED"));
    expect(await llm.generate(req)).toEqual({ ok: false, reason: "QUOTA_EXHAUSTED" });
    expect([p.calls, f.calls]).toEqual([1, 1]);
  });

  it("fallback authentication failure is not retried", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { f, llm } = setup(() => bad("UNAVAILABLE"), () => bad("AUTH_FAILED"));
    expect(await llm.generate(req)).toEqual({ ok: false, reason: "AUTH_FAILED" });
    expect(f.calls).toBe(1);
  });
});

describe("cooldown and budget", () => {
  it("skips the failed primary during the cooldown (no wait on a down provider), then probes it again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let primaryUp = false;
    const { p, f, llm, clock } = setup(() => (primaryUp ? good("gemini-3.8-flash") : bad("UNAVAILABLE")), () => good("fb"));
    await llm.generate(req);
    await llm.generate(req);
    await llm.generate(req);
    expect([p.calls, f.calls]).toEqual([1, 3]);
    clock.t += PRIMARY_COOLDOWN_MS + 1;
    primaryUp = true;
    expect(await llm.generate(req)).toMatchObject({ ok: true, provider: "gemini" });
    expect([p.calls, f.calls]).toEqual([2, 3]);
  });

  it("stays within the overall budget when the primary hangs, and does not start a fallback it cannot finish", async () => {
    const { llm, f } = setup(() => new Promise(() => undefined), () => good("fb"), { overallBudgetMs: 120, minFallbackBudgetMs: 50, now: () => Date.now() });
    const t0 = Date.now();
    const res = await llm.generate(req);
    expect(res).toEqual({ ok: false, reason: "TIMEOUT" });
    expect(Date.now() - t0).toBeLessThan(400);
    expect(f.calls).toBe(0);
  });

  it("gives the fallback only the remaining budget", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const slowPrimaryFailure: Script = () => new Promise((resolve) => setTimeout(() => resolve(bad("UNAVAILABLE")), 60));
    const { llm, f } = setup(slowPrimaryFailure, () => new Promise(() => undefined), { overallBudgetMs: 250, minFallbackBudgetMs: 20, now: () => Date.now() });
    const t0 = Date.now();
    expect(await llm.generate(req)).toEqual({ ok: false, reason: "TIMEOUT" });
    expect(Date.now() - t0).toBeLessThan(600);
    expect(f.calls).toBe(1);
  });

  it("defaults keep the worst case well under half a minute", () => {
    expect(OVERALL_BUDGET_MS).toBeLessThanOrEqual(20_000);
  });
});

describe("health and diagnostics", () => {
  it("reports IDLE, OK, DEGRADED and DOWN from the recent attempts only", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let primary: LlmResult<unknown> = good("gemini-3.8-flash");
    let fallback: LlmResult<unknown> = good("fb-model");
    const { llm, clock } = setup(() => primary, () => fallback);
    expect(llm.health().state).toBe("IDLE");
    await llm.generate(req);
    expect(llm.health().state).toBe("OK");
    primary = bad("UNAVAILABLE");
    clock.t += PRIMARY_COOLDOWN_MS + 1;
    await llm.generate(req);
    expect(llm.health().state).toBe("DEGRADED");
    fallback = bad("UNAVAILABLE");
    await llm.generate(req);
    expect(llm.health().state).toBe("DOWN");
  });

  it("records provider, model, outcome, latency and usage, and never a prompt, a key or model text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { llm } = setup(() => bad("UNAVAILABLE"), () => good("fb-model"));
    await llm.generate(req);
    const health = llm.health();
    expect(health.recent).toEqual([
      expect.objectContaining({ provider: "gemini", model: "gemini-3.8-flash", outcome: "UNAVAILABLE" }),
      expect.objectContaining({ provider: "openrouter", model: "fb-model", outcome: "OK", inputTokens: 10, outputTokens: 5 }),
    ]);
    for (const a of health.recent) expect(typeof a.latencyMs).toBe("number");
    const everything = JSON.stringify(health) + JSON.stringify(warn.mock.calls);
    expect(everything).not.toContain(SECRET_PROMPT);
    expect(everything).not.toContain(API_KEY);
    expect(everything).not.toContain("fine");
    expect(warn.mock.calls.flat().join(" ")).toContain("ai failover: gemini UNAVAILABLE -> openrouter ok");
  });

  it("keeps a bounded history", async () => {
    const { llm } = setup(() => good("m"), () => good("m"));
    for (let i = 0; i < 50; i++) await llm.generate(req);
    expect(llm.health().recent.length).toBeLessThanOrEqual(20);
  });
});

describe("recovery provenance names the provider that answered", () => {
  const entry = (modelProvider: string): RunTraceEntry => ({ seq: 0, at: 0, tool: "orchestrator", actor: "DETERMINISTIC", input: { modelProvider }, outcome: "INFO", detail: "" }) as unknown as RunTraceEntry;
  it("uses the last recorded provider, including openrouter", () => {
    expect(recordedModelProvider([entry("gemini")])).toBe("gemini");
    expect(recordedModelProvider([entry("gemini"), entry("openrouter")])).toBe("openrouter");
    expect(recordedModelProvider([])).toBeNull();
  });
});
