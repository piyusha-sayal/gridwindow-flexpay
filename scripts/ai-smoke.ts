/**
 * Real model API smoke test (Anthropic is PAID; Gemini free tier is priced at $0 but counts against the same request cap).
 * Without --approve-paid-calls it only prints the plan. Provider: AI_PROVIDER, else Gemini when GEMINI_API_KEY is set,
 * else Anthropic. Requires that provider's key in .env.local and AI_SMOKE_BUDGET_USD (spending cap in USD).
 * Limits: at most AI_SMOKE_MAX_REQUESTS calls (default 8), each checked against the cap before it
 * is sent, one SDK retry at most, 20 s timeout. Synthetic data only; no tools. Prints metrics, never
 * prompts, keys or model text beyond short case details. Writes artifacts/ai-smoke.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GEMINI_MODEL, GeminiLlm } from "../src/server/ai/geminiLlm";
import { AnthropicLlm, DEFAULT_AI_MODEL, type StructuredLlm } from "../src/server/ai/llm";
import { selectProvider } from "../src/server/ai/llmFactory";
import { BudgetExceededError, MeteredLlm, MODEL_PRICES, runAiSmokeCases, summarizeSmoke } from "./aiSmokeFlow";

const APPROVAL_FLAG = "--approve-paid-calls";
const DEFAULT_BUDGET_USD = 0.5;
const log = (msg: string) => process.stdout.write(`${msg}\n`);

async function loadDotEnvLocal(): Promise<Record<string, string>> {
  try {
    const text = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .filter((l) => /^[A-Z0-9_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
}

async function main() {
  // The dry run reads only the process environment; .env.local is opened only after approval.
  const env = { ...(process.argv.includes(APPROVAL_FLAG) ? await loadDotEnvLocal() : {}), ...process.env } as Record<string, string | undefined>;
  const provider = selectProvider(env) ?? (env.AI_PROVIDER === "gemini" ? "gemini" : "anthropic");
  const model = provider === "gemini" ? env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL : env.AI_MODEL?.trim() || DEFAULT_AI_MODEL;
  const maxRequests = Number(env.AI_SMOKE_MAX_REQUESTS ?? 8);
  const budgetUsd = Number(env.AI_SMOKE_BUDGET_USD ?? DEFAULT_BUDGET_USD);
  // Gemini: the pricing page lists the stable Flash models as free of charge on the free tier. A billing-enabled key may be charged.
  const price = provider === "gemini" ? { inPerMTok: 0, outPerMTok: 0 } : MODEL_PRICES[model];
  log(`AI smoke plan: provider=${provider}, model=${model}, 5 calls (parse, explain, own-reservation Q&A, 2 injection probes), limit ${maxRequests} requests, cap $${budgetUsd} (AI_SMOKE_BUDGET_USD, default $${DEFAULT_BUDGET_USD}); per request ≤ 12,000 input chars, ≤ 2,048 output tokens incl. thinking, ≤ $0.10 worst case; no retries. Pre-call figures are estimates; actual usage is reported after.`);
  if (!process.argv.includes(APPROVAL_FLAG)) {
    if (!env.AI_PROVIDER && !env.GEMINI_API_KEY && !env.ANTHROPIC_API_KEY) log("Note: the dry run does not open .env.local, so the provider shown above is only the default. With --approve-paid-calls it is chosen from the keys in .env.local (AI_PROVIDER, else Gemini, else Anthropic).");
    log(`Dry run only. Set AI_SMOKE_BUDGET_USD and re-run with ${APPROVAL_FLAG} to make external model calls.`);
    return;
  }
  const apiKey = provider === "gemini" ? env.GEMINI_API_KEY : env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error(`${provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"} is not set in .env.local`);
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 5) throw new Error("AI_SMOKE_BUDGET_USD must be a number in (0, 5]");
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 20) throw new Error("AI_SMOKE_MAX_REQUESTS must be an integer in [1, 20]");
  if (!price) throw new Error(`no verified price for ${model}; add it to MODEL_PRICES after checking official pricing`);

  // Anthropic: SDK retries are off, because a retried call could be billed twice outside the meter's view.
  // Gemini: the client is configured with retryOptions.attempts = 1; what that means exactly is not yet verified by a live run.
  const inner: StructuredLlm = provider === "gemini" ? new GeminiLlm(apiKey, model) : new AnthropicLlm(apiKey, model, { maxRetries: 0 });

  // Metadata-only preflight (no generation, no tokens): does the key's project see this model at all?
  let preflight: Awaited<ReturnType<typeof GeminiLlm.checkModelAccess>> | null = null;
  if (provider === "gemini") {
    preflight = await GeminiLlm.checkModelAccess(apiKey, model);
    log(`preflight models.get(${model}): available=${preflight.available} generateContent=${preflight.supportsGenerateContent}${preflight.diagnostic ? ` diagnostic=${JSON.stringify(preflight.diagnostic)}` : ""}`);
    if (!preflight.available || !preflight.supportsGenerateContent) {
      log("Preflight failed: no generation request was sent. Check the model ID and that this key's project can use it (AI Studio > API keys).");
      process.exit(1);
    }
  }

  const meter = new MeteredLlm(inner, { maxRequests, budgetUsd, price });
  let results: Awaited<ReturnType<typeof runAiSmokeCases>> = [];
  let stopped: string | null = null;
  try {
    results = await runAiSmokeCases(meter);
  } catch (err) {
    if (!(err instanceof BudgetExceededError)) throw err;
    stopped = err.message;
  }
  const summary = summarizeSmoke(meter.calls, results, meter.spent);
  const ranAt = new Date().toISOString();
  const out = {
    ranAt,
    provider,
    model,
    servedModels: [...new Set(meter.calls.flatMap((c) => (c.servedModel ? [c.servedModel] : [])))],
    preflight: preflight ? { available: preflight.available, supportsGenerateContent: preflight.supportsGenerateContent, diagnostic: preflight.diagnostic ?? null } : null,
    summary,
    calls: meter.calls.map((c) => ({ ok: c.ok, responded: c.responded, reason: c.reason, diagnostic: c.diagnostic, latencyMs: c.latencyMs, inputTokens: c.inputTokens, outputTokens: c.outputTokens })),
    stoppedByLimit: stopped,
    cases: results,
  };
  // One file per run so an earlier result is never overwritten.
  await mkdir(path.join(process.cwd(), "artifacts"), { recursive: true });
  const file = path.join(process.cwd(), "artifacts", `ai-smoke-${provider}-${ranAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(out, null, 2) + "\n");
  for (const c of results) log(`${c.outcome.padEnd(15)} ${c.id} [${c.source}] ${c.detail}`);
  log(`external requests attempted=${summary.externalRequestsAttempted} provider responses=${summary.providerResponsesReceived} without response=${summary.requestsWithoutResponse}`);
  log(`genuine model cases validated=${summary.genuineModelCasesValidated}/${summary.mandatoryCases} deterministic fallbacks=${summary.deterministicFallbackCases} model rejected=${summary.modelRejectedCases} grounding failures=${summary.groundingFailures} offline=${summary.offlineCases}`);
  log(`tokens in/out=${summary.tokens.inputTokens}/${summary.tokens.outputTokens} estimated cost=$${summary.estimatedCostUsd} (reported usage x list price; Gemini free tier priced at $0)`);
  for (const e of summary.providerErrors) log(`provider error: ${e.reason} ${JSON.stringify(e.diagnostic)}`);
  log(summary.certified && !stopped ? `CERTIFIED: every mandatory case was a genuine validated model answer. Evidence: ${path.relative(process.cwd(), file)}` : `NOT CERTIFIED: a mandatory case fell back, was rejected or did not run. Evidence: ${path.relative(process.cwd(), file)}`);
  if (!summary.certified || stopped) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(`AI smoke FAILED: ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown"}`);
  process.exit(1);
});
