import { describe, expect, it } from "vitest";
import { operatorFailureConfirmed, resolutionBasis, settlementAction, type SettlementInput } from "@/domain/outdatedSession";
import { SETTLEMENT_POLICY_V1, settlementPolicyOf } from "@/domain/terms";

const base: SettlementInput = {
  policy: SETTLEMENT_POLICY_V1,
  runStatus: null,
  proposalExpired: false,
  attempts: 0,
  maxAttempts: 3,
  authorizationNearExpiry: false,
  driverRequestedDeparture: false,
  // The existing assertions below describe a CONFIRMED operator failure; other attributions are tested explicitly.
  attribution: "OPERATOR",
  due: false,
  deliveredMilliWh: 0,
};
const act = (over: Partial<SettlementInput>) => settlementAction({ ...base, ...over });

describe("fault attribution under OPERATOR_FAILURE_FULL_VOID_V1", () => {
  const confirmed = { runStatus: "INFEASIBLE" as const, deliveredMilliWh: 0 };

  it("voids only a confirmed OPERATOR attribution", () => {
    expect(act({ ...confirmed, attribution: "OPERATOR" })).toBe("VOID");
  });

  it("never voids or captures for UNKNOWN, EXTERNAL or DRIVER attribution; they go to the operator", () => {
    for (const attribution of ["UNKNOWN", "EXTERNAL", "DRIVER"] as const) {
      expect(act({ ...confirmed, attribution })).toBe("OPERATOR_RESOLUTION");
      expect(act({ ...confirmed, attribution, deliveredMilliWh: 5_000 })).toBe("OPERATOR_RESOLUTION");
    }
  });

  it("labels the non-operator resolution basis", () => {
    expect(resolutionBasis({ ...base, ...confirmed, attribution: "UNKNOWN" })).toBe("ATTRIBUTION_UNKNOWN");
    expect(resolutionBasis({ ...base, ...confirmed, attribution: "EXTERNAL" })).toBe("EXTERNAL_ATTRIBUTED");
    expect(resolutionBasis({ ...base, ...confirmed, attribution: "DRIVER" })).toBe("DRIVER_ATTRIBUTED");
  });

  it("keeps an UNKNOWN recoverable delay waiting until due, like any other delay", () => {
    expect(act({ runStatus: "FAILED", attempts: 1, attribution: "UNKNOWN" })).toBe("WAIT");
    expect(act({ runStatus: "FAILED", attempts: 1, due: true, attribution: "UNKNOWN" })).toBe("OPERATOR_RESOLUTION");
  });
});

describe("settlementPolicyOf", () => {
  it("treats terms without the field as legacy", () => {
    expect(settlementPolicyOf({})).toBe("LEGACY");
    expect(settlementPolicyOf({ settlementPolicy: SETTLEMENT_POLICY_V1 })).toBe(SETTLEMENT_POLICY_V1);
  });
});

describe("settlementAction under OPERATOR_FAILURE_FULL_VOID_V1", () => {
  it("never voids while recovery is live or an approval can still resolve", () => {
    expect(act({ runStatus: "RUNNING", due: true })).toBe("WAIT");
    expect(act({ runStatus: "NEEDS_APPROVAL", due: true, deliveredMilliWh: 0 })).toBe("WAIT");
  });

  it("voids a conclusively infeasible operator failure in full, with or without delivered energy", () => {
    expect(act({ runStatus: "INFEASIBLE", deliveredMilliWh: 0 })).toBe("VOID");
    expect(act({ runStatus: "INFEASIBLE", deliveredMilliWh: 5_000 })).toBe("VOID");
    expect(act({ runStatus: "FAILED", attempts: 3, deliveredMilliWh: 5_000 })).toBe("VOID");
  });

  it("does not void a failed recovery that still has attempts left, until it is due", () => {
    expect(act({ runStatus: "FAILED", attempts: 1 })).toBe("WAIT");
    expect(act({ runStatus: "FAILED", attempts: 1, due: true })).toBe("OPERATOR_RESOLUTION");
  });

  it("sends a driver-requested early departure to the operator, never to a void", () => {
    expect(act({ runStatus: "INFEASIBLE", driverRequestedDeparture: true })).toBe("OPERATOR_RESOLUTION");
    expect(act({ runStatus: "INFEASIBLE", driverRequestedDeparture: true, deliveredMilliWh: 0 })).toBe("OPERATOR_RESOLUTION");
  });

  it("does not treat a driver rejection, an expired proposal or a missing run as a conclusive operator failure", () => {
    expect(act({ runStatus: "REJECTED" })).toBe("OPERATOR_RESOLUTION");
    expect(act({ runStatus: "EXPIRED" })).toBe("OPERATOR_RESOLUTION");
    expect(act({ runStatus: "NEEDS_APPROVAL", proposalExpired: true })).toBe("OPERATOR_RESOLUTION");
    expect(act({ runStatus: null, authorizationNearExpiry: true })).toBe("OPERATOR_RESOLUTION");
  });

  it("is operator-resolved, not voided, for an expired proposal on a driver-requested departure", () => {
    expect(act({ runStatus: "NEEDS_APPROVAL", proposalExpired: true, driverRequestedDeparture: true })).toBe("OPERATOR_RESOLUTION");
  });
});

describe("settlementAction for legacy agreements keeps the original rules", () => {
  const legacy = { ...base, policy: "LEGACY" as const };
  it("voids zero delivered when permanently infeasible and operator-resolves any delivered energy", () => {
    expect(settlementAction({ ...legacy, runStatus: "INFEASIBLE" })).toBe("VOID");
    expect(settlementAction({ ...legacy, runStatus: "INFEASIBLE", deliveredMilliWh: 1 })).toBe("OPERATOR_RESOLUTION");
  });

  it("voids a due, unrecovered zero-delivery session that has no run", () => {
    expect(settlementAction({ ...legacy, runStatus: "FAILED", attempts: 1, due: true })).toBe("VOID");
  });
});

describe("resolutionBasis and operatorFailureConfirmed", () => {
  it("labels why an outcome was escalated", () => {
    expect(resolutionBasis({ ...base, policy: "LEGACY" })).toBe("LEGACY_POLICY");
    expect(resolutionBasis({ ...base, runStatus: "INFEASIBLE", driverRequestedDeparture: true })).toBe("DRIVER_REQUESTED_DEPARTURE");
    expect(resolutionBasis({ ...base, runStatus: "REJECTED" })).toBe("OPERATOR_FAILURE_NOT_CONFIRMED");
    expect(resolutionBasis({ ...base, runStatus: "FAILED", attempts: 1, due: true })).toBe("AMBIGUOUS_RECOVERY");
  });

  it("is confirmed only for an infeasible run or a recovery that failed on every attempt", () => {
    expect(operatorFailureConfirmed("INFEASIBLE", 0, 3)).toBe(true);
    expect(operatorFailureConfirmed("FAILED", 3, 3)).toBe(true);
    expect(operatorFailureConfirmed("FAILED", 2, 3)).toBe(false);
    expect(operatorFailureConfirmed(null, 0, 3)).toBe(false);
  });
});
