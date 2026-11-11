/**
 * Schedule capacity semantics (audit I2 and I3).
 * The site limit is the station cap minus the safety headroom, the same limit the validator applies. Scheduled load is EV
 * demand plus the synthetic forecast base load. Only sessions that hold capacity count; released ones count for nothing.
 */
import { describe, expect, it } from "vitest";
import { holdsCapacity } from "@/domain/capacity";
import { PAYMENT_STATES, type PaymentState } from "@/domain/paymentState";
import { SLOT_MS } from "@/domain/units";
import { buildScheduleModel, recoveryRevisionKey, revisionKey, scheduleSummary, siteCapKwPerSlot } from "@/app/operator/schedule/scheduleModel";
import type { ScheduleSessionView, ScheduleView } from "@/server/services/scheduleView";

const GRID = Date.UTC(2026, 0, 1, 22, 0);
const SLOTS = 4;

function session(id: string, powerW: number[], over: Partial<ScheduleSessionView> = {}): ScheduleSessionView {
  return {
    reservationId: id,
    portId: "port_b",
    portLabel: "B",
    plugInMs: GRID,
    departMs: GRID + SLOTS * SLOT_MS,
    effectiveDepartMs: GRID + SLOTS * SLOT_MS,
    paymentState: "AUTHORIZED",
    serviceState: "SCHEDULED",
    slotsCommitted: true,
    currentVersion: 1,
    versions: [{ version: 1, source: "AGREED", createdAt: "", reason: "Accepted terms", powerW }],
    originalPowerW: powerW,
    latestRun: null,
    pendingApproval: null,
    ...over,
  };
}

function view(sessions: ScheduleSessionView[], extra: Partial<ScheduleView> = {}): ScheduleView {
  return {
    nightOf: "2026-01-01",
    timeZone: "Europe/London",
    gridStartMs: GRID,
    slotMs: SLOT_MS,
    stationCapW: 24_000,
    safetyHeadroomW: 1_000,
    forecastBaseLoadW: [0, 0, 0, 0],
    ports: [
      { id: "port_a", label: "A", maxPowerW: 3_600, tier: "Lower-power AC" },
      { id: "port_b", label: "B", maxPowerW: 7_200, tier: "Standard AC" },
      { id: "port_c", label: "C", maxPowerW: 11_000, tier: "Higher-power AC" },
    ],
    sessions,
    disruptions: [],
    ...extra,
  };
}

const RELEASED: { paymentState: PaymentState; slotsCommitted: boolean; serviceState: ScheduleSessionView["serviceState"] }[] = [
  { paymentState: "VOIDED", slotsCommitted: false, serviceState: "CANCELLED" },
  { paymentState: "FAILED", slotsCommitted: false, serviceState: "FAILED" },
  { paymentState: "CANCELLED", slotsCommitted: false, serviceState: "CANCELLED" },
  { paymentState: "QUOTE_ACCEPTED", slotsCommitted: false, serviceState: "AWAITING_PAYMENT" },
  { paymentState: "NEEDS_RECONCILIATION", slotsCommitted: false, serviceState: "AWAITING_PAYMENT" },
];

describe("holdsCapacity (I2)", () => {
  it("counts committed, captured, capture-pending and capture-declined sessions", () => {
    expect(holdsCapacity({ paymentState: "AUTHORIZED", slotsCommitted: true })).toBe(true);
    for (const paymentState of ["CAPTURED", "CAPTURE_PENDING", "CAPTURE_DECLINED"] as const) {
      expect(holdsCapacity({ paymentState, slotsCommitted: false })).toBe(true);
    }
  });

  it("releases voided, failed, cancelled and never-committed sessions", () => {
    for (const r of RELEASED) expect(holdsCapacity(r), r.paymentState).toBe(false);
  });

  it("is decided for every payment state when nothing is committed", () => {
    for (const paymentState of PAYMENT_STATES) {
      const held = holdsCapacity({ paymentState, slotsCommitted: false });
      expect(held, paymentState).toBe(["CAPTURED", "CAPTURE_PENDING", "CAPTURE_DECLINED"].includes(paymentState));
    }
  });
});

describe("scheduled demand excludes released sessions (I2)", () => {
  const active = session("act", [7_000, 7_000, 0, 0]);

  it("refreshes a polled schedule after lifecycle changes without claiming a recovery", () => {
    const before = view([active]);
    for (const change of [
      { slotsCommitted: false },
      { paymentState: "CAPTURED" as const },
      { serviceState: "DELIVERED" as const },
      { paymentState: "VOIDED" as const, slotsCommitted: false, serviceState: "FAILED" as const },
    ]) {
      const after = view([{ ...active, ...change }]);
      expect(revisionKey(after)).not.toBe(revisionKey(before));
      expect(recoveryRevisionKey(after)).toBe(recoveryRevisionKey(before));
    }
    expect(revisionKey(view([{ ...active }]))).toBe(revisionKey(before));
  });

  it("counts active demand and ignores voided, failed and cancelled sessions on the same slots", () => {
    const released = RELEASED.map((r, i) => session(`rel${i}`, [11_000, 11_000, 11_000, 0], { ...r, portId: "port_c" }));
    const model = buildScheduleModel(view([active, ...released]));
    expect(model.capacity.map((c) => c.drawKw)).toEqual([7, 7, 0, 0]);
    expect(model.capacity.some((c) => c.over)).toBe(false);
    expect(model.bursts.every((b) => b.sessionId === "act")).toBe(true);
    expect(model.occupancy.map((o) => o.sessionId)).toEqual(["act"]);
    expect(model.deadlines.map((d) => d.sessionId)).toEqual(["act"]);
  });

  it("keeps released sessions in the table, flagged, and says so in the summary", () => {
    const voided = session("v1", [11_000, 0, 0, 0], { paymentState: "VOIDED", slotsCommitted: false, serviceState: "CANCELLED" });
    const model = buildScheduleModel(view([active, voided]));
    expect(model.sessions.map((s) => [s.sessionId, s.holdsCapacity])).toEqual([["act", true], ["v1", false]]);
    expect(scheduleSummary(model)).toContain("1 sessions on 3 ports.");
    expect(scheduleSummary(model)).toContain("1 released (voided, failed or cancelled) and not counted as load.");
  });

  it("releases capacity when a session is voided: the same night goes from over the limit to within it", () => {
    const a = session("a", [11_000, 11_000, 0, 0], { portId: "port_c" });
    const b = session("b", [11_000, 11_000, 0, 0], { portId: "port_c" });
    const c = session("c", [7_000, 0, 0, 0]);
    expect(buildScheduleModel(view([a, b, c])).capacity.map((x) => x.over)).toEqual([true, false, false, false]);
    const voided = { ...c, paymentState: "VOIDED" as const, slotsCommitted: false, serviceState: "CANCELLED" as const };
    expect(buildScheduleModel(view([a, b, voided])).capacity.map((x) => x.over)).toEqual([false, false, false, false]);
  });

  it("counts a captured session whose commitment was released, because its energy was delivered", () => {
    const captured = session("cap", [7_000, 0, 0, 0], { paymentState: "CAPTURED", slotsCommitted: false, serviceState: "DELIVERED" });
    expect(buildScheduleModel(view([captured])).capacity[0]?.drawKw).toBe(7);
  });

  it("does not mutate the view or any payment or service state", () => {
    const sessions = [active, session("v", [1_000, 0, 0, 0], { paymentState: "VOIDED", slotsCommitted: false, serviceState: "CANCELLED" })];
    const v = view(sessions);
    const snapshot = JSON.stringify(v);
    buildScheduleModel(v);
    expect(JSON.stringify(v)).toBe(snapshot);
  });
});

describe("site limit semantics (I3)", () => {
  it("uses the station cap minus the safety headroom as the usable limit", () => {
    expect(siteCapKwPerSlot(view([session("a", [0, 0, 0, 0])]))).toEqual([23, 23, 23, 23]);
  });

  it("is not over exactly at the limit, and is over above it", () => {
    const at = buildScheduleModel(view([session("a", [11_000, 7_200, 3_600, 1_200])], { forecastBaseLoadW: [12_000, 15_800, 19_400, 21_800] }));
    expect(at.capacity.map((c) => c.drawKw + c.baseKw)).toEqual([23, 23, 23, 23]);
    expect(at.capacity.some((c) => c.over)).toBe(false);
    const above = buildScheduleModel(view([session("a", [11_000, 0, 0, 0])], { forecastBaseLoadW: [12_004, 0, 0, 0] }));
    expect(above.capacity[0]?.over).toBe(true);
  });

  it("adds the forecast base load to EV demand before comparing with the limit", () => {
    const sessions = [session("a", [11_000, 11_000, 0, 0], { portId: "port_c" })];
    expect(buildScheduleModel(view(sessions)).capacity.some((c) => c.over)).toBe(false);
    const withBase = buildScheduleModel(view(sessions, { forecastBaseLoadW: [13_000, 5_000, 0, 0] }));
    expect(withBase.capacity.map((c) => c.over)).toEqual([true, false, false, false]);
  });

  it("is below the limit with no demand and with demand under the limit", () => {
    expect(buildScheduleModel(view([session("a", [0, 0, 0, 0])])).capacity.some((c) => c.over)).toBe(false);
    expect(buildScheduleModel(view([session("a", [3_600, 0, 0, 0], { portId: "port_a" })])).capacity[0]).toMatchObject({ drawKw: 3.6, capKw: 23, over: false });
  });

  it("sums overlapping reservations across different port ratings", () => {
    const sessions = [
      session("a", [3_600, 3_600, 0, 0], { portId: "port_a" }),
      session("b", [7_200, 7_200, 0, 0]),
      session("c", [11_000, 11_000, 0, 0], { portId: "port_c" }),
    ];
    const model = buildScheduleModel(view(sessions));
    expect(model.capacity.map((c) => c.drawKw)).toEqual([21.8, 21.8, 0, 0]);
    expect(model.capacity.some((c) => c.over)).toBe(false);
    expect(buildScheduleModel(view(sessions, { forecastBaseLoadW: [1_300, 0, 0, 0] })).capacity[0]?.over).toBe(true);
  });

  it("lowers the usable limit from a site cap reduction, still net of headroom", () => {
    const reduced = view([session("a", [0, 0, 0, 0])], {
      disruptions: [{ eventId: "e", reservationId: "a", type: "SITE_CAP_REDUCTION", params: { stationCapW: 12_000 }, effectiveSlot: 2, createdAt: "", runStatus: null, runReason: null, attribution: "OPERATOR" }],
    });
    expect(siteCapKwPerSlot(reduced)).toEqual([23, 23, 11, 11]);
  });

  it("uses the recovered version as the current plan after a schedule change", () => {
    const recovered = session("a", [11_000, 11_000, 0, 0], {
      portId: "port_c",
      currentVersion: 2,
      versions: [
        { version: 1, source: "AGREED", createdAt: "", reason: "", powerW: [11_000, 11_000, 0, 0] },
        { version: 2, source: "RECOVERY", createdAt: "", reason: "", powerW: [0, 0, 11_000, 11_000] },
      ],
    });
    expect(buildScheduleModel(view([recovered])).capacity.map((c) => c.drawKw)).toEqual([0, 0, 11, 11]);
  });
});
