/**
 * SYNTHETIC charging simulator. Replays a committed plan against realized (not forecast)
 * base load and injected faults, producing per-slot energy records. No real hardware.
 */
import type { StationConfig } from "./station";
import { slotStartMs, type SlotGrid } from "./time";
import { batteryMilliWhFromGridWh, POWER_GRANULARITY_W, SLOTS_PER_HOUR } from "./units";

export interface SimulationFaults {
  /** Charger outage over slots [fromSlot, toSlot). */
  outage?: { fromSlot: number; toSlot: number };
}

export interface EnergyRecord {
  slotIndex: number;
  slotStartMs: number;
  commandedW: number;
  deliveredW: number;
  gridWh: number;
  batteryMilliWh: number;
  limitedBy: "NONE" | "OUTAGE" | "SITE_CAP";
  source: "SYNTHETIC";
}

export interface SimulationResult {
  records: EnergyRecord[];
  deliveredGridWh: number;
  deliveredBatteryMilliWh: number;
  targetBatteryMilliWh: number;
  outcome: "DELIVERED" | "FAILED";
  shortfallBatteryMilliWh: number;
}

export interface SimulationInput {
  station: StationConfig;
  grid: SlotGrid;
  powerW: readonly number[];
  actualBaseLoadW: readonly number[];
  otherSessionsW: readonly number[];
  targetBatteryWh: number;
  efficiencyBp: number;
  faults: SimulationFaults;
}

export function simulateSession(input: SimulationInput): SimulationResult {
  const { station, grid, faults } = input;
  const records: EnergyRecord[] = [];
  let deliveredGridWh = 0;
  for (let i = 0; i < grid.slotCount; i++) {
    const commandedW = input.powerW[i] ?? 0;
    if (commandedW === 0) continue;
    const inOutage = faults.outage !== undefined && i >= faults.outage.fromSlot && i < faults.outage.toSlot;
    const siteRoom = station.stationCapW - (input.actualBaseLoadW[i] ?? 0) - (input.otherSessionsW[i] ?? 0);
    const roomW = Math.max(0, Math.floor(siteRoom / POWER_GRANULARITY_W) * POWER_GRANULARITY_W);
    const deliveredW = inOutage ? 0 : Math.min(commandedW, roomW);
    const gridWh = deliveredW / SLOTS_PER_HOUR;
    deliveredGridWh += gridWh;
    records.push({
      slotIndex: i,
      slotStartMs: slotStartMs(grid, i),
      commandedW,
      deliveredW,
      gridWh,
      batteryMilliWh: batteryMilliWhFromGridWh(gridWh, input.efficiencyBp),
      limitedBy: inOutage ? "OUTAGE" : deliveredW < commandedW ? "SITE_CAP" : "NONE",
      source: "SYNTHETIC",
    });
  }
  const deliveredBatteryMilliWh = batteryMilliWhFromGridWh(deliveredGridWh, input.efficiencyBp);
  const targetBatteryMilliWh = input.targetBatteryWh * 1000;
  const shortfall = Math.max(0, targetBatteryMilliWh - deliveredBatteryMilliWh);
  return {
    records,
    deliveredGridWh,
    deliveredBatteryMilliWh,
    targetBatteryMilliWh,
    outcome: shortfall === 0 ? "DELIVERED" : "FAILED",
    shortfallBatteryMilliWh: shortfall,
  };
}
