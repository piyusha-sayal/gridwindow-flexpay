/**
 * Consent boundary for a proposed schedule version. Pure and deterministic.
 * AUTO_COMMIT only when the agreed commitments hold and nothing material moved.
 * NEEDS_DRIVER_APPROVAL for material but permitted changes. NOT_ALLOWED for anything the agreed terms forbid.
 */

export type ConsentDecision =
  | { decision: "AUTO_COMMIT"; reasons: [] }
  | { decision: "NEEDS_DRIVER_APPROVAL"; reasons: string[] }
  | { decision: "NOT_ALLOWED"; reasons: string[] };

export interface ConsentInput {
  /**
   * The FORECAST plan reaches the agreed battery energy. A planned figure, not proof of delivery: actual delivery
   * is only known from the synthetic ledger after charging.
   */
  forecastEnergyMet: boolean;
  agreedAmountCents: number;
  proposedAmountCents: number;
  agreedDepartMs: number;
  proposedDepartMs: number;
  /** End of charging in the agreed schedule. */
  agreedReadyByMs: number;
  proposedFinishMs: number;
  /** All charging falls inside the original plugged-in window. */
  withinPluggedWindow: boolean;
  /** Energy scheduled before the effective slot is unchanged. */
  pastUnchanged: boolean;
  /** Another session's schedule would change. Recovery never does this; the input makes the rule explicit. */
  otherSessionsChanged: boolean;
}

export function decideConsent(input: ConsentInput): ConsentDecision {
  const hardViolations: string[] = [];
  if (!input.forecastEnergyMet) hardViolations.push("forecast energy would not reach the agreed battery target");
  if (input.proposedAmountCents > input.agreedAmountCents) hardViolations.push("price would increase");
  if (input.proposedDepartMs > input.agreedDepartMs) hardViolations.push("departure would move later than the agreed departure");
  if (!input.withinPluggedWindow) hardViolations.push("charging would fall outside the agreed plugged-in window");
  if (!input.pastUnchanged) hardViolations.push("energy already scheduled would change");
  if (input.otherSessionsChanged) hardViolations.push("another session's schedule would change");
  if (hardViolations.length > 0) return { decision: "NOT_ALLOWED", reasons: hardViolations };

  const approvalReasons: string[] = [];
  if (input.proposedAmountCents !== input.agreedAmountCents) approvalReasons.push("price would change");
  if (input.proposedDepartMs < input.agreedDepartMs) approvalReasons.push("departure would be earlier than agreed");
  if (input.proposedFinishMs > input.agreedReadyByMs) approvalReasons.push("charging would finish later than the agreed ready-by time");
  if (approvalReasons.length > 0) return { decision: "NEEDS_DRIVER_APPROVAL", reasons: approvalReasons };

  return { decision: "AUTO_COMMIT", reasons: [] };
}
