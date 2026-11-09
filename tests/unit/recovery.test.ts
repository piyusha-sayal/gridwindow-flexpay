import { describe, expect, it } from "vitest";
import { validatePlans } from "@/domain/validator";
import { DEMO_STATION, type SessionPlan } from "@/domain/station";
import { recoverSession, snapshotSession } from "@/domain/recovery";
import { fixture, planningContext, readyBy, RESERVATION } from "./recoveryFixture";
import type { DisturbanceRecord } from "@/domain/disturbance";

const f = fixture();
const grid = f.scenario.grid;
const base = f.scenario.forecastBaseLoadW;

function record(over: Partial<DisturbanceRecord>): DisturbanceRecord {
  return { reservationId: RESERVATION, portId: "port_c", type: "CHARGER_FAILURE", effectiveSlot: 0, params: {}, ...over };
}

/** Index of the first charging slot in the agreed plan. */
const firstCharge = f.session.agreedPowerW.findIndex((w) => w > 0);
const lastCharge = f.session.agreedPowerW.reduce((last, w, i) => (w > 0 ? i : last), -1);

describe("snapshotSession", () => {
  it("has delivered nothing and the full target remaining before the first slot", () => {
    const ctx = planningContext(f.scenario);
    const snap = snapshotSession(ctx, f.session, 0);
    expect(snap.deliveredBatteryMilliWh).toBe(0);
    expect(snap.remainingBatteryWh).toBe(f.session.targetBatteryWh);
    expect(snap.departMs).toBe(f.session.agreedDepartMs);
  });

  it("has the whole target delivered once every agreed charging slot is in the past", () => {
    const ctx = planningContext(f.scenario);
    const snap = snapshotSession(ctx, f.session, lastCharge + 1);
    expect(snap.remainingBatteryWh).toBe(0);
    expect(snap.deliveredBatteryMilliWh).toBeGreaterThanOrEqual(f.session.targetBatteryWh * 1000);
  });

  it("uses the effective departure when an early departure is recorded", () => {
    const early = f.session.agreedDepartMs - 3_600_000;
    const ctx = planningContext(f.scenario, [record({ type: "EARLY_DEPARTURE", effectiveSlot: 0, params: { departMs: early } })]);
    expect(snapshotSession(ctx, f.session, 0).departMs).toBe(early);
  });
});

describe("recoverSession", () => {
  it("returns the unchanged schedule as auto-committable when the disturbance comes after charging ended", () => {
    const ctx = planningContext(f.scenario, [record({ type: "CHARGER_FAILURE", effectiveSlot: lastCharge + 1 })]);
    const result = recoverSession(ctx, f.session, snapshotSession(ctx, f.session, lastCharge + 1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates.every((c) => c.unchanged)).toBe(true);
    expect(result.candidates.every((c) => c.consent.decision === "AUTO_COMMIT")).toBe(true);
  });

  it("keeps energy already delivered before the effective slot exactly as it was", () => {
    const eff = firstCharge + 2;
    const ctx = planningContext(f.scenario, [record({ type: "CHARGER_POWER_REDUCTION", effectiveSlot: eff, params: { maxPowerW: 7_200 } })]);
    const result = recoverSession(ctx, f.session, snapshotSession(ctx, f.session, eff));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const c of result.candidates) expect(c.powerW.slice(0, eff)).toEqual(f.session.currentPowerW.slice(0, eff));
  });

  it("re-plans a power reduction into a feasible, gentler schedule that respects the reduced limit", () => {
    const eff = firstCharge + 2;
    const ctx = planningContext(f.scenario, [record({ type: "CHARGER_POWER_REDUCTION", effectiveSlot: eff, params: { maxPowerW: 7_200 } })]);
    const result = recoverSession(ctx, f.session, snapshotSession(ctx, f.session, eff));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates) {
      expect(Math.max(...c.powerW.slice(eff))).toBeLessThanOrEqual(7_200);
      const violations = validatePlans(DEMO_STATION, grid, base, [{ sessionId: RESERVATION, portId: "port_c", plugInMs: f.session.plugInMs, departMs: f.session.agreedDepartMs, powerW: c.powerW }], [
        { sessionId: RESERVATION, targetBatteryWh: f.session.targetBatteryWh, efficiencyBp: f.session.efficiencyBp },
      ]);
      expect(violations).toEqual([]);
    }
  });

  it("only asks for approval when the lowest-cost recovery finishes later than the agreed ready-by time", () => {
    const eff = firstCharge + 2;
    const ctx = planningContext(f.scenario, [record({ type: "CHARGER_POWER_REDUCTION", effectiveSlot: eff, params: { maxPowerW: 7_200 } })]);
    const result = recoverSession(ctx, f.session, snapshotSession(ctx, f.session, eff));
    if (!result.ok) throw new Error("expected a feasible recovery");
    const lowest = result.candidates.find((c) => c.preference === "flex_lowest_cost")!;
    const finishesLater = (lowest.chargeEndMs ?? 0) > readyBy(f);
    expect(lowest.consent.decision === "NEEDS_DRIVER_APPROVAL").toBe(finishesLater);
    expect(lowest.consent.decision).not.toBe("NOT_ALLOWED");
  });

  it("limits a site-capacity reduction so the site draw never exceeds the reduced cap", () => {
    const eff = firstCharge;
    const cap = 12_000;
    const ctx = planningContext(f.scenario, [record({ type: "SITE_CAP_REDUCTION", portId: "port_a", effectiveSlot: eff, params: { stationCapW: cap } })]);
    const result = recoverSession(ctx, f.session, snapshotSession(ctx, f.session, eff));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const c of result.candidates) {
      c.powerW.forEach((w, i) => {
        if (i < eff) return;
        expect(w + base[i]!).toBeLessThanOrEqual(cap - DEMO_STATION.safetyHeadroomW);
      });
    }
  });

  it("reports a failed charger as infeasible without moving the vehicle to another port", () => {
    const eff = firstCharge;
    const ctx = planningContext(f.scenario, [record({ type: "CHARGER_FAILURE", effectiveSlot: eff })]);
    const result = recoverSession(ctx, f.session, snapshotSession(ctx, f.session, eff));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.binding).toBe("PORT_FAILED");
    expect(result.message).toMatch(/failed/);
    expect(result.message).toMatch(/nothing was moved/);
  });

  it("reports an earlier departure that leaves no time as a time constraint", () => {
    const ctx = planningContext(f.scenario, [record({ type: "EARLY_DEPARTURE", effectiveSlot: firstCharge, params: { departMs: f.session.plugInMs + 1_800_000 } })]);
    const result = recoverSession(ctx, f.session, snapshotSession(ctx, f.session, firstCharge));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.binding).toBe("TIME");
  });

  it("treats an earlier departure as a material change that needs driver approval", () => {
    const early = f.session.agreedDepartMs - 1_800_000;
    const eff = firstCharge;
    const ctx = planningContext(f.scenario, [record({ type: "EARLY_DEPARTURE", effectiveSlot: eff, params: { departMs: early } })]);
    const result = recoverSession(ctx, f.session, snapshotSession(ctx, f.session, eff));
    if (!result.ok) throw new Error("expected a feasible early-departure recovery");
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates) {
      expect(c.consent.decision).toBe("NEEDS_DRIVER_APPROVAL");
      expect(c.consent.reasons.join(" ")).toMatch(/departure/);
    }
  });

  it("never changes the agreed price", () => {
    const eff = firstCharge + 2;
    const ctx = planningContext(f.scenario, [record({ type: "CHARGER_POWER_REDUCTION", effectiveSlot: eff, params: { maxPowerW: 7_200 } })]);
    const result = recoverSession(ctx, f.session, snapshotSession(ctx, f.session, eff));
    if (!result.ok) throw new Error("expected a feasible recovery");
    for (const c of result.candidates) {
      expect(c.priceCents).toBe(f.session.amountCents);
      expect(c.priceChangeCents).toBe(0);
    }
  });

  it("keeps other sessions' committed load inside the site cap", () => {
    const eff = firstCharge;
    const cap = 14_000;
    const other: SessionPlan = {
      sessionId: "res_other",
      portId: "port_b",
      plugInMs: f.session.plugInMs,
      departMs: f.session.agreedDepartMs,
      powerW: Array.from({ length: grid.slotCount }, (_, i) => (i >= firstCharge && i < firstCharge + 8 ? 7_200 : 0)),
    };
    const ctx = planningContext(f.scenario, [record({ type: "SITE_CAP_REDUCTION", portId: "port_a", effectiveSlot: 0, params: { stationCapW: cap } })], [other]);
    const result = recoverSession(ctx, f.session, snapshotSession(ctx, f.session, eff));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const c of result.candidates) {
      c.powerW.forEach((w, i) => {
        expect(w + other.powerW[i]! + base[i]!).toBeLessThanOrEqual(cap - DEMO_STATION.safetyHeadroomW);
      });
    }
  });

  it("rejects every schedule that would cost the operator its minimum contribution", () => {
    const shifted = { ...f.session, baselineEnergyCostCents: 1 };
    const ctx = planningContext(f.scenario, [record({ type: "CHARGER_POWER_REDUCTION", effectiveSlot: firstCharge, params: { maxPowerW: 7_200 } })]);
    const result = recoverSession(ctx, shifted, snapshotSession(ctx, shifted, firstCharge));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.binding).toBe("OPERATOR_ECONOMICS");
  });
});
