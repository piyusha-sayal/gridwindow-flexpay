import { describe, expect, it } from "vitest";
import { SLOT_MS } from "@/domain/units";
import { toChartEvents } from "@/app/operator/schedule/chartEvents";
import { buildScheduleModel, burstsForLane, type ProposalInput } from "@/app/operator/schedule/scheduleModel";
import { buildInjection, newEventId } from "@/app/operator/recoveryForm";
import type { ScheduleSessionView, ScheduleView } from "@/server/services/scheduleView";

const GRID = Date.UTC(2026, 0, 1, 22, 0);
const DEPART = GRID + 8 * SLOT_MS;

function session(reservationId: string, originalPowerW: number[]): ScheduleSessionView {
  return {
    reservationId,
    portId: "port_a",
    portLabel: "A",
    plugInMs: GRID,
    departMs: DEPART,
    effectiveDepartMs: DEPART,
    paymentState: "AUTHORIZED",
    serviceState: "SCHEDULED",
    currentVersion: 1,
    versions: [{ version: 1, source: "AGREED", createdAt: "", reason: "Accepted terms", powerW: originalPowerW }],
    originalPowerW,
    latestRun: null,
    pendingApproval: null,
  };
}

function view(sessions: ScheduleSessionView[], extra: Partial<ScheduleView> = {}): ScheduleView {
  return {
    nightOf: "2026-01-01",
    timeZone: "Europe/London",
    gridStartMs: GRID,
    slotMs: SLOT_MS,
    stationCapW: 10_000,
    ports: [{ id: "port_a", label: "A", maxPowerW: 3_600, tier: "Lower-power AC" }],
    sessions,
    disruptions: [],
    ...extra,
  };
}

const ORIGINAL = [2_000, 2_000, 0, 0, 0, 0, 0, 0];
const PROPOSAL: ProposalInput = {
  runId: "run_1",
  reservationId: "r1",
  portId: "port_a",
  powerW: [0, 0, 0, 0, 2_000, 2_000, 0, 0],
  effectiveDepartMs: DEPART,
};

describe("buildScheduleModel with proposals", () => {
  it("adds PROPOSAL bursts without changing the committed lanes", () => {
    const base = buildScheduleModel(view([session("r1", ORIGINAL)]));
    const withProposal = buildScheduleModel(view([session("r1", ORIGINAL)]), [PROPOSAL]);
    expect(burstsForLane(withProposal, "PROPOSAL")).toHaveLength(1);
    expect(burstsForLane(withProposal, "ORIGINAL")).toEqual(burstsForLane(base, "ORIGINAL"));
    expect(burstsForLane(withProposal, "CURRENT")).toEqual(burstsForLane(base, "CURRENT"));
  });

  it("changes the revision when a proposal appears, so the board can announce it", () => {
    const base = buildScheduleModel(view([session("r1", ORIGINAL)]));
    const withProposal = buildScheduleModel(view([session("r1", ORIGINAL)]), [PROPOSAL]);
    expect(withProposal.revision).not.toBe(base.revision);
  });

  it("ignores a proposal whose session is not on the night", () => {
    const model = buildScheduleModel(view([session("r1", ORIGINAL)]), [{ ...PROPOSAL, reservationId: "missing" }]);
    expect(burstsForLane(model, "PROPOSAL")).toHaveLength(0);
  });

  it("exposes the grid end as the start plus one bucket per capacity slot", () => {
    const model = buildScheduleModel(view([session("r1", ORIGINAL)]));
    expect(model.gridStartMs).toBe(GRID);
    expect(model.gridEndMs).toBe(GRID + ORIGINAL.length * SLOT_MS);
  });
});

describe("toChartEvents", () => {
  const model = buildScheduleModel(view([session("r1", ORIGINAL)]), [PROPOSAL]);

  it("shows only original bursts and occupancy on the ORIGINAL lane", () => {
    const events = toChartEvents(model, "ORIGINAL");
    expect(events.every((e) => e.cls !== "gw-burst-proposal" && e.cls !== "gw-burst-current")).toBe(true);
    expect(events.filter((e) => e.cls === "gw-burst-original")).toHaveLength(1);
    expect(events.filter((e) => e.cls === "gw-occupancy")).toHaveLength(1);
  });

  it("draws the proposal as a labelled, distinct event on the CURRENT lane", () => {
    const proposal = toChartEvents(model, "CURRENT").find((e) => e.cls === "gw-burst-proposal");
    expect(proposal).toBeDefined();
    expect(proposal!.name.startsWith("Proposal ")).toBe(true);
    expect(proposal!.startDate.getTime()).toBe(GRID + 4 * SLOT_MS);
    expect(proposal!.resourceId).toBe("port_a");
  });
});

describe("buildInjection", () => {
  const draft = { reservationId: "r1", effectiveSlot: 3 };

  it("maps each disturbance type to the params the server validates", () => {
    expect(buildInjection({ ...draft, type: "CHARGER_POWER_REDUCTION", value: 1800 }, DEPART, "evt-00000001")).toEqual({
      ok: true,
      request: { eventId: "evt-00000001", reservationId: "r1", type: "CHARGER_POWER_REDUCTION", effectiveSlot: 3, params: { maxPowerW: 1800 } },
    });
    expect(buildInjection({ ...draft, type: "SITE_CAP_REDUCTION", value: 9000 }, DEPART, "evt-00000002")).toMatchObject({ ok: true, request: { params: { stationCapW: 9000 } } });
    expect(buildInjection({ ...draft, type: "CHARGER_FAILURE", value: 0 }, DEPART, "evt-00000003")).toMatchObject({ ok: true, request: { params: {} } });
  });

  it("computes the early departure from the agreed departure", () => {
    const built = buildInjection({ ...draft, type: "EARLY_DEPARTURE", value: 30 }, DEPART, "evt-00000004");
    expect(built).toMatchObject({ ok: true, request: { params: { departMs: DEPART - 30 * 60_000 } } });
  });

  it("refuses non-positive, fractional or negative values before any request is sent", () => {
    expect(buildInjection({ ...draft, type: "CHARGER_POWER_REDUCTION", value: 0 }, DEPART, "evt-00000005").ok).toBe(false);
    expect(buildInjection({ ...draft, type: "SITE_CAP_REDUCTION", value: 12.5 }, DEPART, "evt-00000006").ok).toBe(false);
    expect(buildInjection({ ...draft, effectiveSlot: -1, type: "CHARGER_FAILURE", value: 0 }, DEPART, "evt-00000007").ok).toBe(false);
  });
});

describe("newEventId", () => {
  it("produces ids that satisfy the server's eventId rule and differ across calls", () => {
    const a = newEventId(Date.UTC(2026, 0, 1), () => 0.25);
    const b = newEventId(Date.UTC(2026, 0, 1), () => 0.75);
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(a).not.toBe(b);
  });
});
