/**
 * Pure builder for the synthetic disturbance request the operator sends to POST /api/recovery/events.
 * It only shapes input for the server, which re-validates every field; no economics or capacity are decided here.
 */
import type { DisturbanceType } from "@/domain/disturbance";

export interface InjectionDraft {
  type: DisturbanceType;
  reservationId: string;
  effectiveSlot: number;
  /** Watts for power and cap reductions; minutes early for EARLY_DEPARTURE; unused for CHARGER_FAILURE. */
  value: number;
}

export interface InjectionRequest {
  eventId: string;
  reservationId: string;
  type: DisturbanceType;
  effectiveSlot: number;
  params: Record<string, number>;
}

export type InjectionResult = { ok: true; request: InjectionRequest } | { ok: false; message: string };

const MS_PER_MINUTE = 60_000;

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
  const base = { eventId, reservationId: draft.reservationId, type: draft.type, effectiveSlot: draft.effectiveSlot };
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
