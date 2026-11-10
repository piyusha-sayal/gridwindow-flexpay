"use client";

// The chart draws no icons, so the FontAwesome stylesheets (see docs/BRYNTUM_NOTES.md) are not imported.
import "@bryntum/scheduler-community/scheduler.css";
import "@bryntum/scheduler-community/svalbard-light.css";
import { BryntumScheduler } from "@bryntum/scheduler-react-community";
import { useMemo } from "react";
import { toChartEvents } from "./chartEvents";
import { scheduleViewPreset } from "./scheduleAxis";
import type { ScheduleLane, ScheduleModel } from "./scheduleModel";

export interface ScheduleChartProps {
  model: ScheduleModel;
  lane: ScheduleLane;
}

/** Read-only timeline. Manual drag or resize is not offered: there is no server endpoint that persists a manual schedule edit. */
export function ScheduleChart({ model, lane }: ScheduleChartProps) {
  const events = useMemo(() => toChartEvents(model, lane), [model, lane]);
  const resources = useMemo(() => model.resources.map((r) => ({ id: r.id, name: `Port ${r.label} (${r.ratedKw} kW)` })), [model.resources]);
  // Stable date objects: a new range on every poll would reset the timeline's scroll and zoom.
  const startDate = useMemo(() => new Date(model.gridStartMs), [model.gridStartMs]);
  const endDate = useMemo(() => new Date(model.gridEndMs), [model.gridEndMs]);
  // Header labels in the station zone. Memoized so a poll does not reset the timeline.
  const viewPreset = useMemo(() => scheduleViewPreset(model.timeZone), [model.timeZone]);
  return (
    <BryntumScheduler
      startDate={startDate}
      endDate={endDate}
      viewPreset={viewPreset}
      resources={resources}
      events={events}
      columns={[{ type: "resourceInfo", field: "name", text: "Port", width: 150 }]}
      readOnly
      rowHeight={56}
      height={260}
    />
  );
}
