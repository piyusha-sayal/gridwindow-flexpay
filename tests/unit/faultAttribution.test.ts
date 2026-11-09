import { describe, expect, it } from "vitest";
import { attributionFor, FAULT_ATTRIBUTIONS, isAllowedAttribution, sessionAttribution, type FaultAttribution } from "@/domain/faultAttribution";
import { DISTURBANCE_TYPES } from "@/domain/disturbance";
import { settlementAction, type SettlementInput } from "@/domain/outdatedSession";
import { SETTLEMENT_POLICY_V1 } from "@/domain/terms";

describe("attributionFor: documented defaults", () => {
  it("maps each disturbance type to its default attribution", () => {
    expect(attributionFor("EARLY_DEPARTURE")).toBe("DRIVER");
    expect(attributionFor("SITE_CAP_REDUCTION")).toBe("EXTERNAL");
    expect(attributionFor("CHARGER_POWER_REDUCTION")).toBe("UNKNOWN");
    expect(attributionFor("CHARGER_FAILURE")).toBe("UNKNOWN");
  });

  it("uses a supplied value as stated, so OPERATOR is the only confirmed operator cause", () => {
    expect(attributionFor("CHARGER_FAILURE", "OPERATOR")).toBe("OPERATOR");
    expect(attributionFor("SITE_CAP_REDUCTION", "OPERATOR")).toBe("OPERATOR");
  });
});

describe("attribution matrix: every value against every disturbance type", () => {
  const allowed: Record<string, readonly FaultAttribution[]> = {
    EARLY_DEPARTURE: ["DRIVER", "UNKNOWN"],
    SITE_CAP_REDUCTION: ["OPERATOR", "EXTERNAL", "UNKNOWN"],
    CHARGER_POWER_REDUCTION: ["OPERATOR", "DRIVER", "EXTERNAL", "UNKNOWN"],
    CHARGER_FAILURE: ["OPERATOR", "DRIVER", "EXTERNAL", "UNKNOWN"],
  };
  for (const type of DISTURBANCE_TYPES) {
    it(`${type} accepts exactly its allowed attributions`, () => {
      for (const value of FAULT_ATTRIBUTIONS) {
        expect(isAllowedAttribution(type, value)).toBe(allowed[type]!.includes(value));
      }
    });
  }
});

describe("sessionAttribution", () => {
  it("is OPERATOR only when every disturbance is OPERATOR", () => {
    expect(sessionAttribution(["OPERATOR", "OPERATOR"])).toBe("OPERATOR");
    expect(sessionAttribution(["OPERATOR", "UNKNOWN"])).toBe("UNKNOWN");
    expect(sessionAttribution(["OPERATOR", "EXTERNAL"])).toBe("EXTERNAL");
    expect(sessionAttribution(["OPERATOR", "DRIVER"])).toBe("DRIVER");
  });

  it("treats a session with no recorded disturbance as UNKNOWN", () => {
    expect(sessionAttribution([])).toBe("UNKNOWN");
  });
});

describe("UNKNOWN never moves money, and legacy agreements ignore attribution", () => {
  const states: Omit<SettlementInput, "attribution" | "policy">[] = [];
  for (const runStatus of ["INFEASIBLE", "FAILED", "REJECTED", null] as const) {
    for (const attempts of [0, 3]) {
      for (const deliveredMilliWh of [0, 5_000]) {
        for (const driverRequestedDeparture of [false, true]) {
          states.push({
            runStatus,
            proposalExpired: false,
            attempts,
            maxAttempts: 3,
            authorizationNearExpiry: false,
            driverRequestedDeparture,
            due: true,
            deliveredMilliWh,
          });
        }
      }
    }
  }

  it("UNKNOWN, EXTERNAL and DRIVER are never VOID under SETTLEMENT_POLICY_V1", () => {
    for (const attribution of ["UNKNOWN", "EXTERNAL", "DRIVER"] as const) {
      for (const state of states) {
        expect(settlementAction({ ...state, policy: SETTLEMENT_POLICY_V1, attribution })).not.toBe("VOID");
      }
    }
  });

  it("OPERATOR is the only attribution that can reach VOID under SETTLEMENT_POLICY_V1", () => {
    const voids = states.filter((s) => settlementAction({ ...s, policy: SETTLEMENT_POLICY_V1, attribution: "OPERATOR" }) === "VOID");
    expect(voids.length).toBeGreaterThan(0);
    expect(voids.every((s) => s.runStatus === "INFEASIBLE" || (s.runStatus === "FAILED" && s.attempts >= 3))).toBe(true);
  });

  it("legacy agreements give the same decision whatever the attribution", () => {
    for (const state of states) {
      const decisions = FAULT_ATTRIBUTIONS.map((attribution) => settlementAction({ ...state, policy: "LEGACY", attribution }));
      expect(new Set(decisions).size).toBe(1);
    }
  });
});
