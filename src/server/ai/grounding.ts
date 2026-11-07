/**
 * Hallucination guard for model text. Every number the model writes must already appear in
 * the backend-computed facts; claims of payment actions, payment outcomes, certainty, measured or
 * real-world benefits, and spelled-out amounts are rejected outright (the UI states those from data).
 */

const NUMBER = /\$?\d+(?:[.:]\d+)?/g;
/** Bare counts ("two offers", "1 hour") are allowed; nothing money- or energy-like. */
const FREE_INTEGERS = new Set(["0", "1", "2", "3"]);
const ACTION_CLAIMS = [
  /\b(?:i|we)\s*(?:have|'ve)?\s*(?:captured|charged|refunded|voided|authori[sz]ed|cancel(?:l)?ed|changed|updated|approved)\b/i,
  /\b(?:price|amount|terms?)\s+(?:has|have)\s+been\s+(?:changed|updated|reduced|lowered)\b/i,
  /\b(?:is|are|now)\s+free\b/i,
];

/** Claims no backend fact can support: the deterministic UI, not the model, reports these. */
const UNSUPPORTED_CLAIMS = [
  // Payment outcomes come only from provider-confirmed state.
  // Completed outcomes only: "you will be charged $X after delivery" restates the payment rule.
  /\byou\s+(?:have\s+(?:already\s+)?been|were|got)\s+refunded\b/i,
  /\b(?:payment|charge|capture|refund)\s+(?:is|was|has\s+been|will\s+be)\s+(?:guaranteed|refunded)\b/i,
  /\brefund\s+(?:is|was|has\s+been|will\s+be)\s+(?:complete[d]?|successful|confirmed|processed)\b/i,
  /\b(?:payment|charge|capture)\s+will\s+be\s+(?:complete[d]?|successful|confirmed|processed)\b/i,
  /\b(?:hold|funds?)\s+(?:is|was|has\s+been|have\s+been|were)\s+released\b/i,
  // Certainty about modeled outcomes.
  /\b(?:guarantee[sd]?|definitely|risk[- ]free|always\s+cheaper)\b/i,
  // Savings are modeled from synthetic tariffs, never measured.
  /\b(?:measured|proven|real[- ]world|actual(?:ly)?\s+sav(?:e|ed|ings))\b/i,
  /\b(?:carbon|emissions?|co2|greener|cleaner\s+energy|grid\s+(?:benefit|relief|stability))\b/i,
  // Amounts spelled out in words dodge the number check.
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|half|quarter)\s+(?:dollars?|cents?|percent|per\s*cent|kwh|kilowatt)/i,
];

/**
 * The backend's own disclosure ("savings are modeled, not measured") and plain negations ("not guaranteed") are the
 * opposite of the claims above. They are removed before the unsupported-claim check, so the model may repeat the
 * disclosure the prompt tells it to give. Affirmative claims ("measured savings", "guaranteed") are still rejected.
 */
const NEGATED_DISCLOSURE = /\b(?:not|isn't|aren't|never|no)\s+(?:been\s+)?(?:measured|proven|guaranteed|guarantee|real[- ]world)\b/gi;

/** Completed-capture claims: true only after a provider-confirmed capture, so allowed only then. */
const CAPTURE_COMPLETED_CLAIMS = [
  /\byou\s+(?:have\s+(?:already\s+)?been|were|got)\s+(?:charged|billed)\b/i,
  /\b(?:payment|charge|capture)\s+(?:is|was|has\s+been)\s+(?:complete[d]?|successful|confirmed|processed)\b/i,
  /\b(?:payment|charge|amount)\s+(?:is|was|has\s+(?:already\s+)?been)\s+(?:captured|collected)\b/i,
];

function normalize(token: string): string[] {
  const bare = token.replace(/^\$/, "");
  const out = [token, bare];
  // "07:00" ↔ "7:00" ↔ "7"
  const time = /^0?(\d{1,2}):(\d{2})$/.exec(bare);
  if (time) out.push(`${Number(time[1])}:${time[2]}`, String(Number(time[1])));
  // "30.00" ↔ "30"
  if (/^\d+\.0+$/.test(bare)) out.push(String(Number(bare)));
  return out;
}

export function allowedNumbers(facts: unknown): Set<string> {
  const allowed = new Set<string>();
  for (const token of JSON.stringify(facts).match(NUMBER) ?? []) for (const n of normalize(token)) allowed.add(n);
  return allowed;
}

export type GroundingIssue = { kind: "UNGROUNDED_NUMBER"; token: string } | { kind: "ACTION_CLAIM" } | { kind: "UNSUPPORTED_CLAIM" };

/** `captureConfirmed`: the backend holds a provider-confirmed capture for this reservation. */
export function checkGrounding(text: string, allowed: Set<string>, opts: { captureConfirmed?: boolean } = {}): GroundingIssue[] {
  const issues: GroundingIssue[] = [];
  for (const token of text.match(NUMBER) ?? []) {
    const bare = token.replace(/^\$/, "");
    if (!token.startsWith("$") && FREE_INTEGERS.has(bare)) continue;
    // Money must match a backend dollar figure exactly; other numbers may match in any normal form.
    const grounded = token.startsWith("$") ? allowed.has(token) : normalize(token).some((n) => allowed.has(n));
    if (!grounded) {
      issues.push({ kind: "UNGROUNDED_NUMBER", token });
    }
  }
  if (ACTION_CLAIMS.some((re) => re.test(text))) issues.push({ kind: "ACTION_CLAIM" });
  const claimText = text.replace(NEGATED_DISCLOSURE, " ");
  if (UNSUPPORTED_CLAIMS.some((re) => re.test(claimText))) issues.push({ kind: "UNSUPPORTED_CLAIM" });
  if (!opts.captureConfirmed && CAPTURE_COMPLETED_CLAIMS.some((re) => re.test(text))) issues.push({ kind: "UNSUPPORTED_CLAIM" });
  return issues;
}
