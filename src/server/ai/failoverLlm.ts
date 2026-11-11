/**
 * Primary model with ONE controlled fallback. The wrapper only decides which adapter to ask; every answer, from either
 * adapter, still goes through the same schema parse and grounding checks in the assistant, deal agent and recovery agent,
 * and no model has any payment capability. It never retries the same provider.
 *
 * Routing:
 *  - transient primary failure (UNAVAILABLE: network or 5xx, TIMEOUT, QUOTA_EXHAUSTED: 429) -> ask the fallback once;
 *  - AUTH_FAILED, REQUEST_REJECTED, REFUSED, INVALID_OUTPUT, SCHEMA_MISMATCH -> returned as is (a refusal or a bad answer is
 *    not an outage to route around, and a rejected request would be rejected again);
 *  - fallback failure -> returned, and the caller shows its labelled deterministic answer.
 * After a transient primary failure the primary is skipped for a short cooldown, so users are not made to wait on a provider
 * that just failed. Total waiting is capped by an overall budget, and an optional shared request budget caps how many
 * provider requests one unit of work may make across both providers.
 */
import type { z } from "zod";
import type { AiAttempt, AiHealth, LlmFailure, LlmResult, ModelProvider, RequestBudget, StructuredLlm } from "./llm";

export const OVERALL_BUDGET_MS = 16_000;
export const PRIMARY_COOLDOWN_MS = 30_000;
/** Below this much remaining budget a second provider is not attempted. */
export const MIN_FALLBACK_BUDGET_MS = 2_000;
const RECENT_LIMIT = 20;

const TRANSIENT: ReadonlySet<LlmFailure> = new Set(["UNAVAILABLE", "TIMEOUT", "QUOTA_EXHAUSTED"]);

export interface FailoverOptions {
  now?: () => number;
  overallBudgetMs?: number;
  cooldownMs?: number;
  minFallbackBudgetMs?: number;
}

type Req<S extends z.ZodType> = { system: string; user: string; schema: S; maxTokens: number; requestBudget?: RequestBudget };

export class FailoverLlm implements StructuredLlm {
  readonly provider: ModelProvider;
  readonly model: string;
  private readonly now: () => number;
  private readonly budgetMs: number;
  private readonly cooldownMs: number;
  private readonly minFallbackBudgetMs: number;
  private primaryDownUntil = 0;
  private recent: AiAttempt[] = [];

  constructor(
    private readonly primary: StructuredLlm,
    private readonly fallback: StructuredLlm,
    options: FailoverOptions = {},
  ) {
    this.provider = primary.provider;
    this.model = primary.model;
    this.now = options.now ?? (() => Date.now());
    this.budgetMs = options.overallBudgetMs ?? OVERALL_BUDGET_MS;
    this.cooldownMs = options.cooldownMs ?? PRIMARY_COOLDOWN_MS;
    this.minFallbackBudgetMs = options.minFallbackBudgetMs ?? MIN_FALLBACK_BUDGET_MS;
  }

  async generate<S extends z.ZodType>(req: Req<S>): Promise<LlmResult<z.infer<S>>> {
    const started = this.now();
    if (started >= this.primaryDownUntil) {
      const first = await this.attempt(this.primary, req, this.budgetMs);
      if (first.ok || !isTransient(first)) return first;
      this.primaryDownUntil = this.now() + this.cooldownMs;
      return this.second(req, started, first.reason);
    }
    return this.second(req, started, null);
  }

  private async second<S extends z.ZodType>(req: Req<S>, started: number, primaryReason: LlmFailure | null): Promise<LlmResult<z.infer<S>>> {
    const remaining = this.budgetMs - (this.now() - started);
    if (remaining < this.minFallbackBudgetMs) return { ok: false, reason: primaryReason ?? "TIMEOUT" };
    // The caller paid for the first request of this call. A second request (after a real primary attempt) needs its own.
    if (primaryReason !== null && req.requestBudget && !req.requestBudget.take()) return { ok: false, reason: primaryReason };
    const res = await this.attempt(this.fallback, req, remaining);
    const outcome = res.ok ? "ok" : res.reason;
    console.warn(`[gridwindow] ai failover: ${this.primary.provider} ${primaryReason ?? "skipped (cooldown)"} -> ${this.fallback.provider} ${outcome}`);
    return res;
  }

  /** One adapter call, bounded by the remaining budget, recorded without prompt or model text. */
  private async attempt<S extends z.ZodType>(llm: StructuredLlm, req: Req<S>, budgetMs: number): Promise<LlmResult<z.infer<S>>> {
    const t0 = this.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<LlmResult<never>>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: "TIMEOUT" }), budgetMs);
    });
    let res: LlmResult<z.infer<S>>;
    try {
      res = await Promise.race([llm.generate(req), deadline]);
    } catch {
      res = { ok: false, reason: "UNAVAILABLE" };
    } finally {
      clearTimeout(timer);
    }
    this.record({
      at: t0,
      provider: llm.provider,
      model: res.ok ? res.model : llm.model,
      outcome: res.ok ? "OK" : res.reason,
      latencyMs: Math.max(0, this.now() - t0),
      ...(res.usage ? { inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens } : {}),
    });
    return res.ok ? { ...res, provider: llm.provider } : res;
  }

  private record(a: AiAttempt): void {
    this.recent = [...this.recent, a].slice(-RECENT_LIMIT);
  }

  health(): AiHealth {
    const last = this.recent[this.recent.length - 1];
    const state: AiHealth["state"] = !last ? "IDLE" : last.outcome !== "OK" ? "DOWN" : last.provider === this.primary.provider ? "OK" : "DEGRADED";
    return {
      state,
      primary: { provider: this.primary.provider, model: this.primary.model },
      fallback: { provider: this.fallback.provider, model: this.fallback.model },
      recent: [...this.recent],
    };
  }
}

function isTransient(res: Extract<LlmResult<unknown>, { ok: false }>): boolean {
  return TRANSIENT.has(res.reason);
}
