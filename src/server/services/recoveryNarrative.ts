/**
 * Plain-English narrative for a recovery outcome. Facts are backend-computed; model text is accepted only when
 * every figure it states is one of these facts and it makes no payment or savings claim.
 */
import { allowedNumbers, checkGrounding, type GroundingIssue } from "@/server/ai/grounding";

export type NarrativeKind = "COMMITTED" | "NEEDS_APPROVAL" | "INFEASIBLE";

/** Only display strings computed by the backend. No identifiers, no provider data. */
export type NarrativeFacts = Record<string, string>;

export function checkExplanation(text: string, facts: NarrativeFacts): GroundingIssue[] {
  return checkGrounding(text, allowedNumbers(facts));
}

/** Deterministic narrative; used when no model is configured, when the model fails, or when its text is rejected. */
export function deterministicExplanation(kind: NarrativeKind, facts: NarrativeFacts, detail = ""): string {
  const head = `${facts.eventLabel} at ${facts.effectiveAt} on charger ${facts.chargerLabel}.`;
  if (kind === "COMMITTED") {
    return `${head} Recovery re-planned the charging from that time. The agreed price of ${facts.price} is unchanged, and the new schedule stays within the terms you accepted.`;
  }
  if (kind === "NEEDS_APPROVAL") {
    return `${head} The fix moves your departure or finish time, so it needs your approval. Nothing changes until you approve it. The agreed price of ${facts.price} is unchanged.`;
  }
  return `${head} ${detail} The schedule is unchanged, and your agreed terms still apply.`;
}
