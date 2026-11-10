import { describe, expect, it } from "vitest";
import { buildScenarioSteps, providerLabel, type ScenarioStepInput } from "@/app/operator/recoveryDemoSteps";
import type { RecoveryRunView } from "@/server/services/recoveryRuns";

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

function input(overrides: Partial<ScenarioStepInput>): ScenarioStepInput {
  return { eventId: "evt_1", eventProvenance: "SYNTHETIC", run: run({}), paymentState: "AUTHORIZED", providerMode: "MOCK", ...overrides };
}

function step(steps: ReturnType<typeof buildScenarioSteps>, id: string) {
  const found = steps.find((s) => s.id === id);
  if (!found) throw new Error(`missing step ${id}`);
  return found;
}

describe("buildScenarioSteps", () => {
  it("returns the seven Scenario C steps in order", () => {
    expect(buildScenarioSteps(input({})).map((s) => s.id)).toEqual(["event", "agent", "validation", "schedule", "consent", "financial", "receipt"]);
  });

  it("labels the agent step from the run record, never a fixed value", () => {
    const modelChose = run({
      aiUsed: true,
      trace: [{ seq: 1, at: "", tool: "proposeRecovery", actor: "GEMINI", input: {}, outcome: "OK", detail: "proposed c1 (AUTO_COMMIT)" }],
    } as Partial<RecoveryRunView>);
    expect(step(buildScenarioSteps(input({ run: modelChose })), "agent").detail).toContain("MODEL_DECISION");
    expect(step(buildScenarioSteps(input({ run: run({ aiUsed: false }) })), "agent").detail).toContain("DETERMINISTIC_FALLBACK");
    expect(step(buildScenarioSteps(input({ run: run({ aiUsed: true }) })), "agent").detail).toContain("DETERMINISTIC_FALLBACK");
  });

  it("labels the disturbance as SIMULATED_EVENT only when the stored provenance says SYNTHETIC", () => {
    expect(step(buildScenarioSteps(input({ eventProvenance: "SYNTHETIC" })), "event").detail).toContain("SIMULATED_EVENT");
    expect(step(buildScenarioSteps(input({ eventProvenance: null })), "event").detail).toBe("event source not recorded · event evt_1");
  });

  it("shows an automatic commit as AUTO_COMMIT with the written version", () => {
    const steps = buildScenarioSteps(input({ run: run({ status: "COMMITTED" }) }));
    expect(step(steps, "consent").detail).toContain("AUTO_COMMIT");
    expect(step(steps, "schedule").detail).toContain("version 2");
  });

  it("shows a driver-approval proposal as NEEDS_DRIVER_APPROVAL with no version written", () => {
    const steps = buildScenarioSteps(
      input({ run: run({ status: "NEEDS_APPROVAL", outcome: { kind: "NEEDS_APPROVAL", reason: "Later finish.", effectiveSlot: 0, effectiveAt: "", candidates: [], versionCommitted: null } as RecoveryRunView["outcome"] }) }),
    );
    expect(step(steps, "consent").detail).toBe("NEEDS_DRIVER_APPROVAL");
    expect(step(steps, "schedule").detail).toBe("Proposal only, no version written");
  });

  it("reports an infeasible result without inventing a consent state", () => {
    const steps = buildScenarioSteps(
      input({ run: run({ status: "INFEASIBLE", outcome: { kind: "INFEASIBLE", reason: "Cannot fit.", effectiveSlot: 0, effectiveAt: "", candidates: [], versionCommitted: null } as RecoveryRunView["outcome"] }) }),
    );
    expect(step(steps, "schedule").detail).toBe("Infeasible or failed: no version written");
    expect(step(steps, "consent")).toMatchObject({ status: "none" });
  });

  it("marks steps pending before a run exists", () => {
    const steps = buildScenarioSteps(input({ run: null }));
    expect(step(steps, "event").status).toBe("done");
    expect(["agent", "validation", "schedule", "consent"].map((id) => step(steps, id).status)).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("labels MOCK payments as not PayPal and says the receipt waits for settlement", () => {
    const steps = buildScenarioSteps(input({ paymentState: "AUTHORIZED", providerMode: "MOCK" }));
    expect(step(steps, "financial").detail).toContain("MOCK provider (simulated, not PayPal)");
    expect(step(steps, "financial").detail).toContain("not settled yet");
    expect(step(steps, "receipt").status).toBe("pending");
  });

  it("marks the receipt ready only after capture or void", () => {
    expect(step(buildScenarioSteps(input({ paymentState: "CAPTURED" })), "receipt").status).toBe("done");
    expect(step(buildScenarioSteps(input({ paymentState: "VOIDED" })), "receipt").status).toBe("done");
  });
});

describe("providerLabel", () => {
  it("never presents a non-PayPal provider as PayPal", () => {
    expect(providerLabel("MOCK")).toBe("MOCK provider (simulated, not PayPal)");
    expect(providerLabel("PAYPAL_SANDBOX")).toBe("PayPal Sandbox (test money)");
  });
});
