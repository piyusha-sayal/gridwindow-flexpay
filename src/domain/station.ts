/** Physical station model. Port occupancy and electrical draw are tracked separately. */

export interface Port {
  id: string;
  label: string;
  maxPowerW: number;
}

export interface StationConfig {
  id: string;
  name: string;
  timeZone: string;
  /** Aggregate grid-input cap for the site (EV charging + base building load). */
  stationCapW: number;
  /** Reserved margin to absorb base-load forecast error. */
  safetyHeadroomW: number;
  /** Optimizer power step; must be a multiple of 4 W. */
  powerStepW: number;
  ports: readonly Port[];
}

/** One driver's charging need while parked at one port. */
export interface ChargeRequest {
  portId: string;
  /** Port is physically occupied over [plugInMs, departMs). */
  plugInMs: number;
  departMs: number;
  targetBatteryWh: number;
  efficiencyBp: number;
  spendCapCents: number;
}

/** A committed or proposed allocation: occupancy plus a per-slot power plan on the shared grid. */
export interface SessionPlan {
  sessionId: string;
  portId: string;
  plugInMs: number;
  departMs: number;
  powerW: readonly number[];
}

export const DEMO_STATION: StationConfig = {
  id: "stn_demo_harbor",
  name: "Harbor Lane Overnight Depot (synthetic)",
  timeZone: "America/Los_Angeles",
  stationCapW: 33_000,
  safetyHeadroomW: 1_000,
  powerStepW: 100,
  ports: [
    { id: "port_a", label: "A", maxPowerW: 11_000 },
    { id: "port_b", label: "B", maxPowerW: 11_000 },
    { id: "port_c", label: "C", maxPowerW: 11_000 },
  ],
};

export function findPort(station: StationConfig, portId: string): Port | undefined {
  return station.ports.find((p) => p.id === portId);
}

export function occupancyOverlaps(a: { plugInMs: number; departMs: number }, b: { plugInMs: number; departMs: number }): boolean {
  return a.plugInMs < b.departMs && b.plugInMs < a.departMs;
}
