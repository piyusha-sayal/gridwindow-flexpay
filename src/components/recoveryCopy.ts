/** Plain-English labels for recovery (disturbance and run) states, shared by the operator and driver screens. */
import type { DisturbanceType } from "@/domain/disturbance";
import type { FaultAttribution } from "@/domain/faultAttribution";
import type { RunStatus } from "@/server/services/recoveryRuns";

export const DISTURBANCE_LABEL: Record<DisturbanceType, string> = {
  CHARGER_POWER_REDUCTION: "Charger power reduced",
  SITE_CAP_REDUCTION: "Site capacity reduced",
  EARLY_DEPARTURE: "Early departure",
  CHARGER_FAILURE: "Charger failure",
};

export const ATTRIBUTION_LABEL: Record<FaultAttribution, string> = {
  OPERATOR: "Confirmed station operator cause",
  DRIVER: "Caused by the driver's request",
  EXTERNAL: "External cause (grid or utility limit)",
  UNKNOWN: "Cause not yet confirmed",
};

/** Shortfalls are small (a few Wh), so they are shown in Wh to one decimal, never rounded to 0.00 kWh. */
export function formatShortfallWh(shortfallMilliWh: number): string {
  return `${(shortfallMilliWh / 1000).toFixed(1)} Wh`;
}

/** Plain-English note for a planned figure. Forecasts are never presented as delivered energy. */
export const FORECAST_NOTE = "Planned from the forecast. Actual delivery is only known after charging.";

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  RUNNING: "Recovery running",
  COMMITTED: "Recovered automatically",
  NEEDS_APPROVAL: "Waiting for your approval",
  INFEASIBLE: "No feasible recovery",
  FAILED: "Recovery failed",
  APPROVED: "Approved by driver",
  REJECTED: "Declined by driver",
  EXPIRED: "Proposal expired",
};

/** Run states that still need a decision from the driver. */
export const PENDING_RUN_STATUSES = new Set<RunStatus>(["NEEDS_APPROVAL"]);

/** Human text for the approval and rejection error codes returned by the server. */
export const RECOVERY_ERROR_COPY: Record<string, string> = {
  PROPOSAL_EXPIRED: "This proposal has expired, so it was not applied. Your original schedule still stands. Ask the operator to request a new recovery.",
  VERSION_CONFLICT: "The schedule changed while this proposal was pending, so it was not applied. Refresh to see the current schedule.",
  STALE_PROPOSAL: "A newer disturbance changed this schedule after this proposal was made, so it was not applied. Your schedule was left as it is. Ask the operator to request a new recovery if needed.",
  NOT_PENDING: "This proposal is no longer awaiting your decision. Refresh to see its current status.",
  NOT_FOUND: "This recovery is not available for this session.",
  PLAN_INVALID: "The proposed schedule no longer fits station limits, so it was not applied. Your original schedule still stands.",
  RUN_NOT_OPEN: "This recovery is no longer open. Refresh to see its current status.",
};

export function describeRecoveryError(code: string, fallback: string): string {
  return RECOVERY_ERROR_COPY[code] ?? fallback;
}
