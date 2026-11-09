/** Pure mapping from the schedule model to Bryntum event records. Kept free of Bryntum imports so it can be unit tested. */
import { burstsForLane, timeLabel, type PowerBurst, type ScheduleLane, type ScheduleModel } from "./scheduleModel";

/** Bryntum event record shape used by this view. Only fields the chart reads are listed. */
export interface ChartEvent {
  id: string;
  resourceId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  cls: string;
}

export const LANE_CLASS: Record<ScheduleLane, string> = {
  ORIGINAL: "gw-burst-original",
  CURRENT: "gw-burst-current",
  PROPOSAL: "gw-burst-proposal",
};

/** The label carries the meaning (kind, peak, times); colour and hatch are only a redundant cue. */
export function burstLabel(b: PowerBurst, timeZone: string): string {
  const kind = b.lane === "PROPOSAL" ? "Proposal" : b.recovered ? "Recovered" : "Charging";
  return `${kind} ${b.peakKw.toFixed(1)} kW · ${timeLabel(b.startMs, timeZone)}-${timeLabel(b.endMs, timeZone)}`;
}

/**
 * One event per charging burst, plus a parked-occupancy event per session. The CURRENT lane includes pending
 * PROPOSAL bursts so the operator sees what is awaiting approval; they are never drawn as committed.
 */
export function toChartEvents(model: ScheduleModel, lane: ScheduleLane): ChartEvent[] {
  const bursts = lane === "CURRENT" ? [...burstsForLane(model, "CURRENT"), ...burstsForLane(model, "PROPOSAL")] : burstsForLane(model, lane);
  const charging: ChartEvent[] = bursts.map((b) => ({
    id: b.id,
    resourceId: b.portId,
    name: burstLabel(b, model.timeZone),
    startDate: new Date(b.startMs),
    endDate: new Date(b.endMs),
    cls: LANE_CLASS[b.lane],
  }));
  const parked: ChartEvent[] = model.occupancy.map((o) => ({
    id: o.id,
    resourceId: o.portId,
    name: `Parked ${timeLabel(o.startMs, model.timeZone)}-${timeLabel(o.endMs, model.timeZone)}`,
    startDate: new Date(o.startMs),
    endDate: new Date(o.endMs),
    cls: "gw-occupancy",
  }));
  return [...parked, ...charging];
}
