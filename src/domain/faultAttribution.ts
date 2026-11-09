/**
 * Who a recorded disturbance is attributed to. Pure and deterministic. The attribution decides only whether a
 * SETTLEMENT_POLICY_V1 session may be auto-voided (OPERATOR only). It never changes physics or consent.
 *
 * Default when the operator supplies nothing (a documented table, see docs/ARCHITECTURE.md):
 *   EARLY_DEPARTURE            -> DRIVER
 *   SITE_CAP_REDUCTION         -> EXTERNAL (grid or utility limit)
 *   CHARGER_POWER_REDUCTION    -> UNKNOWN
 *   CHARGER_FAILURE            -> UNKNOWN
 * A supplied value is used as stated, so OPERATOR is the only way to record a confirmed operator cause.
 */
import type { DisturbanceType } from "./disturbance";

export const FAULT_ATTRIBUTIONS = ["OPERATOR", "DRIVER", "EXTERNAL", "UNKNOWN"] as const;
export type FaultAttribution = (typeof FAULT_ATTRIBUTIONS)[number];

/** Attributions a disturbance type may carry when supplied. Anything else is refused at recording time. */
const ALLOWED: Record<DisturbanceType, readonly FaultAttribution[]> = {
  EARLY_DEPARTURE: ["DRIVER", "UNKNOWN"],
  SITE_CAP_REDUCTION: ["OPERATOR", "EXTERNAL", "UNKNOWN"],
  CHARGER_POWER_REDUCTION: ["OPERATOR", "DRIVER", "EXTERNAL", "UNKNOWN"],
  CHARGER_FAILURE: ["OPERATOR", "DRIVER", "EXTERNAL", "UNKNOWN"],
};

const DEFAULT: Record<DisturbanceType, FaultAttribution> = {
  EARLY_DEPARTURE: "DRIVER",
  SITE_CAP_REDUCTION: "EXTERNAL",
  CHARGER_POWER_REDUCTION: "UNKNOWN",
  CHARGER_FAILURE: "UNKNOWN",
};

/** Attribution recorded for a disturbance: the supplied value when valid for its type, else the documented default. */
export function attributionFor(type: DisturbanceType, supplied?: FaultAttribution): FaultAttribution {
  return supplied ?? DEFAULT[type];
}

export function isAllowedAttribution(type: DisturbanceType, attribution: FaultAttribution): boolean {
  return ALLOWED[type].includes(attribution);
}

/** Most restrictive attribution across a session's disturbances: DRIVER, then UNKNOWN, then EXTERNAL, then OPERATOR. */
const RESTRICTIVENESS: readonly FaultAttribution[] = ["DRIVER", "UNKNOWN", "EXTERNAL", "OPERATOR"];

/** A session is OPERATOR-attributed only when every recorded disturbance is. No disturbance is UNKNOWN. */
export function sessionAttribution(attributions: readonly FaultAttribution[]): FaultAttribution {
  if (attributions.length === 0) return "UNKNOWN";
  return RESTRICTIVENESS.find((a) => attributions.includes(a)) ?? "UNKNOWN";
}
