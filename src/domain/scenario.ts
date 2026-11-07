/** Deterministic scenario context: one night on one station with seeded synthetic load. */
import type { AllocationContext } from "./allocator";
import { forecastBaseLoadW, SYNTHETIC_TARIFF, syntheticBaseLoadW, touSeries, type TariffModel } from "./forecast";
import type { SessionPlan, StationConfig } from "./station";
import { buildNightGrid, type SlotGrid } from "./time";

export const FORECAST_LABEL = "Seasonal-naive mean of 7 prior synthetic nights (SYNTHETIC)";

export interface NightScenario {
  nightOf: string;
  seed: number;
  grid: SlotGrid;
  tariff: TariffModel;
  touMc: number[];
  forecastBaseLoadW: number[];
  actualBaseLoadW: number[];
}

export function buildNightScenario(station: StationConfig, nightOf: string, seed: number, tariff: TariffModel = SYNTHETIC_TARIFF): NightScenario {
  const grid = buildNightGrid(nightOf, station.timeZone);
  return {
    nightOf,
    seed,
    grid,
    tariff,
    touMc: touSeries(tariff, grid),
    forecastBaseLoadW: forecastBaseLoadW(grid, seed),
    actualBaseLoadW: syntheticBaseLoadW(grid, seed * 7919 + 17),
  };
}

export function allocationContext(station: StationConfig, scenario: NightScenario, committed: readonly SessionPlan[]): AllocationContext {
  return {
    station,
    grid: scenario.grid,
    tariff: scenario.tariff,
    touMc: scenario.touMc,
    baseLoadW: scenario.forecastBaseLoadW,
    committed,
  };
}
