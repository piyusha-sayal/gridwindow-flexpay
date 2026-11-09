import { describe, expect, it } from "vitest";
import { SYNTHETIC_ECONOMICS } from "@/domain/economics";
import { DEMO_STATION } from "@/domain/station";
import { runRecoveryBenchmark, SEVERITIES, type ApplicableScenario } from "../../scripts/recoveryBenchmarkRun";

const seeds = [1, 2, 3];
const a = runRecoveryBenchmark(DEMO_STATION, SYNTHETIC_ECONOMICS, seeds);

describe("recovery benchmark", () => {
  it("is deterministic: the same seeds produce identical output", () => {
    expect(runRecoveryBenchmark(DEMO_STATION, SYNTHETIC_ECONOMICS, seeds)).toEqual(a);
  });

  it("covers every seeded session and severity, and accounts for each scenario once", () => {
    expect(a.flexibleSessions).toBeGreaterThan(0);
    expect(a.scenarios.length).toBe(a.flexibleSessions * SEVERITIES.length);
    const applicable = a.scenarios.filter((r): r is ApplicableScenario => r.applicable);
    expect(applicable.length + a.scenarios.filter((r) => !r.applicable).length).toBe(a.scenarios.length);
    expect(a.controlSatisfied).toBeLessThanOrEqual(a.flexibleSessions);
  });

  it("keeps infeasible scenarios free of applied changes and names a binding constraint", () => {
    for (const r of a.scenarios) {
      if (!r.applicable || !r.approval.infeasible) continue;
      expect(r.approval.applied).toBe("NONE");
      expect(r.approval.binding).not.toBeNull();
    }
  });
});
