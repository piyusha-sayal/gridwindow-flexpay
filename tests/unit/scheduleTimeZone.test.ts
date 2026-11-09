import { describe, expect, it } from "vitest";
import { SLOT_MS } from "@/domain/units";
import { buildNightGrid } from "@/domain/time";
import { toChartEvents } from "@/app/operator/schedule/chartEvents";
import { buildScheduleModel, burstsForLane, timeLabel } from "@/app/operator/schedule/scheduleModel";
import type { ScheduleSessionView, ScheduleView } from "@/server/services/scheduleView";

const LA = "America/Los_Angeles";
const HOUR_MS = 3_600_000;

/** Spring forward: Sunday 2026-03-08 02:00 PST becomes 03:00 PDT. The night of 2026-03-07 contains it. */
const SPRING_NIGHT = "2026-03-07";
/** Fall back: Sunday 2026-11-01 02:00 PDT becomes 01:00 PST. The night of 2026-10-31 contains it. */
const FALL_NIGHT = "2026-10-31";

function viewFor(nightOf: string, sessions: ScheduleSessionView[]): ScheduleView {
  const grid = buildNightGrid(nightOf, LA);
  return {
    nightOf,
    timeZone: LA,
    gridStartMs: grid.startMs,
    slotMs: SLOT_MS,
    stationCapW: 20_000,
    ports: [{ id: "port_a", label: "A", maxPowerW: 3_600, tier: "Lower-power AC" }],
    sessions,
    disruptions: [],
  } as ScheduleView;
}

function sessionAt(gridStartMs: number, slotCount: number, powerSlots: Record<number, number>): ScheduleSessionView {
  const originalPowerW = new Array<number>(slotCount).fill(0);
  for (const [slot, w] of Object.entries(powerSlots)) originalPowerW[Number(slot)] = w;
  return {
    reservationId: "r1",
    portId: "port_a",
    portLabel: "A",
    plugInMs: gridStartMs,
    departMs: gridStartMs + slotCount * SLOT_MS,
    effectiveDepartMs: gridStartMs + slotCount * SLOT_MS,
    paymentState: "AUTHORIZED",
    serviceState: "SCHEDULED",
    currentVersion: 1,
    versions: [{ version: 1, source: "AGREED", createdAt: "", reason: "", powerW: originalPowerW }],
    originalPowerW,
  } as ScheduleSessionView;
}

describe("station time zone grid around DST transitions", () => {
  it("spring-forward night is 15 elapsed hours (60 slots), not 16", () => {
    const grid = buildNightGrid(SPRING_NIGHT, LA);
    expect(grid.slotCount).toBe(60);
    expect(grid.startMs).toBe(Date.UTC(2026, 2, 8, 2, 0)); // 18:00 PST
    expect(grid.startMs + grid.slotCount * SLOT_MS).toBe(Date.UTC(2026, 2, 8, 17, 0)); // 10:00 PDT
  });

  it("fall-back night is 17 elapsed hours (68 slots), not 16", () => {
    const grid = buildNightGrid(FALL_NIGHT, LA);
    expect(grid.slotCount).toBe(68);
    expect(grid.startMs).toBe(Date.UTC(2026, 10, 1, 1, 0)); // 18:00 PDT
    expect(grid.startMs + grid.slotCount * SLOT_MS).toBe(Date.UTC(2026, 10, 1, 18, 0)); // 10:00 PST
  });

  it("the night of 2026-11-01 starts after the transition and is 16 elapsed hours (64 slots)", () => {
    const grid = buildNightGrid("2026-11-01", LA);
    expect(grid.slotCount).toBe(64);
    expect(timeLabel(grid.startMs, LA)).toBe("18:00");
  });
});

describe("chart events map by absolute epoch milliseconds", () => {
  it("spring forward: the 03:00 PDT slot is labelled 03:00 and no 02:xx label exists on the grid", () => {
    const grid = buildNightGrid(SPRING_NIGHT, LA);
    const labels = Array.from({ length: grid.slotCount }, (_, i) => timeLabel(grid.startMs + i * SLOT_MS, LA));
    expect(labels).not.toContain("02:00");
    expect(labels.filter((l) => l === "02:30")).toHaveLength(0);
    expect(timeLabel(grid.startMs + 32 * SLOT_MS, LA)).toBe("03:00");
  });

  it("fall back: the repeated 01:00 hour yields two distinct events one real hour apart", () => {
    const grid = buildNightGrid(FALL_NIGHT, LA);
    const firstOne = grid.startMs + 28 * SLOT_MS; // 01:00 PDT
    const secondOne = grid.startMs + 32 * SLOT_MS; // 01:00 PST
    expect(timeLabel(firstOne, LA)).toBe("01:00");
    expect(timeLabel(secondOne, LA)).toBe("01:00");
    expect(secondOne - firstOne).toBe(HOUR_MS);
  });

  it("a burst inside the repeated hour keeps its absolute start and end", () => {
    const grid = buildNightGrid(FALL_NIGHT, LA);
    const session = sessionAt(grid.startMs, grid.slotCount, { 30: 2_000, 31: 2_000, 32: 2_000 });
    const model = buildScheduleModel(viewFor(FALL_NIGHT, [session]));
    const [burst] = burstsForLane(model, "ORIGINAL");
    expect(burst!.startMs).toBe(grid.startMs + 30 * SLOT_MS);
    expect(burst!.endMs).toBe(grid.startMs + 33 * SLOT_MS);
    const event = toChartEvents(model, "ORIGINAL").find((e) => e.id === burst!.id)!;
    expect(event.startDate.getTime()).toBe(burst!.startMs);
    expect(event.endDate.getTime()).toBe(burst!.endMs);
  });

  it("occupancy across the fall-back transition spans four real hours, not three wall-clock hours", () => {
    const from = Date.UTC(2026, 10, 1, 7, 0); // 00:00 PDT
    const to = Date.UTC(2026, 10, 1, 11, 0); // 03:00 PST
    const session = { ...sessionAt(from, 16, {}), plugInMs: from, departMs: to, effectiveDepartMs: to };
    const model = buildScheduleModel({ ...viewFor(FALL_NIGHT, [session]), gridStartMs: from });
    const occupancy = toChartEvents(model, "ORIGINAL").find((e) => e.id.endsWith(":occupancy"))!;
    expect(occupancy.endDate.getTime() - occupancy.startDate.getTime()).toBe(4 * HOUR_MS);
  });

  it("labels use the station zone, not the process zone", () => {
    const ms = Date.UTC(2026, 2, 8, 9, 0); // 01:00 PST
    expect(timeLabel(ms, LA)).toBe("01:00");
    expect(timeLabel(ms, "UTC")).toBe("09:00");
  });
});

describe("table and chart read the same data", () => {
  it("the table's current kWh equals the sum of the chart's burst energy for each session", () => {
    const grid = buildNightGrid(SPRING_NIGHT, LA);
    const session = sessionAt(grid.startMs, grid.slotCount, { 0: 3_000, 1: 3_000, 2: 1_500, 10: 2_000 });
    const model = buildScheduleModel(viewFor(SPRING_NIGHT, [session]));
    const chartKwh = burstsForLane(model, "ORIGINAL").reduce((sum, b) => sum + b.kWh, 0);
    expect(model.sessions[0]!.originalKwh).toBeCloseTo(chartKwh, 9);
    expect(toChartEvents(model, "ORIGINAL").filter((e) => e.cls === "gw-burst-original")).toHaveLength(2);
  });
});
