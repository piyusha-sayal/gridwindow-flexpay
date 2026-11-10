/**
 * Pure builder for the synthetic disturbance request the operator sends to POST /api/recovery/events.
 * It only shapes input for the server, which re-validates every field; no economics or capacity are decided here.
 */
import type { DisturbanceType } from "@/domain/disturbance";
import { FAULT_ATTRIBUTIONS, isAllowedAttribution, type FaultAttribution } from "@/domain/faultAttribution";

export interface InjectionDraft {
  type: DisturbanceType;
  reservationId: string;
  effectiveSlot: number;
  /** Watts for power and cap reductions; minutes early for EARLY_DEPARTURE; unused for CHARGER_FAILURE. */
  value: number;
  /** Optional: absent means DEFAULT_ATTRIBUTION (UNKNOWN). Never inferred from the type. */
  attribution?: FaultAttribution;
}

export interface InjectionRequest {
  eventId: string;
  reservationId: string;
  type: DisturbanceType;
  effectiveSlot: number;
  params: Record<string, number>;
  attribution: FaultAttribution;
}

export type InjectionResult = { ok: true; request: InjectionRequest } | { ok: false; message: string };

export interface AttributionChoice {
  value: FaultAttribution;
  allowed: boolean;
}

/** The operator's starting point. UNKNOWN is allowed for every disturbance type, and it never moves money. */
export const DEFAULT_ATTRIBUTION: FaultAttribution = "UNKNOWN";

const MS_PER_MINUTE = 60_000;

/** Every attribution in a fixed order, each marked allowed or not for this disturbance type. */
export function attributionChoices(type: DisturbanceType): AttributionChoice[] {
  return FAULT_ATTRIBUTIONS.map((value) => ({ value, allowed: isAllowedAttribution(type, value) }));
}

/** Keeps the operator's choice when the new type allows it; otherwise falls back to UNKNOWN. Never picks OPERATOR. */
export function nextAttribution(current: FaultAttribution, type: DisturbanceType): FaultAttribution {
  return isAllowedAttribution(type, current) ? current : DEFAULT_ATTRIBUTION;
}

/** Unique id matching the server's eventId rule (8 to 64 characters of letters, digits, '-' or '_'). */
export function newEventId(nowMs: number, random: () => number = Math.random): string {
  const suffix = Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0");
  return `syn-${nowMs.toString(36)}-${suffix}`;
}

function positiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** Maps the draft to params for one type. `departMs` is needed only for EARLY_DEPARTURE. */
export function buildInjection(draft: InjectionDraft, agreedDepartMs: number, eventId: string): InjectionResult {
  if (!Number.isInteger(draft.effectiveSlot) || draft.effectiveSlot < 0) return { ok: false, message: "Effective slot must be a whole number, 0 or more." };
  const attribution = draft.attribution ?? DEFAULT_ATTRIBUTION;
  if (!isAllowedAttribution(draft.type, attribution)) return { ok: false, message: `${attribution} cannot be recorded for this disturbance type.` };
  const base = { eventId, reservationId: draft.reservationId, type: draft.type, effectiveSlot: draft.effectiveSlot, attribution };
  switch (draft.type) {
    case "CHARGER_POWER_REDUCTION":
      if (!positiveInt(draft.value)) return { ok: false, message: "Maximum port power must be a whole number of watts above 0." };
      return { ok: true, request: { ...base, params: { maxPowerW: draft.value } } };
    case "SITE_CAP_REDUCTION":
      if (!positiveInt(draft.value)) return { ok: false, message: "Station cap must be a whole number of watts above 0." };
      return { ok: true, request: { ...base, params: { stationCapW: draft.value } } };
    case "EARLY_DEPARTURE":
      if (!positiveInt(draft.value)) return { ok: false, message: "Minutes early must be a whole number above 0." };
      return { ok: true, request: { ...base, params: { departMs: agreedDepartMs - draft.value * MS_PER_MINUTE } } };
    case "CHARGER_FAILURE":
      return { ok: true, request: { ...base, params: {} } };
  }
}
