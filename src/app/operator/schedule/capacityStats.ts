/** Presentation-only summary of the capacity buckets the schedule model already holds. Nothing here changes a plan or a limit. */
import { SLOT_MS } from "@/domain/units";
import type { CapacityBucket } from "./scheduleModel";

export interface OverloadRange {
  startMs: number;
  /** End of the last over-limit slot (exclusive). */
  endMs: number;
  slots: number;
}

export interface CapacitySummary {
  peakKw: number;
  minLimitKw: number;
  maxLimitKw: number;
  overSlots: number;
  overloads: OverloadRange[];
}

/** Peak demand, the limit, and consecutive over-limit slots grouped into ranges. All values come from the buckets. */
export function summarizeCapacity(buckets: readonly CapacityBucket[]): CapacitySummary {
  const overloads: OverloadRange[] = [];
  let open: { startMs: number; lastSlot: number; slots: number } | null = null;
  const close = () => {
    if (open) overloads.push({ startMs: open.startMs, endMs: open.startMs + open.slots * SLOT_MS, slots: open.slots });
    open = null;
  };
  for (const b of buckets) {
    if (!b.over) {
      close();
      continue;
    }
    if (open && b.slot === open.lastSlot + 1) {
      open.lastSlot = b.slot;
      open.slots += 1;
    } else {
      close();
      open = { startMs: b.startMs, lastSlot: b.slot, slots: 1 };
    }
  }
  close();
  return {
    peakKw: Math.max(0, ...buckets.map((b) => Math.round((b.drawKw + b.baseKw) * 1000) / 1000)),
    minLimitKw: buckets.length ? Math.min(...buckets.map((b) => b.capKw)) : 0,
    maxLimitKw: Math.max(0, ...buckets.map((b) => b.capKw)),
    overSlots: overloads.reduce((a, r) => a + r.slots, 0),
    overloads,
  };
}

/** "33 kW" for whole numbers, "7.2 kW" otherwise. */
export function formatKw(kw: number): string {
  return `${Number.isInteger(kw) ? kw : kw.toFixed(1)} kW`;
}
