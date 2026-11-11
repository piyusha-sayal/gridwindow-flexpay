import { describe, expect, it } from "vitest";
import { SLOT_MS } from "@/domain/units";
import { buildScheduleModel, burstsForLane, currentPowerW, deriveBursts, scheduleSummary, siteCapKwPerSlot, slotsToKwh } from "@/app/operator/schedule/scheduleModel";
import type { ScheduleView, ScheduleSessionView } from "@/server/services/scheduleView";

const GRID = Date.UTC(2026, 0, 1, 22, 0);

function session(overrides: Partial<ScheduleSessionView> & { reservationId: string; originalPowerW: number[] }): ScheduleSessionView {
  return {
    portId: "port_a",
    portLabel: "A",
    plugInMs: GRID,
    departMs: GRID + 8 * SLOT_MS,
    effectiveDepartMs: GRID + 8 * SLOT_MS,
    paymentState: "CAPTURED",
    serviceState: "DELIVERED",
    currentVersion: 1,
    versions: [{ version: 1, source: "AGREED", createdAt: "2026-01-01T00:00:00.000Z", reason: "Accepted terms", powerW: overrides.originalPowerW }],
    ...overrides,
  } as ScheduleSessionView;
}

function view(sessions: ScheduleSessionView[], extra: Partial<ScheduleView> = {}): ScheduleView {
  return {
    nightOf: "2026-01-01",
    timeZone: "Europe/London",
    gridStartMs: GRID,
    slotMs: SLOT_MS,
    stationCapW: 10_000,
    safetyHeadroomW: 0,
    forecastBaseLoadW: [],
    ports: [
      { id: "port_a", label: "A", maxPowerW: 3_600, tier: "Lower-power AC" },
      { id: "port_b", label: "B", maxPowerW: 7_200, tier: "Standard AC" },
    ],
    sessions,
    disruptions: [],
    ...extra,
  };
}

describe("deriveBursts", () => {
  it("splits contiguous nonzero slots into separate bursts with kW and kWh", () => {
    const bursts = deriveBursts({ reservationId: "r1", portId: "port_a", effectiveDepartMs: GRID + 10 * SLOT_MS }, [0, 2_000, 2_000, 0, 1_000, 0, 0, 0, 0, 0], "ORIGINAL", GRID, false);
    expect(bursts).toHaveLength(2);
    expect(bursts[0]).toMatchObject({ startMs: GRID + SLOT_MS, endMs: GRID + 3 * SLOT_MS, peakKw: 2, pastDeparture: false });
    expect(bursts[0]!.kWh).toBeCloseTo(1, 6);
    expect(bursts[1]!.kWh).toBeCloseTo(0.25, 6);
  });

  it("flags energy delivered after the effective departure", () => {
    const bursts = deriveBursts({ reservationId: "r1", portId: "port_a", effectiveDepartMs: GRID + 2 * SLOT_MS }, [1_000, 1_000, 1_000], "CURRENT", GRID, true);
    expect(bursts[0]).toMatchObject({ pastDeparture: true, recovered: true });
  });
});

describe("slotsToKwh", () => {
  it("converts watt-slots to kWh at 15 minutes per slot", () => {
    expect(slotsToKwh(4_000)).toBeCloseTo(1, 9);
    expect(slotsToKwh(0)).toBe(0);
  });
});

describe("currentPowerW", () => {
  it("uses the latest committed version and falls back to the agreed plan", () => {
    const s = session({
      reservationId: "r1",
      originalPowerW: [1_000, 0],
      currentVersion: 2,
      versions: [
        { version: 1, source: "AGREED", createdAt: "", reason: "", powerW: [1_000, 0] },
        { version: 2, source: "RECOVERY", createdAt: "", reason: "", powerW: [0, 1_000] },
      ],
    });
    expect(currentPowerW(s)).toEqual([0, 1_000]);
    expect(currentPowerW({ ...s, currentVersion: 9 })).toEqual([1_000, 0]);
  });
});

describe("buildScheduleModel", () => {
  const recovered = session({
    reservationId: "r1",
    originalPowerW: [3_000, 3_000, 0, 0],
    currentVersion: 2,
    effectiveDepartMs: GRID + 2 * SLOT_MS,
    departMs: GRID + 4 * SLOT_MS,
    versions: [
      { version: 1, source: "AGREED", createdAt: "", reason: "", powerW: [3_000, 3_000, 0, 0] },
      { version: 2, source: "RECOVERY", createdAt: "", reason: "", powerW: [0, 0, 3_000, 0] },
    ],
  });
  const other = session({ reservationId: "r2", portId: "port_b", originalPowerW: [0, 0, 0, 0] });
  const model = buildScheduleModel(
    view([recovered, other], {
      disruptions: [
        { eventId: "evt-1", reservationId: "r1", type: "SITE_CAP_REDUCTION", params: { stationCapW: 2_000 }, effectiveSlot: 2, createdAt: "", runStatus: "COMPLETED", runReason: null, attribution: "OPERATOR" },
      ],
    }),
  );

  it("produces both lanes and keeps recovered bursts distinct", () => {
    expect(burstsForLane(model, "ORIGINAL").filter((b) => b.sessionId === "r1")).toHaveLength(1);
    const current = burstsForLane(model, "CURRENT").filter((b) => b.sessionId === "r1");
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ recovered: true, startMs: GRID + 2 * SLOT_MS });
  });

  it("marks shortened departures and the disruption time", () => {
    expect(model.sessions.find((s) => s.sessionId === "r1")).toMatchObject({ departureShortened: true, recovered: true });
    expect(model.deadlines.find((d) => d.sessionId === "r1")).toMatchObject({ shortened: true, atMs: GRID + 2 * SLOT_MS });
    expect(model.disruptions[0]).toMatchObject({ eventId: "evt-1", atMs: GRID + 2 * SLOT_MS, runStatus: "COMPLETED" });
  });

  it("maps resources with rated kW and computes capacity per slot", () => {
    expect(model.resources[0]).toMatchObject({ id: "port_a", ratedKw: 3.6 });
    expect(model.capacity.map((c) => c.capKw)).toEqual([10, 10, 2, 2]);
    expect(model.capacity[2]).toMatchObject({ drawKw: 3, over: true });
    expect(model.capacity[0]).toMatchObject({ drawKw: 0, over: false });
  });

  it("builds a plain-English summary and a stable revision key", () => {
    expect(scheduleSummary(model)).toBe("2 sessions on 2 ports. 1 recovered, 1 with shortened departure, 1 time slot(s) over the site limit.");
    expect(buildScheduleModel(view([recovered, other])).revision).not.toBe(model.revision);
    expect(buildScheduleModel(view([recovered, other], { disruptions: [] })).revision).toBe(buildScheduleModel(view([recovered, other], { disruptions: [] })).revision);
  });

  it("caps never rise above the station cap", () => {
    expect(siteCapKwPerSlot(view([recovered]))).toEqual([10, 10, 10, 10]);
  });
});
