/** Picks the configured model provider. The assistant and agent only ever see the StructuredLlm interface. */
import { GeminiLlm } from "./geminiLlm";
import { AnthropicLlm, type StructuredLlm } from "./llm";

export type AiProvider = "gemini" | "anthropic";

export interface AiEnv {
  AI_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
}

/** An explicit AI_PROVIDER wins; otherwise Gemini when its key is set, else Anthropic when its key is set. */
export function selectProvider(env: AiEnv): AiProvider | null {
  if (env.AI_PROVIDER === "gemini") return env.GEMINI_API_KEY ? "gemini" : null;
  if (env.AI_PROVIDER === "anthropic") return env.ANTHROPIC_API_KEY ? "anthropic" : null;
  if (env.GEMINI_API_KEY) return "gemini";
  return env.ANTHROPIC_API_KEY ? "anthropic" : null;
}

/** Null when no usable credentials exist; the assistant then runs its labeled deterministic fallback. */
export function createLlm(env: AiEnv): { llm: StructuredLlm; provider: AiProvider } | null {
  const provider = selectProvider(env);
  if (provider === "gemini") return { llm: new GeminiLlm(env.GEMINI_API_KEY!, env.GEMINI_MODEL), provider };
  if (provider === "anthropic") return { llm: new AnthropicLlm(env.ANTHROPIC_API_KEY!, env.AI_MODEL), provider };
  return null;
}
