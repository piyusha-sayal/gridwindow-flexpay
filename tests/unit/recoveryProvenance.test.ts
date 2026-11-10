/** Provenance labels: derived only from the persisted run record and trace. A fallback is never shown as a model decision. */
import { describe, expect, it } from "vitest";
import { MODEL_SKIP_PREFIX, NO_MODEL_DETAIL, recordedModelProvider, runProvenance, SIMULATED_EVENT_LABEL } from "@/server/services/recoveryProvenance";
import type { RunTraceEntry } from "@/server/services/recoveryRuns";

const AT = "2026-11-06T06:00:00.000Z";

function start(modelProvider: string | null): RunTraceEntry {
  return { seq: 1, at: AT, tool: "orchestrator", actor: "DETERMINISTIC", input: { attempt: 1, modelProvider }, outcome: "INFO", detail: "started" };
}

function modelStep(tool: string, outcome: RunTraceEntry["outcome"], seq: number, detail = "ok"): RunTraceEntry {
  return { seq, at: AT, tool, actor: "GEMINI", input: {}, outcome, detail };
}

function skip(reason: string, seq: number): RunTraceEntry {
  return { seq, at: AT, tool: "orchestrator", actor: "DETERMINISTIC", input: {}, outcome: "INFO", detail: `${MODEL_SKIP_PREFIX}${reason}` };
}

function deterministic(tool: string, seq: number): RunTraceEntry {
  return { seq, at: AT, tool, actor: "DETERMINISTIC", input: {}, outcome: "OK", detail: "done" };
}

describe("MODEL_DECISION", () => {
  it("is used when a live model proposed the chosen step through the tools", () => {
    const p = runProvenance({
      aiUsed: true,
      trace: [start("gemini"), modelStep("requestRecoveryCandidates", "OK", 2), modelStep("proposeRecovery", "OK", 3), deterministic("commitPermittedRecovery", 4)],
    });
    expect(p.decision).toBe("MODEL_DECISION");
    expect(p.decisionLabel).toBe("MODEL_DECISION · Gemini (live model)");
  });

  it("names Anthropic only when the Anthropic adapter was recorded", () => {
    const p = runProvenance({ aiUsed: true, trace: [start("anthropic"), modelStep("commitPermittedRecovery", "OK", 2)] });
    expect(p.modelLabel).toBe("Anthropic (live model)");
  });

  it("never says Gemini for a run whose provider was not recorded", () => {
    const p = runProvenance({ aiUsed: true, trace: [modelStep("proposeRecovery", "OK", 1)] });
    expect(p.decision).toBe("MODEL_DECISION");
    expect(p.modelLabel).toBe("model provider not recorded");
    expect(p.decisionLabel).not.toMatch(/Gemini/);
  });
});

describe("DETERMINISTIC_FALLBACK", () => {
  it("when the model failed (timeout, unavailable) and the deterministic path chose", () => {
    const p = runProvenance({ aiUsed: false, trace: [start("gemini"), skip("UNAVAILABLE", 2), deterministic("proposeRecovery", 3), deterministic("commitPermittedRecovery", 4)] });
    expect(p.decision).toBe("DETERMINISTIC_FALLBACK");
    expect(p.modelLabel).toBeNull();
    expect(p.decisionLabel).toBe("DETERMINISTIC_FALLBACK · no model decision");
    expect(p.reason).toMatch(/UNAVAILABLE/);
  });

  it("when no model was configured", () => {
    const p = runProvenance({ aiUsed: false, trace: [start(null), { seq: 2, at: AT, tool: "orchestrator", actor: "DETERMINISTIC", input: {}, outcome: "INFO", detail: NO_MODEL_DETAIL }] });
    expect(p.decision).toBe("DETERMINISTIC_FALLBACK");
    expect(p.reason).toBe("No model was configured, so the deterministic path decided.");
  });

  it("when the model output was rejected by the validators", () => {
    const p = runProvenance({ aiUsed: false, trace: [start("gemini"), modelStep("captureAuthorization", "REJECTED", 2, "UNKNOWN_TOOL: No such tool."), deterministic("proposeRecovery", 3)] });
    expect(p.decision).toBe("DETERMINISTIC_FALLBACK");
    expect(p.reason).toMatch(/rejected by the validators/);
  });

  it("when the model only read state and never chose a step", () => {
    const p = runProvenance({ aiUsed: true, trace: [start("gemini"), modelStep("readStationState", "OK", 2), deterministic("proposeRecovery", 3)] });
    expect(p.decision).toBe("DETERMINISTIC_FALLBACK");
    expect(p.reason).toMatch(/did not choose/);
  });

  it("when the model proposed a step that the validators refused and the deterministic path decided instead", () => {
    const p = runProvenance({ aiUsed: false, trace: [start("gemini"), modelStep("proposeRecovery", "REJECTED", 2, "NOT_VALIDATED"), deterministic("proposeRecovery", 3)] });
    expect(p.decision).toBe("DETERMINISTIC_FALLBACK");
  });
});

describe("mock model", () => {
  it("is labelled as a test fixture and never as a live model", () => {
    const p = runProvenance({ aiUsed: true, trace: [start("test-fixture"), modelStep("proposeRecovery", "OK", 2)] });
    expect(p.decision).toBe("MODEL_DECISION");
    expect(p.decisionLabel).toBe("MODEL_DECISION · MOCK MODEL (test fixture)");
    expect(p.decisionLabel).not.toMatch(/live|Gemini|Anthropic/);
  });

  it("reads the recorded provider and ignores unknown values", () => {
    expect(recordedModelProvider([start("test-fixture")])).toBe("test-fixture");
    expect(recordedModelProvider([start("openai")])).toBeNull();
    expect(recordedModelProvider([])).toBeNull();
  });
});

describe("SIMULATED_EVENT", () => {
  it("is the label for every synthetic disturbance", () => {
    expect(SIMULATED_EVENT_LABEL).toBe("SIMULATED_EVENT");
  });
});
