/**
 * Independent QA verification of the recovery benchmark (all figures SYNTHETIC).
 * Recomputes the headline claims from raw scenario records instead of trusting docs/RECOVERY_BENCHMARK_FINDINGS.md.
 * Does not modify the benchmark or its documentation.
 */
import { describe, expect, it } from "vitest";
import { SYNTHETIC_ECONOMICS } from "@/domain/economics";
import { DEMO_STATION } from "@/domain/station";
import { runRecoveryBenchmark, type ApplicableScenario } from "../../scripts/recoveryBenchmarkRun";

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const run = runRecoveryBenchmark(DEMO_STATION, SYNTHETIC_ECONOMICS, SEEDS);
const applicable = run.scenarios.filter((s): s is ApplicableScenario => s.applicable);

describe("independent recovery benchmark verification (SYNTHETIC)", () => {
  it("is deterministic: two runs over seeds 1..200 are identical", () => {
    const again = runRecoveryBenchmark(DEMO_STATION, SYNTHETIC_ECONOMICS, SEEDS);
    expect(JSON.stringify(again)).toBe(JSON.stringify(run));
  });

  it("recovery never delivers less than static except in exactly seeds 91, 134, 152", () => {
    const worse = applicable.filter((s) => s.auto.deliveredMilliWh < s.staticColumn.deliveredMilliWh || s.approval.deliveredMilliWh < s.staticColumn.deliveredMilliWh);
    expect([...new Set(worse.map((s) => s.seed))].sort((a, b) => a - b)).toEqual([91, 134, 152]);
  });

  it("known shortfalls are reproduced: 50 Wh (91, auto+approval), 3 Wh (134, approval), 15 Wh (152, approval)", () => {
    const get = (seed: number) => applicable.filter((s) => s.seed === seed && (s.auto.deliveredMilliWh < s.staticColumn.deliveredMilliWh || s.approval.deliveredMilliWh < s.staticColumn.deliveredMilliWh));
    const [s91] = get(91);
    const [s134] = get(134);
    const [s152] = get(152);
    expect(Math.round(s91!.auto.shortfallMilliWh / 1000)).toBe(50);
    expect(Math.round(s91!.approval.shortfallMilliWh / 1000)).toBe(50);
    expect(Math.round(s134!.approval.shortfallMilliWh / 1000)).toBe(3);
    expect(Math.round(s152!.approval.shortfallMilliWh / 1000)).toBe(15);
    expect(s134!.auto.shortfallMilliWh).toBeLessThanOrEqual(s134!.staticColumn.shortfallMilliWh);
  });

  it("56 auto-applied recoveries raised energy cost, and every one keeps operator margin >= 1 c vs the immediate baseline", () => {
    const raised = applicable.filter((s) => s.auto.applied === "AUTO" && s.auto.costUpCents > 0);
    expect(raised).toHaveLength(56);
    for (const s of raised) {
      expect(s.auto.marginVsBaselineCents).not.toBeNull();
      expect(s.auto.marginVsBaselineCents!).toBeGreaterThanOrEqual(1);
    }
  });

  it("no applied change anywhere (auto or approval) violates the documented minimum operator margin", () => {
    for (const s of applicable) {
      for (const col of [s.auto, s.approval]) {
        if (col.applied !== "NONE") expect(col.marginVsBaselineCents).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("reports unfavorable aggregates honestly (printed, not asserted away)", () => {
    const unsatisfied = (pick: (s: ApplicableScenario) => { satisfied: boolean }) => applicable.filter((s) => !pick(s).satisfied).length;
    const stats = {
      scenarios: run.scenarios.length,
      applicable: applicable.length,
      affectedByDisturbance: applicable.filter((s) => s.affected).length,
      targetMissedStatic: unsatisfied((s) => s.staticColumn),
      targetMissedAuto: unsatisfied((s) => s.auto),
      targetMissedApproval: unsatisfied((s) => s.approval),
      infeasibleAuto: applicable.filter((s) => s.auto.infeasible).length,
      pendingApproval: applicable.filter((s) => s.auto.pendingApproval).length,
      autoLaterFinish: applicable.filter((s) => s.auto.laterFinish).length,
      label: "SYNTHETIC",
    };
    console.warn("QA_BENCHMARK_STATS", JSON.stringify(stats));
    expect(stats.scenarios).toBe(5820);
    // Recovery must not make the driver's outcome worse in aggregate.
    expect(stats.targetMissedAuto).toBeLessThanOrEqual(stats.targetMissedStatic);
    expect(stats.targetMissedApproval).toBeLessThanOrEqual(stats.targetMissedAuto);
  });
});
