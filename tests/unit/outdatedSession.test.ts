import { describe, expect, it } from "vitest";
import {
  AUTHORIZATION_MARGIN_MS,
  RESOLUTION_GRACE_MS,
  authorizationNearExpiry,
  classifyOutdatedSession,
  outdatedAction,
  resolutionDue,
  type OutdatedInput,
} from "@/domain/outdatedSession";

const base: OutdatedInput = { runStatus: null, proposalExpired: false, attempts: 0, maxAttempts: 3, authorizationNearExpiry: false };
const cls = (over: Partial<OutdatedInput>) => classifyOutdatedSession({ ...base, ...over });

describe("classifyOutdatedSession", () => {
  it("a running recovery is RECOVERY_PENDING", () => {
    expect(cls({ runStatus: "RUNNING" })).toBe("RECOVERY_PENDING");
  });

  it("an unexpired proposal awaits the driver; an expired one is permanently infeasible", () => {
    expect(cls({ runStatus: "NEEDS_APPROVAL" })).toBe("AWAITING_DRIVER_APPROVAL");
    expect(cls({ runStatus: "NEEDS_APPROVAL", proposalExpired: true })).toBe("PERMANENTLY_INFEASIBLE");
  });

  it("infeasible, rejected and expired runs are permanently infeasible", () => {
    for (const runStatus of ["INFEASIBLE", "REJECTED", "EXPIRED"] as const) expect(cls({ runStatus })).toBe("PERMANENTLY_INFEASIBLE");
  });

  it("a failed run with attempts left is a recoverable delay; once attempts are exhausted it is permanent", () => {
    expect(cls({ runStatus: "FAILED", attempts: 1 })).toBe("RECOVERABLE_DELAY");
    expect(cls({ runStatus: "FAILED", attempts: 3 })).toBe("PERMANENTLY_INFEASIBLE");
  });

  it("no run yet is a recoverable delay unless the authorization is near expiry", () => {
    expect(cls({ runStatus: null })).toBe("RECOVERABLE_DELAY");
    expect(cls({ runStatus: null, authorizationNearExpiry: true })).toBe("PERMANENTLY_INFEASIBLE");
  });
});

describe("resolutionDue and authorizationNearExpiry", () => {
  const depart = Date.parse("2026-11-06T12:00:00Z");
  it("is due only after departure plus the grace period, or near authorization expiry", () => {
    expect(resolutionDue({ nowMs: depart, effectiveDepartMs: depart, authorizationExpiresAtMs: null })).toBe(false);
    expect(resolutionDue({ nowMs: depart + RESOLUTION_GRACE_MS, effectiveDepartMs: depart, authorizationExpiresAtMs: null })).toBe(true);
    const expires = depart + 10 * AUTHORIZATION_MARGIN_MS;
    const edge = expires - AUTHORIZATION_MARGIN_MS;
    const farDeparture = expires + 10 * RESOLUTION_GRACE_MS;
    expect(resolutionDue({ nowMs: edge - 1, effectiveDepartMs: farDeparture, authorizationExpiresAtMs: expires })).toBe(false);
    expect(resolutionDue({ nowMs: edge, effectiveDepartMs: farDeparture, authorizationExpiresAtMs: expires })).toBe(true);
  });

  it("is never near expiry without an expiry timestamp", () => {
    expect(authorizationNearExpiry(depart, null)).toBe(false);
  });
});

describe("outdatedAction", () => {
  it("never settles while recovery is live, even when due", () => {
    expect(outdatedAction("RECOVERY_PENDING", true, 0)).toBe("WAIT");
  });

  it("waits on a recoverable delay until due", () => {
    expect(outdatedAction("RECOVERABLE_DELAY", false, 0)).toBe("WAIT");
    expect(outdatedAction("RECOVERABLE_DELAY", true, 0)).toBe("VOID");
    expect(outdatedAction("RECOVERABLE_DELAY", true, 5)).toBe("OPERATOR_RESOLUTION");
  });

  it("a permanently infeasible session is acted on at once: zero delivered voids, any delivery goes to the operator", () => {
    expect(outdatedAction("PERMANENTLY_INFEASIBLE", false, 0)).toBe("VOID");
    expect(outdatedAction("PERMANENTLY_INFEASIBLE", false, 1)).toBe("OPERATOR_RESOLUTION");
  });

  it("an awaiting approval is left alone until it is due", () => {
    expect(outdatedAction("AWAITING_DRIVER_APPROVAL", false, 0)).toBe("WAIT");
  });
});
