import { describe, expect, it } from "vitest";
import { SLOT_MS } from "@/domain/units";
import { buildNightGrid } from "@/domain/time";
import { toChartEvents } from "@/app/operator/schedule/chartEvents";
import { buildScheduleModel, burstsForLane, scheduleSummary } from "@/app/operator/schedule/scheduleModel";
import type { ScheduleDisruptionView, ScheduleSessionView, ScheduleView } from "@/server/services/scheduleView";

const LA = "America/Los_Angeles";
const NIGHT = "2026-12-05";
const grid = buildNightGrid(NIGHT, LA);

/** Versions are the recovered powerW lists, in order (version 2, 3, ...). */
function session(versions: number[][] = []): ScheduleSessionView {
  const originalPowerW = new Array<number>(grid.slotCount).fill(0);
  for (const [slot, w] of Object.entries({ 0: 3_000, 1: 3_000 })) originalPowerW[Number(slot)] = w;
  const versionViews = versions.map((powerW, i) => ({ version: i + 2, source: "RECOVERY" as const, createdAt: "", reason: "Recovered", powerW }));
  return {
    reservationId: "r1",
    portId: "port_a",
    portLabel: "A",
    plugInMs: grid.startMs,
    departMs: grid.startMs + grid.slotCount * SLOT_MS,
    effectiveDepartMs: grid.startMs + grid.slotCount * SLOT_MS,
    paymentState: "AUTHORIZED",
    slotsCommitted: true,
    serviceState: "SCHEDULED",
    currentVersion: versions.length > 0 ? versions.length + 1 : 1,
    versions: [{ version: 1, source: "AGREED", createdAt: "", reason: "Accepted terms", powerW: originalPowerW }, ...versionViews],
    originalPowerW,
    latestRun: null,
    pendingApproval: null,
  } as ScheduleSessionView;
}

function view(sessions: ScheduleSessionView[], disruptions: ScheduleDisruptionView[] = []): ScheduleView {
  return {
    nightOf: NIGHT,
    timeZone: LA,
    gridStartMs: grid.startMs,
    slotMs: SLOT_MS,
    stationCapW: 20_000,
    safetyHeadroomW: 0,
    forecastBaseLoadW: [],
    ports: [{ id: "port_a", label: "A", maxPowerW: 3_600, tier: "Lower-power AC" }],
    sessions,
    disruptions,
  } as ScheduleView;
}

/** A recovered version that delivers 1 kW in slots 0-3 instead of the agreed 3 kW in slots 0-1. */
const RECOVERED = [1_000, 1_000, 1_000, 1_000];
const recoveredPower = [...RECOVERED, ...new Array<number>(grid.slotCount - 4).fill(0)];

describe("before and after a recovered version", () => {
  it("the table shows the original and current energy separately, and the chart keeps both lanes", () => {
    const model = buildScheduleModel(view([session([recoveredPower])]));
    const row = model.sessions[0]!;
    expect(row.recovered).toBe(true);
    expect(row.originalKwh).not.toBeCloseTo(row.currentKwh, 6);
    expect(burstsForLane(model, "ORIGINAL").every((b) => !b.recovered)).toBe(true);
    expect(burstsForLane(model, "CURRENT").every((b) => b.recovered)).toBe(true);
    const current = toChartEvents(model, "CURRENT").find((e) => e.cls === "gw-burst-current")!;
    expect(current.name.startsWith("Recovered ")).toBe(true);
    const original = toChartEvents(model, "ORIGINAL").find((e) => e.cls === "gw-burst-original")!;
    expect(original.name.startsWith("Charging ")).toBe(true);
  });

  it("a session with no recovered version has identical original and current energy", () => {
    const model = buildScheduleModel(view([session()]));
    expect(model.sessions[0]!.recovered).toBe(false);
    expect(model.sessions[0]!.currentKwh).toBeCloseTo(model.sessions[0]!.originalKwh, 9);
  });
});

describe("a pending proposal is shown as proposed, never as committed", () => {
  const proposal = { runId: "run-1", reservationId: "r1", portId: "port_a", powerW: recoveredPower, effectiveDepartMs: grid.startMs + grid.slotCount * SLOT_MS };

  it("adds a PROPOSAL burst but leaves the committed table and lanes unchanged", () => {
    const base = buildScheduleModel(view([session()]));
    const withProposal = buildScheduleModel(view([session()]), [proposal]);
    expect(burstsForLane(withProposal, "PROPOSAL").length).toBeGreaterThan(0);
    expect(withProposal.sessions[0]!.currentKwh).toBeCloseTo(base.sessions[0]!.currentKwh, 9);
    expect(withProposal.sessions[0]!.recovered).toBe(false);
    expect(burstsForLane(withProposal, "CURRENT")).toEqual(burstsForLane(base, "CURRENT"));
  });

  it("labels the proposal as a proposal in the chart, not as a recovered plan", () => {
    const model = buildScheduleModel(view([session()]), [proposal]);
    const proposed = toChartEvents(model, "CURRENT").filter((e) => e.cls === "gw-burst-proposal");
    expect(proposed.length).toBeGreaterThan(0);
    expect(proposed.every((e) => e.name.startsWith("Proposal "))).toBe(true);
    expect(toChartEvents(model, "ORIGINAL").some((e) => e.cls === "gw-burst-proposal")).toBe(false);
  });

  it("counts the proposal in the plain-English summary as not committed", () => {
    const model = buildScheduleModel(view([session()]), [proposal]);
    expect(model.pendingProposals).toBe(1);
    expect(scheduleSummary(model)).toContain("1 proposal(s) awaiting driver approval, not committed.");
  });

  it("reports no pending proposals when none exist", () => {
    const model = buildScheduleModel(view([session()]));
    expect(model.pendingProposals).toBe(0);
    expect(scheduleSummary(model)).not.toContain("not committed");
  });

  it("ignores a proposal whose session is not on this night", () => {
    const model = buildScheduleModel(view([session()]), [{ ...proposal, reservationId: "other" }]);
    expect(model.pendingProposals).toBe(0);
    expect(burstsForLane(model, "PROPOSAL")).toHaveLength(0);
  });
});

describe("why a recovery run ended the way it did", () => {
  it("passes the persisted run reason through to the disruption list", () => {
    const disruption = {
      eventId: "e1",
      reservationId: "r1",
      type: "SITE_CAP_REDUCTION",
      params: { stationCapW: 5_000 },
      effectiveSlot: 4,
      createdAt: "",
      attribution: "UNKNOWN",
      runStatus: "INFEASIBLE",
      runReason: "No charging plan meets the agreed departure with the reduced site cap.",
    } as ScheduleDisruptionView;
    const model = buildScheduleModel(view([session()], [disruption]));
    expect(model.disruptions[0]).toMatchObject({ runStatus: "INFEASIBLE", runReason: disruption.runReason });
  });
});
