/**
 * Station-zone time axis for the Bryntum timeline.
 *
 * Bryntum's default header labels use the browser's zone (verified in a real browser, see docs/BRYNTUM_NOTES.md).
 * Each header renderer below receives the tick start as epoch ms and formats it in the station zone instead.
 * Tick boundaries are still placed by Bryntum on browser-local hours; only the labels are station time.
 */
import type { BryntumScheduler } from "@bryntum/scheduler-react-community";
import type { ComponentProps } from "react";

export type SchedulerViewPreset = ComponentProps<typeof BryntumScheduler>["viewPreset"];

const HOUR_MS = 3_600_000;
const HOUR_FORMAT = (timeZone: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone });
const ZONE_FORMAT = (timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZoneName: "short", timeZone });
const DAY_FORMAT = (timeZone: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "2-digit", day: "2-digit", timeZone });

/** Wall-clock reading of an instant in the zone: "1:00 AM", "6 PM" style is built by stationHourLabel. */
function wallClock(ms: number, timeZone: string): { hour: string; minute: string; dayPeriod: string } {
  const parts = HOUR_FORMAT(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { hour: get("hour"), minute: get("minute"), dayPeriod: get("dayPeriod") };
}

/** "6 PM" on the hour, "5:30 PM" on a half hour (some zones differ from the station by 30 minutes). */
export function stationHourLabel(ms: number, timeZone: string): string {
  const { hour, minute, dayPeriod } = wallClock(ms, timeZone);
  const clock = minute === "00" ? hour : `${hour}:${minute}`;
  const label = `${clock} ${dayPeriod}`;
  // A wall-clock reading that recurs one real hour before or after (the repeated fall-back hour) gets its zone name.
  const repeated = [ms - HOUR_MS, ms + HOUR_MS].some((other) => sameReading(wallClock(other, timeZone), { hour, minute, dayPeriod }));
  return repeated ? `${label} ${zoneName(ms, timeZone)}` : label;
}

function sameReading(a: { hour: string; minute: string; dayPeriod: string }, b: { hour: string; minute: string; dayPeriod: string }): boolean {
  return a.hour === b.hour && a.minute === b.minute && a.dayPeriod === b.dayPeriod;
}

/** "PDT" or "PST" for America/Los_Angeles, "UTC" for UTC; the zone's own short name. */
function zoneName(ms: number, timeZone: string): string {
  return ZONE_FORMAT(timeZone).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

/** "Sat, 03/13" in the station zone. */
export function stationDayLabel(ms: number, timeZone: string): string {
  return DAY_FORMAT(timeZone).format(new Date(ms));
}

/** Hour-and-day preset whose header labels are formatted in the station zone. */
export function scheduleViewPreset(timeZone: string): SchedulerViewPreset {
  return {
    base: "hourAndDay",
    headers: [
      { unit: "day", increment: 1, renderer: (start: Date) => stationDayLabel(start.getTime(), timeZone) },
      { unit: "hour", increment: 1, renderer: (start: Date) => stationHourLabel(start.getTime(), timeZone) },
    ],
  };
}
