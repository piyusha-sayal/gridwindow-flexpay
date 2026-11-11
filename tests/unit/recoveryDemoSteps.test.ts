import { describe, expect, it } from "vitest";
import { buildScenarioSteps, providerLabel, type ScenarioStepInput } from "@/app/operator/recoveryDemoSteps";
import { PAYMENT_STATES, type PaymentState } from "@/domain/paymentState";
import type { RecoveryRunView } from "@/server/services/recoveryRuns";

type Outcome = NonNullable<RecoveryRunView["outcome"]>;

function outcome(kind: Outcome["kind"], versionCommitted: number | null, reason = `${kind} reason.`): Outcome {
  return { kind, reason, effectiveSlot: 0, effectiveAt: "", candidates: [], versionCommitted };
}

function run(overrides: Partial<RecoveryRunView>): RecoveryRunView {
  return {
    runId: "run_1",
    eventId: "evt_1",
    status: "COMMITTED",
    trace: [{ seq: 1 } as RecoveryRunView["trace"][number]],
    proposal: null,
    proposalVersion: null,
    expiresAt: null,
    aiUsed: false,
    explanation: null,
    outcome: { kind: "COMMITTED", reason: "Recovered within bounds.", effectiveSlot: 0, effectiveAt: "", candidates: [], versionCommitted: 2 },
    ...overrides,
  } as RecoveryRunView;
}

const PROPOSAL = { preference: "LATER_FINISH", powerW: [7200], energyCostCents: 100, operatorImprovementCents: 10, priceCents: 1500, reasons: [] } as unknown as RecoveryRunView["proposal"];
const MODEL_DECISION_TRACE = [
  { seq: 1, at: "", tool: "proposeRecovery", actor: "GEMINI", input: {}, outcome: "OK", detail: "proposed c1 (AUTO_COMMIT)" },
] as RecoveryRunView["trace"];
const HELD = ["ORDER_CREATED", "BUYER_APPROVED", "AUTHORIZED"];

function input(overrides: Partial<ScenarioStepInput>): ScenarioStepInput {
  return {
    eventId: "evt_1",
    eventProvenance: "SYNTHETIC",
    run: run({}),
    consent: { method: "AUTO_WITHIN_PRE_APPROVED_BOUNDS" },
    paymentState: "AUTHORIZED",
    proofTypes: HELD,
    providerMode: "MOCK",
    ...overrides,
  };
}

function step(steps: ReturnType<typeof buildScenarioSteps>, id: string) {
  const found = steps.find((s) => s.id === id);
  if (!found) throw new Error(`missing step ${id}`);
  return found;
}

function stepOf(overrides: Partial<ScenarioStepInput>, id: string) {
  return step(buildScenarioSteps(input(overrides)), id);
}

describe("buildScenarioSteps", () => {
  it("returns the seven Scenario C steps in order", () => {
    expect(buildScenarioSteps(input({})).map((s) => s.id)).toEqual(["event", "agent", "validation", "schedule", "consent", "financial", "receipt"]);
  });

  it("labels the agent step from the run record, never a fixed value", () => {
    const modelChose = run({ aiUsed: true, trace: MODEL_DECISION_TRACE });
    expect(stepOf({ run: modelChose }, "agent").detail).toContain("MODEL_DECISION");
    expect(stepOf({ run: run({ aiUsed: false }) }, "agent").detail).toContain("DETERMINISTIC_FALLBACK");
    expect(stepOf({ run: run({ aiUsed: true }) }, "agent").detail).toContain("DETERMINISTIC_FALLBACK");
  });

  it("labels the disturbance as SIMULATED_EVENT only when the stored provenance says SYNTHETIC", () => {
    expect(stepOf({ eventProvenance: "SYNTHETIC" }, "event").detail).toContain("SIMULATED_EVENT");
    expect(stepOf({ eventProvenance: null }, "event").detail).toBe("event source not recorded · event evt_1");
  });

  it("shows an automatic commit as AUTO_COMMIT with the written version", () => {
    const steps = buildScenarioSteps(input({ run: run({ status: "COMMITTED" }) }));
    expect(step(steps, "consent")).toMatchObject({ status: "done", detail: "AUTO_COMMIT, within pre-approved bounds" });
    expect(step(steps, "schedule")).toMatchObject({ status: "done", detail: "Schedule version 2 written" });
  });

  it("shows a driver-approval proposal as NEEDS_DRIVER_APPROVAL, waiting, with no version written", () => {
    const steps = buildScenarioSteps(input({ run: run({ status: "NEEDS_APPROVAL", proposal: PROPOSAL, outcome: outcome("NEEDS_APPROVAL", null) }), consent: null }));
    expect(step(steps, "consent")).toMatchObject({ status: "pending" });
    expect(step(steps, "consent").detail).toContain("NEEDS_DRIVER_APPROVAL");
    expect(step(steps, "schedule")).toMatchObject({ status: "pending" });
    expect(step(steps, "schedule").detail).toContain("Proposal only, no version written");
    expect(step(steps, "validation")).toMatchObject({ status: "done", detail: "NEEDS_APPROVAL reason." });
  });

  it("reports an infeasible result without inventing a version or a consent state", () => {
    const steps = buildScenarioSteps(input({ run: run({ status: "INFEASIBLE", outcome: outcome("INFEASIBLE", null, "Cannot fit.") }), consent: null }));
    expect(step(steps, "validation")).toMatchObject({ status: "done", detail: "Cannot fit." });
    expect(step(steps, "schedule")).toMatchObject({ status: "none", detail: "Infeasible: no version written" });
    expect(step(steps, "consent")).toMatchObject({ status: "none" });
  });

  it("marks steps pending before a run exists", () => {
    const steps = buildScenarioSteps(input({ run: null, consent: null }));
    expect(step(steps, "event").status).toBe("done");
    expect(["agent", "validation", "schedule", "consent"].map((id) => step(steps, id).status)).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("labels MOCK payments as not PayPal and says the receipt waits for settlement", () => {
    const steps = buildScenarioSteps(input({ paymentState: "AUTHORIZED", providerMode: "MOCK" }));
    expect(step(steps, "financial").detail).toContain("MOCK provider (simulated, not PayPal)");
    expect(step(steps, "financial").detail).toContain("not settled yet");
    expect(step(steps, "receipt").status).toBe("pending");
  });

  it("marks the receipt ready only after a provider-confirmed capture or void", () => {
    expect(stepOf({ paymentState: "CAPTURED", proofTypes: [...HELD, "CAPTURED"] }, "receipt").status).toBe("done");
    expect(stepOf({ paymentState: "VOIDED", proofTypes: [...HELD, "VOIDED"] }, "receipt").status).toBe("done");
    expect(stepOf({ paymentState: "CAPTURED", proofTypes: HELD }, "receipt").status).toBe("pending");
  });
});

describe("buildScenarioSteps: a RUNNING run is not a completed decision", () => {
  const running = run({ status: "RUNNING", aiUsed: true, trace: MODEL_DECISION_TRACE, outcome: null });

  it("shows the agent step as waiting, with no decision label, even after the model proposed", () => {
    const agent = stepOf({ run: running, consent: null }, "agent");
    expect(agent.status).toBe("pending");
    expect(agent.detail).not.toMatch(/MODEL_DECISION|DETERMINISTIC_FALLBACK/);
    expect(agent.detail).toContain("1 trace entries so far");
  });

  it("keeps validation, schedule and consent waiting while the run is RUNNING", () => {
    const steps = buildScenarioSteps(input({ run: running, consent: null }));
    expect(["validation", "schedule", "consent"].map((id) => step(steps, id).status)).toEqual(["pending", "pending", "pending"]);
  });

  it("does not present the provisional outcome saved before an automatic commit as a written version", () => {
    // The orchestrator saves a COMMITTED outcome (no version yet) before it commits; the run is still RUNNING.
    const provisional = run({ status: "RUNNING", outcome: outcome("COMMITTED", null) });
    const steps = buildScenarioSteps(input({ run: provisional, consent: null }));
    expect(step(steps, "validation").status).toBe("pending");
    expect(step(steps, "schedule")).toMatchObject({ status: "pending", detail: "No schedule result yet." });
    expect(steps.map((s) => s.detail).join(" ")).not.toContain("version ?");
  });
});

describe("buildScenarioSteps: schedule and consent follow the persisted records", () => {
  it("shows a driver-approved commit as DRIVER_APPROVED with the version the approval wrote", () => {
    // Approval commits the stored proposal: the run becomes COMMITTED while its outcome keeps the NEEDS_APPROVAL kind.
    const approved = run({ status: "COMMITTED", proposal: PROPOSAL, outcome: outcome("NEEDS_APPROVAL", null) });
    const steps = buildScenarioSteps(input({ run: approved, consent: { method: "DRIVER_APPROVED", version: 3 } }));
    expect(step(steps, "consent")).toMatchObject({ status: "done", detail: "DRIVER_APPROVED" });
    expect(step(steps, "schedule")).toMatchObject({ status: "done", detail: "Schedule version 3 written" });
  });

  it("uses the run's stored proposal when the reservation was read just before the commit", () => {
    const approved = run({ status: "COMMITTED", proposal: PROPOSAL, outcome: outcome("NEEDS_APPROVAL", null) });
    const steps = buildScenarioSteps(input({ run: approved, consent: null }));
    expect(step(steps, "consent").detail).toBe("DRIVER_APPROVED");
    expect(step(steps, "schedule")).toMatchObject({ status: "done", detail: "Schedule version written" });
  });

  it("waits for the version while an approved proposal is being applied", () => {
    const steps = buildScenarioSteps(input({ run: run({ status: "APPROVED", proposal: PROPOSAL, outcome: outcome("NEEDS_APPROVAL", null) }), consent: null }));
    expect(step(steps, "consent")).toMatchObject({ status: "done", detail: "DRIVER_APPROVED" });
    expect(step(steps, "schedule").status).toBe("pending");
  });

  it("shows a failed approval as approved but not applied, with no version written", () => {
    const steps = buildScenarioSteps(input({ run: run({ status: "FAILED", proposal: PROPOSAL, outcome: outcome("NEEDS_APPROVAL", null) }), consent: null }));
    expect(step(steps, "consent").detail).toBe("DRIVER_APPROVED, but the change was not applied (run failed)");
    expect(step(steps, "schedule")).toMatchObject({ status: "stopped", detail: "Run failed: no version written" });
  });

  it("marks a run that failed before validating as stopped, not waiting", () => {
    // Lease takeovers exhausted: the run is FAILED with no outcome stored.
    const steps = buildScenarioSteps(input({ run: run({ status: "FAILED", outcome: null }), consent: null }));
    expect(["agent", "validation", "schedule"].map((id) => step(steps, id).status)).toEqual(["stopped", "stopped", "stopped"]);
    expect(step(steps, "consent")).toMatchObject({ status: "none" });
  });

  it("shows a failed run's own reason in the validation step", () => {
    const steps = buildScenarioSteps(input({ run: run({ status: "FAILED", outcome: outcome("FAILED", null, "Schedule changed meanwhile.") }), consent: null }));
    expect(step(steps, "validation")).toMatchObject({ status: "stopped", detail: "Schedule changed meanwhile." });
  });

  it("writes no version for a declined or expired proposal", () => {
    for (const status of ["REJECTED", "EXPIRED"] as const) {
      const steps = buildScenarioSteps(input({ run: run({ status, proposal: PROPOSAL, outcome: outcome("NEEDS_APPROVAL", null) }), consent: null }));
      expect(step(steps, "schedule").status).toBe("none");
      expect(step(steps, "schedule").detail).toContain("no version written");
      expect(step(steps, "consent").status).toBe("done");
    }
  });
});

describe("buildScenarioSteps: financial outcome reflects settlement", () => {
  const financial = (paymentState: PaymentState, proofTypes: readonly string[] = HELD, providerMode = "MOCK") => stepOf({ paymentState, proofTypes, providerMode }, "financial");

  it("shows AUTHORIZED as context, waiting, never done", () => {
    const s = financial("AUTHORIZED");
    expect(s.status).toBe("pending");
    expect(s.detail).toBe("AUTHORIZED · MOCK provider (simulated, not PayPal) · funds held, not captured · not settled yet");
  });

  it("keeps a pending capture and an unresolved payment waiting", () => {
    expect(financial("CAPTURE_PENDING")).toMatchObject({ status: "pending" });
    expect(financial("CAPTURE_PENDING").detail).toContain("capture not confirmed by the provider");
    expect(financial("NEEDS_RECONCILIATION")).toMatchObject({ status: "pending" });
    expect(financial("NEEDS_RECONCILIATION").detail).toContain("not settled yet");
  });

  it("is done for a capture only with the provider's capture proof", () => {
    expect(financial("CAPTURED", [...HELD, "CAPTURED"])).toMatchObject({
      status: "done",
      detail: "CAPTURED · MOCK provider (simulated, not PayPal) · capture confirmed by the provider",
    });
    expect(financial("CAPTURED", HELD)).toMatchObject({ status: "pending" });
  });

  it("is done for a void only with the provider's void proof, and says nothing was charged", () => {
    expect(financial("VOIDED", [...HELD, "VOIDED"], "PAYPAL_SANDBOX")).toMatchObject({
      status: "done",
      detail: "VOIDED · PayPal Sandbox (test money) · not charged, authorization voided by the provider",
    });
    expect(financial("VOIDED", HELD)).toMatchObject({ status: "pending" });
  });

  it("marks declined, failed and cancelled payments as stopped, with nothing collected", () => {
    for (const state of ["CAPTURE_DECLINED", "FAILED", "CANCELLED"] as const) {
      const s = financial(state);
      expect(s.status).toBe("stopped");
      expect(s.detail).toContain("nothing collected");
      expect(s.detail).not.toMatch(/confirmed|settled/);
    }
  });

  it("never shows a provider capture as settled while the local state is not CAPTURED", () => {
    const s = financial("NEEDS_RECONCILIATION", [...HELD, "CAPTURED"]);
    expect(s.status).toBe("pending");
    expect(s.detail).toContain("under review");
  });

  it("is done only for CAPTURED and VOIDED, across every payment state", () => {
    const allProofs = [...HELD, "CAPTURED", "VOIDED"];
    const done = PAYMENT_STATES.filter((state) => financial(state, allProofs).status === "done");
    expect(done).toEqual(["CAPTURED", "VOIDED"]);
    for (const state of PAYMENT_STATES) expect(financial(state, HELD).status).not.toBe("done");
  });
});

describe("buildScenarioSteps: FlexReceipt", () => {
  it("is stopped when the payment ended without settlement", () => {
    expect(stepOf({ paymentState: "CAPTURE_DECLINED" }, "receipt")).toMatchObject({
      status: "stopped",
      detail: "Shown on the driver's reservation page, stating nothing was collected",
    });
    expect(stepOf({ paymentState: "FAILED" }, "receipt")).toMatchObject({ status: "stopped", detail: "No receipt: the payment ended without settlement" });
  });

  it("describes the not-final receipt the driver sees while a capture is pending", () => {
    expect(stepOf({ paymentState: "CAPTURE_PENDING" }, "receipt")).toMatchObject({ status: "pending", detail: "Shown on the driver's reservation page as not final" });
  });
});

describe("providerLabel", () => {
  it("never presents a non-PayPal provider as PayPal", () => {
    expect(providerLabel("MOCK")).toBe("MOCK provider (simulated, not PayPal)");
    expect(providerLabel("PAYPAL_SANDBOX")).toBe("PayPal Sandbox (test money)");
  });
});
