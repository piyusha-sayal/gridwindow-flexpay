/**
 * SYNTHETIC tariff and base-load models. Numbers are illustrative assumptions,
 * not a utility tariff or measured site data.
 */
import { localParts, slotStartMs, type SlotGrid } from "./time";

export interface TariffModel {
  label: string;
  /** Time-of-use energy price by local hour band, millicents per grid kWh. */
  bands: readonly { fromHour: number; toHour: number; mcPerKWh: number }[];
  /** Site load above this share of the station cap incurs the congestion surcharge. */
  congestionThresholdBp: number;
  congestionSurchargeMcPerKWh: number;
}

export const SYNTHETIC_TARIFF: TariffModel = {
  label: "Synthetic TOU + congestion surcharge v1 (assumption, not a utility tariff)",
  bands: [
    { fromHour: 0, toHour: 6, mcPerKWh: 14_000 },
    { fromHour: 6, toHour: 16, mcPerKWh: 24_000 },
    { fromHour: 16, toHour: 21, mcPerKWh: 46_000 },
    { fromHour: 21, toHour: 24, mcPerKWh: 30_000 },
  ],
  congestionThresholdBp: 7_000,
  congestionSurchargeMcPerKWh: 35_000,
};

export function touMcPerKWh(tariff: TariffModel, utcMs: number, timeZone: string): number {
  const { hour } = localParts(utcMs, timeZone);
  const band = tariff.bands.find((b) => hour >= b.fromHour && hour < b.toHour);
  if (!band) throw new Error(`tariff has no band for hour ${hour}`);
  return band.mcPerKWh;
}

export function touSeries(tariff: TariffModel, grid: SlotGrid): number[] {
  return Array.from({ length: grid.slotCount }, (_, i) => touMcPerKWh(tariff, slotStartMs(grid, i), grid.timeZone));
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Typical synthetic building load (W) by local hour; evening peak, quiet overnight. */
function profileW(hour: number, minute: number): number {
  const h = hour + minute / 60;
  const evening = 7_000 * Math.exp(-((h - 19) ** 2) / 6);
  const morning = 4_000 * Math.exp(-((h - 8) ** 2) / 4);
  return Math.round(2_500 + evening + morning);
}

function roundToStep(w: number, step: number): number {
  return Math.max(0, Math.round(w / step) * step);
}

/** One synthetic day of realized base load with seeded noise. */
export function syntheticBaseLoadW(grid: SlotGrid, seed: number, step = 100): number[] {
  const rand = mulberry32(seed);
  return Array.from({ length: grid.slotCount }, (_, i) => {
    const { hour, minute } = localParts(slotStartMs(grid, i), grid.timeZone);
    const noise = (rand() - 0.5) * 2_400;
    return roundToStep(profileW(hour, minute) + noise, step);
  });
}

/**
 * Seasonal-naive forecast: mean of the previous `days` synthetic realizations for the
 * same slot of night. Deterministic in `seed`.
 */
export function forecastBaseLoadW(grid: SlotGrid, seed: number, days = 7, step = 100): number[] {
  const history = Array.from({ length: days }, (_, d) => syntheticBaseLoadW(grid, seed * 31 + d + 1, step));
  return Array.from({ length: grid.slotCount }, (_, i) => roundToStep(history.reduce((sum, day) => sum + (day[i] ?? 0), 0) / days, step));
}
