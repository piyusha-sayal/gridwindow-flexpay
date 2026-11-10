import { describe, expect, it } from "vitest";
import { SLOT_MS } from "@/domain/units";
import { buildNightGrid } from "@/domain/time";
import { scheduleViewPreset, stationDayLabel, stationHourLabel } from "@/app/operator/schedule/scheduleAxis";

const LA = "America/Los_Angeles";
const HOUR_MS = 3_600_000;

/** Hourly header labels, stepping by real hours from the grid start (the same spacing Bryntum uses for hour ticks). */
function hourlyLabels(startMs: number, count: number, timeZone: string): string[] {
  return Array.from({ length: count }, (_, i) => stationHourLabel(startMs + i * HOUR_MS, timeZone));
}

describe("stationHourLabel", () => {
  it("labels a whole hour as the station clock, not the process or browser clock", () => {
    expect(stationHourLabel(Date.UTC(2026, 11, 6, 2, 0), LA)).toBe("6 PM");
    expect(stationHourLabel(Date.UTC(2026, 11, 6, 2, 0), "UTC")).toBe("2 AM");
  });

  it("keeps minutes for a half-hour tick (for example, a half-hour-offset browser zone)", () => {
    expect(stationHourLabel(Date.UTC(2026, 11, 6, 1, 30), LA)).toBe("5:30 PM");
  });
});

describe("stationDayLabel", () => {
  it("labels the day in the station zone across the spring transition", () => {
    expect(stationDayLabel(Date.UTC(2027, 2, 14, 10, 0), LA)).toBe("Sun, 03/14");
  });
});

describe("hour labels across the 2027 DST transitions", () => {
  it("spring forward (night of 2027-03-13): 15 elapsed hours, 1 AM is followed by 3 AM", () => {
    const grid = buildNightGrid("2027-03-13", LA);
    expect(grid.slotCount).toBe(60);
    const labels = hourlyLabels(grid.startMs, 15, LA);
    expect(labels.slice(0, 4)).toEqual(["6 PM", "7 PM", "8 PM", "9 PM"]);
    expect(labels.slice(-4)).toEqual(["6 AM", "7 AM", "8 AM", "9 AM"]);
    expect(labels).not.toContain("2 AM");
    expect(labels.indexOf("3 AM")).toBe(labels.indexOf("1 AM") + 1);
  });

  it("fall back (night of 2027-11-06): 17 elapsed hours, the repeated 1 AM appears twice", () => {
    const grid = buildNightGrid("2027-11-06", LA);
    expect(grid.slotCount).toBe(68);
    const labels = hourlyLabels(grid.startMs, 17, LA);
    expect(labels.filter((l) => l === "1 AM PDT")).toHaveLength(1);
    expect(labels.filter((l) => l === "1 AM PST")).toHaveLength(1);
    expect(labels.filter((l) => l === "1 AM")).toHaveLength(0);
    expect(labels.filter((l) => l === "2 AM")).toHaveLength(1);
    expect(labels[labels.length - 1]).toBe("9 AM");
  });

  it("the repeated hour is named by zone: 1 AM PDT first, then 1 AM PST, then 2 AM", () => {
    const grid = buildNightGrid("2027-11-06", LA);
    const firstOne = grid.startMs + 7 * HOUR_MS;
    expect(stationHourLabel(firstOne, LA)).toBe("1 AM PDT");
    expect(stationHourLabel(firstOne + HOUR_MS, LA)).toBe("1 AM PST");
    expect(stationHourLabel(firstOne + 2 * HOUR_MS, LA)).toBe("2 AM");
  });

  it("a half-hour tick inside the repeated hour is also zone-named", () => {
    const firstOneThirty = Date.UTC(2027, 10, 7, 8, 30); // 01:30 PDT
    expect(stationHourLabel(firstOneThirty, LA)).toBe("1:30 AM PDT");
    expect(stationHourLabel(firstOneThirty + HOUR_MS, LA)).toBe("1:30 AM PST");
  });

  it("does not zone-name unambiguous hours around the spring gap or in UTC", () => {
    expect(stationHourLabel(Date.UTC(2027, 2, 14, 9, 0), LA)).toBe("1 AM");
    expect(stationHourLabel(Date.UTC(2027, 2, 14, 10, 0), LA)).toBe("3 AM");
    expect(stationHourLabel(Date.UTC(2027, 2, 14, 8, 0), "UTC")).toBe("8 AM");
  });
});

describe("scheduleViewPreset", () => {
  it("formats day and hour headers with the station zone renderers", () => {
    const preset = scheduleViewPreset(LA) as { base: string; headers: { unit: string; renderer: (d: Date) => string }[] };
    expect(preset.base).toBe("hourAndDay");
    const [day, hour] = preset.headers;
    expect(day!.unit).toBe("day");
    expect(hour!.unit).toBe("hour");
    expect(hour!.renderer(new Date(Date.UTC(2026, 11, 6, 2, 0)))).toBe("6 PM");
    expect(day!.renderer(new Date(Date.UTC(2026, 11, 6, 2, 0)))).toBe("Sat, 12/05");
  });

  it("uses one slot-aligned grid for the night, so the header covers the whole chart", () => {
    const grid = buildNightGrid("2027-03-13", LA);
    expect(grid.startMs + grid.slotCount * SLOT_MS).toBe(Date.UTC(2027, 2, 14, 17, 0));
  });
});
