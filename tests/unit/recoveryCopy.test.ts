import { describe, expect, it } from "vitest";
import { approvedRunReason, deterministicExplanation, type NarrativeFacts } from "@/server/services/recoveryNarrative";
import { runStatusLabel } from "@/components/recoveryCopy";

const facts: NarrativeFacts = {
  eventKind: "EARLY_DEPARTURE",
  eventLabel: "An earlier departure",
  chargerLabel: "Port B (7.2 kW)",
  effectiveAt: "6:00 PM",
  effectiveDeparture: "6:00 AM",
  price: "$9.00",
};

describe("QA-5: early departure names the new departure, not the event time", () => {
  it("states the new departure and never 'earlier departure at <event time>'", () => {
    const text = deterministicExplanation("NEEDS_APPROVAL", facts);
    expect(text).toContain("Your departure moved to 6:00 AM");
    expect(text).not.toMatch(/earlier departure at/i);
  });
  it("keeps 'at <time>' wording for power and capacity events", () => {
    const text = deterministicExplanation("COMMITTED", { ...facts, eventKind: "CHARGER_POWER_REDUCTION", eventLabel: "Charger power reduced" });
    expect(text).toContain("Charger power reduced at 6:00 PM");
  });
});

describe("QA-4: after the driver approves, nothing says it recovered automatically or awaits approval", () => {
  const stale = deterministicExplanation("NEEDS_APPROVAL", facts);
  it("rewrites the proposal-time narrative", () => {
    const text = approvedRunReason(stale);
    expect(text).toContain("You approved this change");
    expect(text).not.toMatch(/Nothing changes until you approve|needs your approval/i);
  });
  it("labels a driver-approved committed run as approved by the driver", () => {
    expect(runStatusLabel("COMMITTED", { method: "DRIVER_APPROVED" })).toBe("Approved by you and applied");
    expect(runStatusLabel("COMMITTED", { method: "AUTO_WITHIN_PRE_APPROVED_BOUNDS" })).toBe("Recovered automatically");
    expect(runStatusLabel("NEEDS_APPROVAL", null)).toBe("Waiting for your approval");
  });
});
