/**
 * Shared night axis for the driver views and the landing illustration: time ticks, the synthetic
 * tariff strip and per-slot power bars. Purely presentational; all values come from the caller.
 */
import { SYNTHETIC_TARIFF } from "@/domain/forecast";
import { formatLocalTime } from "@/domain/time";
import { SLOT_MS } from "@/domain/units";

export interface Axis {
  slotCount: number;
  /** Local wall-clock label ("HH:MM") at the start of slot i (i may equal slotCount). */
  label: (i: number) => string;
}

export function quoteAxis(grid: { startMs: number; slotCount: number }, timeZone: string): Axis {
  return { slotCount: grid.slotCount, label: (i) => formatLocalTime(grid.startMs + i * SLOT_MS, timeZone) };
}

/** Fixed 18:00 → 10:00 axis used before a quote exists. */
export const FIXED_NIGHT_AXIS: Axis = {
  slotCount: 64,
  label: (i) => {
    const min = 18 * 60 + i * 15;
    return `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  },
};

const TOU_FILL: Record<number, string> = { 46_000: "var(--tou-46)", 30_000: "var(--tou-30)", 24_000: "var(--tou-24)", 14_000: "var(--tou-14)" };

export const pctOf = (slot: number, slotCount: number) => `${(slot / slotCount) * 100}%`;

/** Synthetic tariff (millicents per grid kWh) for each slot, from the slot's local hour. */
export function slotTariffMc(axis: Axis): number[] {
  return Array.from({ length: axis.slotCount }, (_, i) => {
    const hour = Number(axis.label(i).slice(0, 2));
    return SYNTHETIC_TARIFF.bands.find((b) => hour >= b.fromHour && hour < b.toHour)!.mcPerKWh;
  });
}

/** Contiguous tariff bands, so each price is labeled once. */
export function tariffBands(tariff: readonly number[]): { from: number; to: number; mc: number }[] {
  return tariff.reduce<{ from: number; to: number; mc: number }[]>((bands, mc, i) => {
    const last = bands[bands.length - 1];
    return last && last.mc === mc ? [...bands.slice(0, -1), { ...last, to: i + 1 }] : [...bands, { from: i, to: i + 1, mc }];
  }, []);
}

export function TariffStrip({ axis, className = "h-6" }: { axis: Axis; className?: string }) {
  return (
    <div className={`relative rounded-[3px] overflow-hidden ${className}`} aria-hidden="true">
      {tariffBands(slotTariffMc(axis)).map((b) => (
        <span
          key={b.from}
          className="absolute inset-y-0 flex items-center justify-center font-mono text-[11px] text-ink"
          style={{ left: pctOf(b.from, axis.slotCount), width: pctOf(b.to - b.from, axis.slotCount), background: TOU_FILL[b.mc] }}
        >
          {b.to - b.from >= 6 ? `${b.mc / 1000}¢` : ""}
        </span>
      ))}
    </div>
  );
}

export function AxisTicks({ axis, every = 16 }: { axis: Axis; every?: number }) {
  const ticks = Array.from({ length: Math.floor(axis.slotCount / every) + 1 }, (_, k) => k * every);
  return (
    <div className="flex justify-between meta" aria-hidden="true">
      {ticks.map((t) => (
        <span key={t}>{axis.label(t)}</span>
      ))}
    </div>
  );
}

interface PowerBarsProps {
  powerW: readonly number[];
  maxW: number;
  color: string;
  /** Parked span [from, to) in slots; drawn as a faint track, with a dashed line where the driver leaves. */
  parked?: { from: number; to: number };
  className?: string;
}

export function PowerBars({ powerW, maxW, color, parked, className = "h-9" }: PowerBarsProps) {
  const n = powerW.length;
  return (
    <span className={`relative block ${className}`} aria-hidden="true">
      {parked && <span className="absolute inset-y-0 rounded-[2px] bg-[var(--chart-track)]" style={{ left: pctOf(parked.from, n), width: pctOf(parked.to - parked.from, n) }} />}
      <span className="relative flex h-full items-end gap-px">
        {powerW.map((w, i) => (
          <span key={i} className="flex-1 rounded-[1px]" style={{ height: `${maxW > 0 ? (w / maxW) * 100 : 0}%`, background: color, transition: "height var(--t-bar) var(--ease)" }} />
        ))}
      </span>
      {parked && <span className="absolute -inset-y-1 border-l border-dashed border-ink" style={{ left: pctOf(parked.to, n) }} />}
    </span>
  );
}
