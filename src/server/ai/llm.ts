/**
 * Narrow model boundary. The assistant only ever asks for one schema-validated JSON object
 * and receives text-only output: no tools, no payment capability, no state access.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/**
 * Why no model output was used. Every failure leads to the same deterministic fallback; the
 * distinction exists for diagnostics and the UI label only.
 */
export type LlmFailure =
  | "NOT_CONFIGURED"
  | "UNAVAILABLE" // provider error response or network failure
  | "TIMEOUT" // no response within the client timeout
  | "REFUSED" // the model explicitly declined (stop_reason "refusal")
  | "INVALID_OUTPUT" // missing, truncated or non-JSON output
  | "SCHEMA_MISMATCH" // well-formed JSON that fails the expected schema
  | "AUTH_FAILED" // HTTP 401/403: bad key, missing permission or API not enabled for the project
  | "QUOTA_EXHAUSTED" // HTTP 429: rate limit or free-tier quota (including a model with a zero free quota)
  | "REQUEST_REJECTED"; // HTTP 400/404/422: invalid request, unsupported schema or model not found for this project

/**
 * Sanitized facts about a failed provider call. Never contains keys, prompts, model text or raw provider messages:
 * only an error class name, an HTTP status and the provider's enum-like status word (e.g. RESOURCE_EXHAUSTED).
 */
export interface LlmDiagnostic {
  category: LlmFailure | "NETWORK" | "CLIENT_ERROR";
  errorName?: string;
  httpStatus?: number;
  providerStatus?: string;
  requestId?: string;
}

/** Maps an HTTP status to the failure it means. Only server errors and unknown statuses are "unavailable". */
export function classifyHttpStatus(status: number | undefined): LlmFailure {
  if (status === 401 || status === 403) return "AUTH_FAILED";
  if (status === 429) return "QUOTA_EXHAUSTED";
  if (status === 400 || status === 404 || status === 422) return "REQUEST_REJECTED";
  return "UNAVAILABLE";
}

/** Extracts only an UPPER_SNAKE status word such as RESOURCE_EXHAUSTED from a provider error message. */
export function providerStatusWord(message: string): string | undefined {
  return /"status"\s*:\s*"([A-Z_]{3,40})"/.exec(message)?.[1];
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/** `usage` is present whenever the provider returned a response (billed tokens), even if it was rejected. */
export type LlmResult<T> = { ok: true; value: T; model: string; /** Adapter that actually answered; set by the failover wrapper. */ provider?: ModelProvider; usage?: LlmUsage } | { ok: false; reason: LlmFailure; usage?: LlmUsage; diagnostic?: LlmDiagnostic };

/** Which adapter answered. Recorded on every recovery run so a test fixture can never be shown as a live model. */
export type ModelProvider = "gemini" | "anthropic" | "openrouter" | "test-fixture";

/** One sanitized provider attempt: no prompt, no model text, no key, no raw provider message. */
export interface AiAttempt {
  at: number;
  provider: ModelProvider;
  model: string;
  outcome: "OK" | LlmFailure;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** Operator-facing summary of recent provider attempts. */
export interface AiHealth {
  /** OK: primary answered last. DEGRADED: the fallback answered last. DOWN: the last attempt failed everywhere. IDLE: no attempt yet. */
  state: "OK" | "DEGRADED" | "DOWN" | "IDLE";
  primary: { provider: ModelProvider; model: string };
  fallback: { provider: ModelProvider; model: string } | null;
  recent: AiAttempt[];
}

/**
 * A shared cap on provider requests for one unit of work (one recovery run). The caller takes one request before each
 * generate call; a failover wrapper takes one more before it asks its second provider. take() never blocks.
 */
export interface RequestBudget {
  take(): boolean;
  readonly used: number;
  readonly limit: number;
}

export class ModelRequestBudget implements RequestBudget {
  private count: number;
  constructor(
    readonly limit: number,
    used = 0,
  ) {
    this.count = Math.min(used, limit);
  }
  get used(): number {
    return this.count;
  }
  take(): boolean {
    if (this.count >= this.limit) return false;
    this.count += 1;
    return true;
  }
}

export interface StructuredLlm {
  readonly provider: ModelProvider;
  readonly model: string;
  /** Present only on wrappers that track provider attempts. */
  health?(): AiHealth;
  generate<S extends z.ZodType>(req: { system: string; user: string; schema: S; maxTokens: number; requestBudget?: RequestBudget }): Promise<LlmResult<z.infer<S>>>;
}

export const DEFAULT_AI_MODEL = "claude-opus-5-5";
const TIMEOUT_MS = 20_000;

export class AnthropicLlm implements StructuredLlm {
  readonly provider: ModelProvider = "anthropic";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string = DEFAULT_AI_MODEL,
    transport: { fetch?: typeof fetch; timeoutMs?: number; maxRetries?: number } = {},
  ) {
    this.client = new Anthropic({ apiKey, timeout: transport.timeoutMs ?? TIMEOUT_MS, maxRetries: transport.maxRetries ?? 1, fetch: transport.fetch });
  }

  async generate<S extends z.ZodType>(req: { system: string; user: string; schema: S; maxTokens: number }): Promise<LlmResult<z.infer<S>>> {
    let res;
    try {
      // create, not parse: the stop reason must be read before any output is interpreted, so a
      // refusal is reported as a refusal rather than as unparseable output.
      res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(req.schema) },
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      });
    } catch (err) {
      const status = err instanceof Anthropic.APIError ? err.status : undefined;
      const reason: LlmFailure = err instanceof Anthropic.APIConnectionTimeoutError ? "TIMEOUT" : classifyHttpStatus(status);
      console.warn(`[gridwindow] model call failed: ${reason} ${status ?? "network"}`);
      return { ok: false, reason, diagnostic: { category: reason, errorName: err instanceof Error ? err.name : "UNKNOWN", ...(status ? { httpStatus: status } : {}) } };
    }
    const usage: LlmUsage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    if (res.stop_reason === "refusal") return { ok: false, reason: "REFUSED", usage };
    return { ...parseStructured(res, req.schema), usage };
  }
}

/** Interprets a completed response; truncated or non-JSON text is INVALID_OUTPUT, never repaired. */
function parseStructured<S extends z.ZodType>(res: { stop_reason: string | null; model: string; content: { type: string }[] }, schema: S): LlmResult<z.infer<S>> {
  const text = res.content.flatMap((b) => (b.type === "text" ? [(b as unknown as { text: string }).text] : [])).join("");
  if (res.stop_reason !== "end_turn" || !text) return { ok: false, reason: "INVALID_OUTPUT" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "INVALID_OUTPUT" };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data, model: res.model } : { ok: false, reason: "SCHEMA_MISMATCH" };
}
