/**
 * Independent feasibility validator. Deliberately does NOT import the allocator:
 * it re-derives every physical constraint from raw inputs so allocator bugs are caught.
 */
import type { SessionPlan, StationConfig } from "./station";
import type { SlotGrid } from "./time";

export interface ValidationTarget {
  sessionId: string;
  targetBatteryWh: number;
  efficiencyBp: number;
}

export interface Violation {
  code:
    | "NON_INTEGER_POWER"
    | "NEGATIVE_POWER"
    | "POWER_GRANULARITY"
    | "UNKNOWN_PORT"
    | "PORT_POWER_CAP"
    | "STATION_CAP"
    | "CHARGING_WHILE_UNPLUGGED"
    | "PORT_DOUBLE_BOOKED"
    | "ENERGY_SHORTFALL"
    | "LENGTH_MISMATCH";
  sessionId?: string;
  slot?: number;
  detail: string;
}

const QUARTER_HOUR_MS = 900_000;

export function validatePlans(
  station: StationConfig,
  grid: SlotGrid,
  baseLoadW: readonly number[],
  plans: readonly SessionPlan[],
  targets: readonly ValidationTarget[] = [],
): Violation[] {
  const violations: Violation[] = [];
  const siteLoad = baseLoadW.slice(0, grid.slotCount);
  const ports = new Map(station.ports.map((p) => [p.id, p]));

  for (const plan of plans) {
    const port = ports.get(plan.portId);
    if (!port) {
      violations.push({ code: "UNKNOWN_PORT", sessionId: plan.sessionId, detail: plan.portId });
      continue;
    }
    if (plan.powerW.length !== grid.slotCount) {
      violations.push({ code: "LENGTH_MISMATCH", sessionId: plan.sessionId, detail: `${plan.powerW.length} != ${grid.slotCount}` });
      continue;
    }
    plan.powerW.forEach((w, slot) => {
      if (!Number.isSafeInteger(w)) violations.push({ code: "NON_INTEGER_POWER", sessionId: plan.sessionId, slot, detail: String(w) });
      else if (w < 0) violations.push({ code: "NEGATIVE_POWER", sessionId: plan.sessionId, slot, detail: String(w) });
      else if (w % 4 !== 0) violations.push({ code: "POWER_GRANULARITY", sessionId: plan.sessionId, slot, detail: String(w) });
      if (w > port.maxPowerW) violations.push({ code: "PORT_POWER_CAP", sessionId: plan.sessionId, slot, detail: `${w} > ${port.maxPowerW}` });
      const slotStart = grid.startMs + slot * QUARTER_HOUR_MS;
      const plugged = slotStart >= plan.plugInMs && slotStart + QUARTER_HOUR_MS <= plan.departMs;
      if (w > 0 && !plugged) violations.push({ code: "CHARGING_WHILE_UNPLUGGED", sessionId: plan.sessionId, slot, detail: `${w} W outside occupancy` });
      siteLoad[slot] = (siteLoad[slot] ?? 0) + w;
    });
  }

  siteLoad.forEach((load, slot) => {
    const limit = station.stationCapW - station.safetyHeadroomW;
    if (load > limit) violations.push({ code: "STATION_CAP", slot, detail: `site load ${load} W > ${limit} W` });
  });

  for (let a = 0; a < plans.length; a++) {
    for (let b = a + 1; b < plans.length; b++) {
      const p = plans[a]!;
      const q = plans[b]!;
      if (p.portId === q.portId && p.plugInMs < q.departMs && q.plugInMs < p.departMs) {
        violations.push({ code: "PORT_DOUBLE_BOOKED", sessionId: q.sessionId, detail: `${p.sessionId} and ${q.sessionId} both parked at ${p.portId}` });
      }
    }
  }

  for (const target of targets) {
    const plan = plans.find((p) => p.sessionId === target.sessionId);
    const gridWh = plan ? plan.powerW.reduce((s, w) => s + w, 0) / 4 : 0;
    // battery mWh = grid Wh * efficiency (bp/10_000) * 1000
    const batteryMilliWh = Math.floor((gridWh * target.efficiencyBp) / 10);
    if (batteryMilliWh < target.targetBatteryWh * 1000) {
      violations.push({ code: "ENERGY_SHORTFALL", sessionId: target.sessionId, detail: `${batteryMilliWh} mWh < ${target.targetBatteryWh * 1000} mWh` });
    }
  }
  return violations;
}
