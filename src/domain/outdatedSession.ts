/**
 * Settlement decision for an authorized session whose agreed schedule a disturbance has made invalid.
 * Pure: the caller supplies the recovery state, the clock and the delivered energy from the snapshot.
 * Legacy agreements: a permanently infeasible session with zero delivered energy is voided, and everything else with
 * delivered energy goes to operator resolution. Agreements under SETTLEMENT_POLICY_V1 use settlementAction instead.
 * Nothing is ever captured from an invalid plan.
 */

import type { FaultAttribution } from "./faultAttribution";
import type { SettlementPolicy } from "./terms";

/** Recovery run statuses as this decision needs them (structurally the orchestrator's RunStatus). */
export type RecoveryStatus = "RUNNING" | "COMMITTED" | "NEEDS_APPROVAL" | "INFEASIBLE" | "FAILED" | "APPROVED" | "REJECTED" | "EXPIRED";

export const OUTDATED_CLASSES = ["RECOVERY_PENDING", "AWAITING_DRIVER_APPROVAL", "RECOVERABLE_DELAY", "PERMANENTLY_INFEASIBLE"] as const;
export type OutdatedClass = (typeof OUTDATED_CLASSES)[number];

/** After this long past the effective departure, an unresolved outdated session is escalated. */
export const RESOLUTION_GRACE_MS = 60 * 60_000;
/** Inside this window before the authorization expires, a delay is no longer recoverable without new buyer consent. */
export const AUTHORIZATION_MARGIN_MS = 24 * 60 * 60_000;

export interface OutdatedInput {
  runStatus: RecoveryStatus | null;
  /** A NEEDS_APPROVAL proposal past its expiry (the sweep may not have recorded it yet). */
  proposalExpired: boolean;
  attempts: number;
  maxAttempts: number;
  authorizationNearExpiry: boolean;
}

export function classifyOutdatedSession(input: OutdatedInput): OutdatedClass {
  switch (input.runStatus) {
    case "RUNNING":
      return "RECOVERY_PENDING";
    case "NEEDS_APPROVAL":
      return input.proposalExpired ? "PERMANENTLY_INFEASIBLE" : "AWAITING_DRIVER_APPROVAL";
    case "INFEASIBLE":
    case "REJECTED":
    case "EXPIRED":
      return "PERMANENTLY_INFEASIBLE";
    case "FAILED":
      return input.attempts < input.maxAttempts ? "RECOVERABLE_DELAY" : "PERMANENTLY_INFEASIBLE";
    default:
      // No run yet, or a version that a later disturbance outdated.
      return input.authorizationNearExpiry ? "PERMANENTLY_INFEASIBLE" : "RECOVERABLE_DELAY";
  }
}

/** True once the session can no longer be honored: past the effective departure plus grace, or near authorization expiry. */
export function resolutionDue(input: { nowMs: number; effectiveDepartMs: number; authorizationExpiresAtMs: number | null }): boolean {
  if (input.nowMs >= input.effectiveDepartMs + RESOLUTION_GRACE_MS) return true;
  return authorizationNearExpiry(input.nowMs, input.authorizationExpiresAtMs);
}

export function authorizationNearExpiry(nowMs: number, authorizationExpiresAtMs: number | null): boolean {
  return authorizationExpiresAtMs !== null && nowMs >= authorizationExpiresAtMs - AUTHORIZATION_MARGIN_MS;
}

export type OutdatedAction = "WAIT" | "VOID" | "OPERATOR_RESOLUTION";

/**
 * WAIT while recovery is live, or while a recoverable delay is not yet due. Otherwise zero delivered energy voids
 * (no service was rendered, so no charge) and any delivered energy goes to operator resolution (no partial capture).
 */
export function outdatedAction(cls: OutdatedClass, due: boolean, deliveredMilliWh: number): OutdatedAction {
  if (cls === "RECOVERY_PENDING") return "WAIT";
  if (cls !== "PERMANENTLY_INFEASIBLE" && !due) return "WAIT";
  return deliveredMilliWh > 0 ? "OPERATOR_RESOLUTION" : "VOID";
}

/** Time an operator has to decide a non-conclusive outcome before it is marked overdue (no money moves either way). */
export const OPERATOR_RESOLUTION_WINDOW_MS = 24 * 60 * 60_000;

export type ResolutionBasis =
  | "LEGACY_POLICY"
  | "DRIVER_REQUESTED_DEPARTURE"
  | "DRIVER_ATTRIBUTED"
  | "EXTERNAL_ATTRIBUTED"
  | "ATTRIBUTION_UNKNOWN"
  | "OPERATOR_FAILURE_NOT_CONFIRMED"
  | "AMBIGUOUS_RECOVERY"
  | "UNVERIFIED_DELIVERY";

export interface SettlementInput {
  policy: SettlementPolicy;
  runStatus: RecoveryStatus | null;
  proposalExpired: boolean;
  attempts: number;
  maxAttempts: number;
  authorizationNearExpiry: boolean;
  /** Any driver-requested early departure recorded against this reservation. */
  driverRequestedDeparture: boolean;
  /** Session-level attribution (see sessionAttribution). Read only under SETTLEMENT_POLICY_V1. */
  attribution: FaultAttribution;
  due: boolean;
  deliveredMilliWh: number;
}

/**
 * An operator failure is conclusive only when the recovery engine itself concluded it: no feasible recovery,
 * or recovery failed on every attempt. A driver's rejection, an expired proposal or a missing run is not conclusive.
 */
export function operatorFailureConfirmed(runStatus: RecoveryStatus | null, attempts: number, maxAttempts: number): boolean {
  return runStatus === "INFEASIBLE" || (runStatus === "FAILED" && attempts >= maxAttempts);
}

function classifyFor(input: SettlementInput): OutdatedClass {
  return classifyOutdatedSession({
    runStatus: input.runStatus,
    proposalExpired: input.proposalExpired,
    attempts: input.attempts,
    maxAttempts: input.maxAttempts,
    authorizationNearExpiry: input.authorizationNearExpiry,
  });
}

/**
 * Settlement action for an outdated session under its agreement's policy. Legacy agreements use the original rules.
 * Under SETTLEMENT_POLICY_V1 a full void requires a CONFIRMED operator failure (attribution OPERATOR plus a conclusive
 * recovery outcome). UNKNOWN, EXTERNAL and DRIVER attributions never void and never capture. Nothing is captured here.
 */
export function settlementAction(input: SettlementInput): OutdatedAction {
  if (input.policy === "LEGACY") return outdatedAction(classifyFor(input), input.due, input.deliveredMilliWh);
  switch (classifyFor(input)) {
    case "RECOVERY_PENDING":
    case "AWAITING_DRIVER_APPROVAL":
      return "WAIT";
    case "RECOVERABLE_DELAY":
      return input.due ? "OPERATOR_RESOLUTION" : "WAIT";
    case "PERMANENTLY_INFEASIBLE":
      return canAutoVoid(input) ? "VOID" : "OPERATOR_RESOLUTION";
  }
}

/** A full void under V1 needs a driver-free, confirmed operator failure. Every other case goes to the operator. */
function canAutoVoid(input: SettlementInput): boolean {
  return (
    !input.driverRequestedDeparture && input.attribution === "OPERATOR" && operatorFailureConfirmed(input.runStatus, input.attempts, input.maxAttempts)
  );
}

/** Why an outcome went to the operator rather than being settled automatically. */
export function resolutionBasis(input: SettlementInput): ResolutionBasis {
  if (input.policy === "LEGACY") return "LEGACY_POLICY";
  if (input.driverRequestedDeparture) return "DRIVER_REQUESTED_DEPARTURE";
  if (input.attribution === "DRIVER") return "DRIVER_ATTRIBUTED";
  if (input.attribution === "EXTERNAL") return "EXTERNAL_ATTRIBUTED";
  if (input.attribution === "UNKNOWN") return "ATTRIBUTION_UNKNOWN";
  return classifyFor(input) === "PERMANENTLY_INFEASIBLE" ? "OPERATOR_FAILURE_NOT_CONFIRMED" : "AMBIGUOUS_RECOVERY";
}
