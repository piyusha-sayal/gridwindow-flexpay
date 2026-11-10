/**
 * Provenance labels for one recovery run. Derived only from the persisted run record (aiUsed) and its trace, never from
 * configuration or environment, so a fallback is never presented as a live model decision. Pure: safe in the browser.
 */
import type { ModelProvider } from "@/server/ai/llm";
import type { RunTraceEntry } from "./recoveryRuns";

/** Trace detail the orchestrator writes when it skips the model for a step; the text after the prefix is the reason. */
export const MODEL_SKIP_PREFIX = "model not used for this step: ";
/** Trace detail the orchestrator writes when no model is configured. */
export const NO_MODEL_DETAIL = "no model configured; deterministic path";

/** Tools whose successful model call means the model chose the outcome of the run. */
const DECISION_TOOLS = new Set(["proposeRecovery", "commitPermittedRecovery", "requestDriverApproval"]);

const MODEL_NAME: Record<ModelProvider, string> = {
  gemini: "Gemini (live model)",
  anthropic: "Anthropic (live model)",
  openrouter: "OpenRouter fallback model (live model)",
  "test-fixture": "MOCK MODEL (test fixture)",
};

export const SIMULATED_EVENT_LABEL = "SIMULATED_EVENT";

export interface RunProvenance {
  /** MODEL_DECISION only when a model made the chosen step through the tools; otherwise DETERMINISTIC_FALLBACK. */
  decision: "MODEL_DECISION" | "DETERMINISTIC_FALLBACK";
  /** Named model that decided, or "model provider not recorded" for runs stored before provider tracking. Null on fallback. */
  modelLabel: string | null;
  /** Short label for badges, e.g. "MODEL_DECISION · Gemini (live model)". */
  decisionLabel: string;
  /** Plain-English reason. */
  reason: string;
}

/**
 * The model provider the orchestrator recorded last: at start, and again whenever a failover wrapper answered with a
 * different provider, so the label names the provider that actually produced the decision.
 */
export function recordedModelProvider(trace: readonly RunTraceEntry[]): ModelProvider | null {
  let recorded: ModelProvider | null = null;
  for (const entry of trace) {
    const input = entry.input;
    if (entry.tool !== "orchestrator" || typeof input !== "object" || input === null || !("modelProvider" in input)) continue;
    const value = input.modelProvider;
    if (typeof value === "string" && value in MODEL_NAME) recorded = value as ModelProvider;
  }
  return recorded;
}

function fallbackReason(trace: readonly RunTraceEntry[]): string {
  if (trace.some((e) => e.actor === "GEMINI" && e.outcome === "REJECTED")) {
    return "The model output was rejected by the validators, so the deterministic path decided.";
  }
  const skipped = trace.find((e) => e.tool === "orchestrator" && e.detail.startsWith(MODEL_SKIP_PREFIX));
  if (skipped) return `The model was not used (${skipped.detail.slice(MODEL_SKIP_PREFIX.length)}), so the deterministic path decided.`;
  if (trace.some((e) => e.tool === "orchestrator" && e.detail === NO_MODEL_DETAIL)) return "No model was configured, so the deterministic path decided.";
  return "The model did not choose a recovery step, so the deterministic path decided.";
}

export function runProvenance(run: { aiUsed: boolean; trace: readonly RunTraceEntry[] }): RunProvenance {
  const modelDecided = run.aiUsed && run.trace.some((e) => e.actor === "GEMINI" && e.outcome === "OK" && DECISION_TOOLS.has(e.tool));
  if (!modelDecided) {
    return {
      decision: "DETERMINISTIC_FALLBACK",
      modelLabel: null,
      decisionLabel: "DETERMINISTIC_FALLBACK · no model decision",
      reason: fallbackReason(run.trace),
    };
  }
  const provider = recordedModelProvider(run.trace);
  const modelLabel = provider ? MODEL_NAME[provider] : "model provider not recorded";
  return {
    decision: "MODEL_DECISION",
    modelLabel,
    decisionLabel: `MODEL_DECISION · ${modelLabel}`,
    reason: "A model chose the recovery step through the validated tools.",
  };
}
