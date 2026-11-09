import { describe, expect, it } from "vitest";
import { decideConsent, type ConsentInput } from "@/domain/recoveryConsent";

const AGREED = 1_000_000;
const unchanged: ConsentInput = {
  forecastEnergyMet: true,
  agreedAmountCents: 480,
  proposedAmountCents: 480,
  agreedDepartMs: AGREED,
  proposedDepartMs: AGREED,
  agreedReadyByMs: AGREED - 3_600_000,
  proposedFinishMs: AGREED - 3_600_000,
  withinPluggedWindow: true,
  pastUnchanged: true,
  otherSessionsChanged: false,
};

describe("decideConsent", () => {
  it("auto-commits when energy, departure, price and finish are unchanged", () => {
    expect(decideConsent(unchanged)).toEqual({ decision: "AUTO_COMMIT", reasons: [] });
  });

  it("auto-commits an earlier finish that keeps the agreed departure and price", () => {
    expect(decideConsent({ ...unchanged, proposedFinishMs: AGREED - 7_200_000 }).decision).toBe("AUTO_COMMIT");
  });

  it("needs driver approval for an earlier departure, even when everything else holds", () => {
    const d = decideConsent({ ...unchanged, proposedDepartMs: AGREED - 3_600_000 });
    expect(d.decision).toBe("NEEDS_DRIVER_APPROVAL");
    expect(d.reasons.join(" ")).toMatch(/departure/);
  });

  it("needs driver approval when charging finishes later than the agreed ready-by time", () => {
    const d = decideConsent({ ...unchanged, proposedFinishMs: AGREED - 1_800_000 });
    expect(d.decision).toBe("NEEDS_DRIVER_APPROVAL");
    expect(d.reasons.join(" ")).toMatch(/ready-by/);
  });

  it("needs driver approval for any price change, including a decrease", () => {
    expect(decideConsent({ ...unchanged, proposedAmountCents: 470 }).decision).toBe("NEEDS_DRIVER_APPROVAL");
  });

  it("never allows a price increase", () => {
    const d = decideConsent({ ...unchanged, proposedAmountCents: 481 });
    expect(d.decision).toBe("NOT_ALLOWED");
    expect(d.reasons.join(" ")).toMatch(/price would increase/);
  });

  it("never allows a later departure than the agreed one", () => {
    expect(decideConsent({ ...unchanged, proposedDepartMs: AGREED + 60_000 }).decision).toBe("NOT_ALLOWED");
  });

  it("never allows the forecast plan to fall short of the agreed energy", () => {
    expect(decideConsent({ ...unchanged, forecastEnergyMet: false }).decision).toBe("NOT_ALLOWED");
  });

  it("never allows charging outside the original plugged-in window", () => {
    expect(decideConsent({ ...unchanged, withinPluggedWindow: false }).decision).toBe("NOT_ALLOWED");
  });

  it("never allows energy already delivered to change", () => {
    expect(decideConsent({ ...unchanged, pastUnchanged: false }).decision).toBe("NOT_ALLOWED");
  });

  it("never allows another session's schedule to change", () => {
    expect(decideConsent({ ...unchanged, otherSessionsChanged: true }).decision).toBe("NOT_ALLOWED");
  });

  it("reports every hard violation, not only the first", () => {
    const d = decideConsent({ ...unchanged, proposedAmountCents: 999, otherSessionsChanged: true });
    expect(d.decision).toBe("NOT_ALLOWED");
    expect(d.reasons).toHaveLength(2);
  });
});
