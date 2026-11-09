/**
 * Recorded disturbances as physical constraints. Each one applies from its effective slot onward and
 * never rewrites energy already scheduled before it. The resulting envelope is the single source of
 * truth for every capacity check that must respect the disturbed station.
 */
import type { SessionPlan, StationConfig } from "./station";
import { slotStartMs, type SlotGrid } from "./time";
import { SLOT_MS, POWER_GRANULARITY_W } from "./units";
import { validatePlans, type ValidationTarget, type Violation } from "./validator";

export const DISTURBANCE_TYPES = ["CHARGER_POWER_REDUCTION", "SITE_CAP_REDUCTION", "EARLY_DEPARTURE", "CHARGER_FAILURE"] as const;
export type DisturbanceType = (typeof DISTURBANCE_TYPES)[number];

/** A recorded disturbance as the planner sees it. Params are validated before they are stored. */
export interface DisturbanceRecord {
  reservationId: string;
  /** The reservation's port; a port disturbance affects every session that uses this port. */
  portId: string;
  type: DisturbanceType;
  effectiveSlot: number;
  params: Record<string, number>;
}

export interface NightEnvelope {
  /** Aggregate site cap per slot (W). */
  siteCapW: readonly number[];
  /** Port power ceiling per slot (W), present only for constrained ports. */
  portCapW: Readonly<Record<string, readonly number[]>>;
  /** Effective departure (ms) for reservations whose departure was shortened. */
  departMsByReservation: Readonly<Record<string, number>>;
}

/** Port limit implied by a power reduction (absolute watts or basis points of the rated power). */
export function portCapFromParams(ratedW: number, type: DisturbanceType, params: Record<string, number>): number {
  if (type === "CHARGER_FAILURE") return 0;
  if (params.maxPowerW !== undefined) return Math.min(ratedW, params.maxPowerW);
  if (params.factorBp !== undefined) return Math.floor((ratedW * params.factorBp) / 10_000 / POWER_GRANULARITY_W) * POWER_GRANULARITY_W;
  return ratedW;
}

export function buildEnvelope(station: StationConfig, grid: SlotGrid, records: readonly DisturbanceRecord[]): NightEnvelope {
  const siteCapW = new Array<number>(grid.slotCount).fill(station.stationCapW);
  const portCapW: Record<string, number[]> = {};
  const departMsByReservation: Record<string, number> = {};
  for (const d of records) {
    const port = station.ports.find((p) => p.id === d.portId);
    if (!port) continue;
    if (d.type === "EARLY_DEPARTURE") {
      const current = departMsByReservation[d.reservationId];
      departMsByReservation[d.reservationId] = Math.min(current ?? Number.POSITIVE_INFINITY, d.params.departMs!);
      continue;
    }
    const from = d.effectiveSlot;
    if (d.type === "SITE_CAP_REDUCTION") {
      for (let i = from; i < grid.slotCount; i++) siteCapW[i] = Math.min(siteCapW[i]!, d.params.stationCapW!);
      continue;
    }
    const cap = portCapFromParams(port.maxPowerW, d.type, d.params);
    const slots = (portCapW[port.id] ??= new Array<number>(grid.slotCount).fill(port.maxPowerW));
    for (let i = from; i < grid.slotCount; i++) slots[i] = Math.min(slots[i]!, cap);
  }
  return { siteCapW, portCapW, departMsByReservation };
}

export function effectiveDepartMs(envelope: NightEnvelope, reservationId: string, agreedDepartMs: number): number {
  return Math.min(agreedDepartMs, envelope.departMsByReservation[reservationId] ?? agreedDepartMs);
}

export function portCapAt(station: StationConfig, envelope: NightEnvelope, portId: string, slot: number): number {
  const rated = station.ports.find((p) => p.id === portId)?.maxPowerW ?? 0;
  return Math.min(rated, envelope.portCapW[portId]?.[slot] ?? rated);
}

/** Base load as the validator and allocator must see it: withheld site capacity counts as fixed load. */
export function envelopeBaseLoadW(station: StationConfig, forecastBaseLoadW: readonly number[], envelope: NightEnvelope): number[] {
  return forecastBaseLoadW.map((w, i) => w + Math.max(0, station.stationCapW - (envelope.siteCapW[i] ?? station.stationCapW)));
}

/** Port power ceiling violations for every plan on a constrained port. */
export function checkPortCaps(station: StationConfig, grid: SlotGrid, envelope: NightEnvelope, plans: readonly SessionPlan[]): Violation[] {
  const violations: Violation[] = [];
  for (const plan of plans) {
    if (!envelope.portCapW[plan.portId] || plan.powerW.length !== grid.slotCount) continue;
    plan.powerW.forEach((w, slot) => {
      const cap = portCapAt(station, envelope, plan.portId, slot);
      if (w > cap) violations.push({ code: "PORT_POWER_CAP", sessionId: plan.sessionId, slot, detail: `${w} W > ${cap} W limit on port ${plan.portId}` });
    });
  }
  return violations;
}

/** Independent validator run under the disturbed station: site caps, port caps, physics, energy. */
export function validateWithEnvelope(input: {
  station: StationConfig;
  grid: SlotGrid;
  forecastBaseLoadW: readonly number[];
  envelope: NightEnvelope;
  plans: readonly SessionPlan[];
  targets?: readonly ValidationTarget[];
}): Violation[] {
  const { station, grid, envelope, plans } = input;
  const base = envelopeBaseLoadW(station, input.forecastBaseLoadW, envelope);
  return [...validatePlans(station, grid, base, plans, input.targets ?? []), ...checkPortCaps(station, grid, envelope, plans)];
}

/** Null when the disturbance is physically meaningful for this reservation, otherwise a plain-English reason. */
export function validateDisturbance(
  station: StationConfig,
  grid: SlotGrid,
  agreed: { plugInMs: number; departMs: number },
  d: DisturbanceRecord,
): string | null {
  if (!Number.isInteger(d.effectiveSlot) || d.effectiveSlot < 0 || d.effectiveSlot >= grid.slotCount) return "effective slot must be inside this night";
  const port = station.ports.find((p) => p.id === d.portId);
  if (!port) return "unknown port";
  if (d.type === "CHARGER_POWER_REDUCTION") {
    const limit = d.params.maxPowerW ?? portCapFromParams(port.maxPowerW, d.type, d.params);
    if (d.params.maxPowerW !== undefined && d.params.maxPowerW <= 0) return "power limit must be greater than zero (use a charger failure instead)";
    if (d.params.maxPowerW !== undefined && d.params.maxPowerW > port.maxPowerW) return "power limit must not exceed the rated port power";
    if (d.params.factorBp !== undefined && d.params.factorBp >= 10_000) return "power factor must be below 100%";
    if (limit <= 0) return "power limit must be greater than zero";
    return null;
  }
  if (d.type === "SITE_CAP_REDUCTION") {
    const cap = d.params.stationCapW!;
    if (cap >= station.stationCapW) return "site cap must be a reduction of the current cap";
    if (cap <= station.safetyHeadroomW) return "site cap must leave headroom above the safety margin";
    return null;
  }
  if (d.type === "EARLY_DEPARTURE") {
    const departMs = d.params.departMs!;
    if (departMs >= agreed.departMs) return "new departure must be earlier than the agreed departure";
    if (departMs <= agreed.plugInMs) return "new departure must be after plug-in";
    if (departMs <= slotStartMs(grid, d.effectiveSlot)) return "new departure must fall after the effective slot starts";
    return null;
  }
  return null;
}

/** End of the last slot with charging power, or null if the plan never charges. */
export function chargeEndMs(grid: SlotGrid, powerW: readonly number[]): number | null {
  let last = -1;
  powerW.forEach((w, i) => {
    if (w > 0) last = i;
  });
  return last < 0 ? null : slotStartMs(grid, last) + SLOT_MS;
}

/**
 * Violations that a candidate plan introduces on top of the committed night, under the disturbed envelope.
 * Violations that already exist without the candidate are not attributed to it, so one broken session never
 * hides every offer on the night.
 */
export function violationsIntroducedBy(input: {
  station: StationConfig;
  grid: SlotGrid;
  forecastBaseLoadW: readonly number[];
  envelope: NightEnvelope;
  committed: readonly SessionPlan[];
  candidate: SessionPlan;
}): Violation[] {
  const { station, grid, forecastBaseLoadW, envelope, committed, candidate } = input;
  const key = (v: Violation) => `${v.code}|${v.sessionId}|${v.slot ?? ""}`;
  const before = new Set(validateWithEnvelope({ station, grid, forecastBaseLoadW, envelope, plans: committed }).map(key));
  return validateWithEnvelope({ station, grid, forecastBaseLoadW, envelope, plans: [...committed, candidate] }).filter((v) => !before.has(key(v)));
}
