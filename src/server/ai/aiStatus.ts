/** Operator-facing AI status. Sanitized: provider and model names and a state word only; never keys, prompts or model text. */
import type { StructuredLlm } from "./llm";

export interface AiStatus {
  state: "NOT_CONFIGURED" | "CONFIGURED" | "IDLE" | "OK" | "DEGRADED" | "DOWN";
  label: string;
}

export function aiStatusOf(llm: StructuredLlm | null | undefined): AiStatus {
  if (!llm) return { state: "NOT_CONFIGURED", label: "AI off: labelled deterministic explanations" };
  const health = llm.health?.();
  if (!health) return { state: "CONFIGURED", label: `AI ${llm.model}, no fallback model` };
  switch (health.state) {
    case "OK":
      return { state: "OK", label: `AI ok: ${health.primary.model}` };
    case "DEGRADED":
      return { state: "DEGRADED", label: `AI degraded: fallback ${health.fallback?.model ?? "model"} is answering` };
    case "DOWN":
      return { state: "DOWN", label: "AI unavailable: labelled deterministic explanations" };
    default:
      return { state: "IDLE", label: `AI ready: ${health.primary.model} with fallback ${health.fallback?.model ?? "none"}` };
  }
}
