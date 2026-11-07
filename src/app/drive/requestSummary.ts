/**
 * Live, display-only summary of the driver's request (step 1 aside and parked-window strip).
 * It never gates a request: the server re-validates and decides feasibility, prices and offers.
 */
import { requiredGridWh } from "@/domain/units";
import { HERO_EFFICIENCY_BP } from "../heroSchedule";
import type { FormState } from "./driverTypes";

/** The night axis shared with the offers view: 18:00 → 10:00 local, 15-minute slots. */
export const AXIS_START_MIN = 18 * 60;
export const AXIS_MINUTES = 16 * 60;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutes after 18:00 on the night axis; like the server, times before 12:00 are the next morning. */
export function axisMinutes(hhmm: string): number | null {
  if (!HHMM.test(hhmm)) return null;
  const m = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  return (m >= 12 * 60 ? m : m + 24 * 60) - AXIS_START_MIN;
}

export function formatDuration(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export interface RequestSummary {
  plugInMin: number;
  departMin: number;
  parkedMin: number;
  /** Full-power charging time at the selected port, including the assumed charging efficiency. */
  chargeMin: number;
  portKw: number;
}

export function summarizeRequest(form: Pick<FormState, "plugInLocal" | "departLocal" | "targetBatteryKWh">, portMaxPowerW: number): RequestSummary | null {
  const plugInMin = axisMinutes(form.plugInLocal);
  const departMin = axisMinutes(form.departLocal);
  const kwh = Number(form.targetBatteryKWh);
  if (plugInMin === null || departMin === null || departMin <= plugInMin) return null;
  if (!form.targetBatteryKWh.trim() || !Number.isFinite(kwh) || kwh <= 0 || portMaxPowerW <= 0) return null;
  const gridWh = requiredGridWh(Math.round(kwh * 1000), HERO_EFFICIENCY_BP);
  return {
    plugInMin,
    departMin,
    parkedMin: departMin - plugInMin,
    chargeMin: Math.ceil((gridWh / portMaxPowerW) * 60),
    portKw: portMaxPowerW / 1000,
  };
}

/** One plain sentence explaining how much room there is to find cheaper hours. */
export function summarySentence(s: RequestSummary): string {
  const parked = formatDuration(s.parkedMin);
  const charge = formatDuration(s.chargeMin);
  if (s.chargeMin > s.parkedMin) {
    return `You're parked ${parked} but need about ${charge} of charging at ${s.portKw} kW. Leave later, plug in earlier or ask for less energy.`;
  }
  return `You're parked ${parked} and need about ${charge} of charging, so we have ${formatDuration(s.parkedMin - s.chargeMin)} to find cheaper hours.`;
}
