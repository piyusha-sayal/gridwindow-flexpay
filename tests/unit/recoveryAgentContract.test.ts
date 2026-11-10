/** Contract of the recovery agent's tool set: no payment capability, no deadline or price change without consent. */
import { describe, expect, it } from "vitest";
import { snapshotSession } from "@/domain/recovery";
import { fixture, planningContext } from "./recoveryFixture";
import { allowedToolNames, dispatchTool, newRunState, pickDeterministic, TOOL_NAMES, type RunState } from "@/server/services/recoveryTools";
import { STEP_SCHEMA } from "@/server/services/recoveryPrompt";

/** Names that would mean a payment, settlement or money-moving capability. None may ever be a tool. */
const PAYMENT_NAME = /capture|void|refund|order|authori|pay|settle|charge|paypal|credit|transfer|payout/i;

function freshState(): RunState {
  const f = fixture();
  const ctx = planningContext(f.scenario);
  const snap = snapshotSession(ctx, f.session, 0);
  return newRunState({ ctx, session: f.session, snap, version: 1, eventType: "CHARGER_POWER_REDUCTION" });
}

describe("tool registry", () => {
  it("contains no payment, settlement or money-moving capability", () => {
    expect(TOOL_NAMES.filter((name) => PAYMENT_NAME.test(name))).toEqual([]);
  });

  it("never offers a payment tool in any phase", () => {
    const state = freshState();
    expect(allowedToolNames(state).filter((name) => PAYMENT_NAME.test(name))).toEqual([]);
    dispatchTool(state, "requestRecoveryCandidates", {});
    expect(allowedToolNames(state).filter((name) => PAYMENT_NAME.test(name))).toEqual([]);
    expect(allowedToolNames({ ...state, decision: "COMMITTED" }).filter((name) => PAYMENT_NAME.test(name))).toEqual([]);
  });
});

describe("step schema", () => {
  it("accepts exactly one tool name and one JSON text", () => {
    expect(STEP_SCHEMA.safeParse({ tool: "readStationState", argsJson: "{}" }).success).toBe(true);
  });

  it("rejects extra fields, missing fields, non-string values and oversized arguments", () => {
    expect(STEP_SCHEMA.safeParse({ tool: "readStationState", argsJson: "{}", amountCents: 1 }).success).toBe(false);
    expect(STEP_SCHEMA.safeParse({ tool: "readStationState" }).success).toBe(false);
    expect(STEP_SCHEMA.safeParse({ tool: 7, argsJson: "{}" }).success).toBe(false);
    expect(STEP_SCHEMA.safeParse({ tool: "readStationState", argsJson: "x".repeat(2_001) }).success).toBe(false);
  });
});

describe("no deadline extension or price increase without the driver", () => {
  it("a candidate the agreed terms forbid cannot be proposed, approved or committed", () => {
    const state = freshState();
    dispatchTool(state, "requestRecoveryCandidates", {});
    dispatchTool(state, "validateRecoveryPlan", { candidateId: "c1" });
    // The consent boundary marks a later departure or a price increase as NOT_ALLOWED. Forced here to test the gate.
    state.candidates = state.candidates!.map((c) => (c.id === "c1" ? { ...c, validation: "VALID", consent: "NOT_ALLOWED" } : c));

    expect(dispatchTool(state, "proposeRecovery", { candidateId: "c1" })).toMatchObject({ ok: false, code: "NOT_PROPOSABLE" });
    expect(dispatchTool(state, "requestDriverApproval", {})).toMatchObject({ ok: false, code: "NOT_PROPOSED" });
    expect(dispatchTool(state, "commitPermittedRecovery", {})).toMatchObject({ ok: false, code: "NOT_PROPOSED" });
    expect(state.chosenId).toBeNull();
    expect(state.decision).toBeNull();
  });

  it("the deterministic choice never selects a candidate the agreed terms forbid", () => {
    const state = freshState();
    dispatchTool(state, "requestRecoveryCandidates", {});
    for (const c of state.candidates!) dispatchTool(state, "validateRecoveryPlan", { candidateId: c.id });
    state.candidates = state.candidates!.map((c, i) => (i === 0 ? { ...c, consent: "NOT_ALLOWED" } : c));
    const choice = pickDeterministic(state);
    expect(state.candidates!.find((c) => c.id === choice)?.consent).not.toBe("NOT_ALLOWED");
  });

  it("a candidate that needs the driver can be routed to approval but never auto-committed", () => {
    const state = freshState();
    dispatchTool(state, "requestRecoveryCandidates", {});
    state.candidates = state.candidates!.map((c, i) => (i === 0 ? { ...c, validation: "VALID", consent: "NEEDS_DRIVER_APPROVAL" } : c));
    dispatchTool(state, "proposeRecovery", { candidateId: "c1" });
    expect(dispatchTool(state, "commitPermittedRecovery", {})).toMatchObject({ ok: false, code: "NOT_AUTO_PERMITTED" });
    expect(dispatchTool(state, "requestDriverApproval", {})).toMatchObject({ ok: true, effect: { kind: "NEEDS_APPROVAL" } });
  });
});
