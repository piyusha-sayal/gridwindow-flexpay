/** Picks the configured model provider. The assistant and agent only ever see the StructuredLlm interface. */
import { FailoverLlm } from "./failoverLlm";
import { GeminiLlm } from "./geminiLlm";
import { AnthropicLlm, type StructuredLlm } from "./llm";
import { OpenRouterLlm } from "./openRouterLlm";

export type AiProvider = "gemini" | "anthropic";

export interface AiEnv {
  AI_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  /** Optional second Gemini model on the same key, tried once when the primary is rate-limited or unavailable. */
  GEMINI_FALLBACK_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
  AI_FALLBACK_PROVIDER?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
}

/** Per-attempt timeout of the primary when a fallback exists, so a failing primary does not hold the user for its full default. */
export const PRIMARY_TIMEOUT_WITH_FALLBACK_MS = 8_000;

/** A key counts only when it holds a non-blank value. */
const hasKey = (v: string | undefined): v is string => typeof v === "string" && v.trim() !== "";

/** An explicit AI_PROVIDER wins; otherwise Gemini when its key is set, else Anthropic when its key is set. */
export function selectProvider(env: AiEnv): AiProvider | null {
  if (env.AI_PROVIDER === "gemini") return hasKey(env.GEMINI_API_KEY) ? "gemini" : null;
  if (env.AI_PROVIDER === "anthropic") return hasKey(env.ANTHROPIC_API_KEY) ? "anthropic" : null;
  if (hasKey(env.GEMINI_API_KEY)) return "gemini";
  return hasKey(env.ANTHROPIC_API_KEY) ? "anthropic" : null;
}

/** The fallback is on only when explicitly requested AND its key is present; otherwise behaviour is unchanged. */
export function fallbackConfigured(env: AiEnv): boolean {
  return env.AI_FALLBACK_PROVIDER === "openrouter" && hasKey(env.OPENROUTER_API_KEY);
}

/**
 * A second Gemini model is used only with Gemini as the provider, a key, and a different model id.
 * Free-tier Gemini quotas are per model, so this doubles the free capacity without a second account.
 */
export function geminiFallbackModel(env: AiEnv): string | null {
  const m = env.GEMINI_FALLBACK_MODEL?.trim();
  if (!m || selectProvider(env) !== "gemini") return null;
  return m === (env.GEMINI_MODEL?.trim() || undefined) ? null : m;
}

/**
 * Null when no usable credentials exist; the assistant then runs its labeled deterministic fallback.
 * Order of providers, each asked at most once per call: the primary, then the second Gemini model (if configured), then
 * OpenRouter (if opted in with a key). Both backups are optional and independent.
 */
export function createLlm(env: AiEnv): { llm: StructuredLlm; provider: AiProvider } | null {
  const provider = selectProvider(env);
  if (!provider) return null;
  const geminiSecond = geminiFallbackModel(env);
  const openRouter = fallbackConfigured(env) ? new OpenRouterLlm(env.OPENROUTER_API_KEY!, env.OPENROUTER_MODEL) : null;
  const withFallback = openRouter !== null || geminiSecond !== null;
  const timeoutMs = withFallback ? PRIMARY_TIMEOUT_WITH_FALLBACK_MS : undefined;
  const primary: StructuredLlm =
    provider === "gemini" ? new GeminiLlm(env.GEMINI_API_KEY!, env.GEMINI_MODEL, timeoutMs ? { timeoutMs } : {}) : new AnthropicLlm(env.ANTHROPIC_API_KEY!, env.AI_MODEL, timeoutMs ? { timeoutMs } : {});
  if (!withFallback) return { llm: primary, provider };
  // With OpenRouter behind it, the second Gemini model gets the same short per-attempt timeout as the primary, so the
  // overall failover budget still leaves room for the last hop.
  const second = geminiSecond ? new GeminiLlm(env.GEMINI_API_KEY!, geminiSecond, openRouter ? { timeoutMs: PRIMARY_TIMEOUT_WITH_FALLBACK_MS } : {}) : null;
  const tail: StructuredLlm = second && openRouter ? new FailoverLlm(second, openRouter) : (second ?? openRouter)!;
  return { llm: new FailoverLlm(primary, tail), provider };
}
