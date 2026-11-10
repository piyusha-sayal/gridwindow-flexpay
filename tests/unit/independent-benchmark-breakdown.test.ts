/**
 * Independent QA: why do so many scenarios miss the requested energy? Partitions the 5,789 applicable scenarios
 * (seeds 1..200) into non-overlapping causes using only fields the benchmark already records. All SYNTHETIC.
 * Assumptions are untouched. Writes artifacts/qa/evidence/benchmark-breakdown.json for the evidence package.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SYNTHETIC_ECONOMICS } from "@/domain/economics";
import { DEMO_STATION } from "@/domain/station";
import { runRecoveryBenchmark, type ApplicableScenario } from "../../scripts/recoveryBenchmarkRun";

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const run = runRecoveryBenchmark(DEMO_STATION, SYNTHETIC_ECONOMICS, SEEDS);
const app = run.scenarios.filter((s): s is ApplicableScenario => s.applicable);
const count = (f: (s: ApplicableScenario) => boolean) => app.filter(f).length;

describe("independent benchmark breakdown (SYNTHETIC)", () => {
  it("partitions every applicable scenario into exactly one outcome class per column and reconciles to the headline", () => {
    const missedStatic = app.filter((s) => !s.staticColumn.satisfied);
    // Partition of the static misses by cause.
    const preexisting = missedStatic.filter((s) => !s.affected); // the undisturbed agreed plan already missed (or tied) under realized load
    const disturbed = missedStatic.filter((s) => s.affected); // the disturbance caused the miss
    expect(preexisting.length + disturbed.length).toBe(missedStatic.length);

    const classify = (s: ApplicableScenario) => {
      if (s.auto.satisfied) return "RECOVERED_AUTO";
      if (s.approval.satisfied) return "RECOVERED_WITH_DRIVER_APPROVAL";
      if (s.auto.infeasible && s.approval.infeasible) return "NO_FEASIBLE_RECOVERY";
      return "PARTIAL_OR_UNRECOVERED_OTHER";
    };
    const byClass: Record<string, number> = {};
    for (const s of disturbed) byClass[classify(s)] = (byClass[classify(s)] ?? 0) + 1;
    expect(Object.values(byClass).reduce((a, b) => a + b, 0)).toBe(disturbed.length);

    const byType: Record<string, { n: number; missedStatic: number; missedAuto: number; missedApproval: number; noFeasible: number }> = {};
    for (const s of app) {
      const t = (byType[s.type] ??= { n: 0, missedStatic: 0, missedAuto: 0, missedApproval: 0, noFeasible: 0 });
      t.n++;
      if (!s.staticColumn.satisfied) t.missedStatic++;
      if (!s.auto.satisfied) t.missedAuto++;
      if (!s.approval.satisfied) t.missedApproval++;
      if (s.auto.infeasible && s.approval.infeasible) t.noFeasible++;
    }

    const attempts = app.filter((s) => s.affected);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const applied = (col: "auto" | "approval") => app.filter((s) => s[col].applied !== "NONE");
    const stats = {
      label: "SYNTHETIC",
      seeds: "1..200",
      scenarios: run.scenarios.length,
      notApplicable: run.scenarios.length - app.length,
      applicable: app.length,
      controlUndisturbedPlansMeetingTarget: { satisfied: run.controlSatisfied, of: run.flexibleSessions },
      disturbanceAffected: attempts.length,
      unaffected: app.length - attempts.length,
      targetMissed: { static: missedStatic.length, auto: count((s) => !s.auto.satisfied), approval: count((s) => !s.approval.satisfied) },
      staticMissCauses: { preexistingNotCausedByDisturbance: preexisting.length, causedByDisturbance: disturbed.length },
      disturbedOutcomeClasses: byClass,
      recoveryAttempts: { autoApplied: applied("auto").length, approvalApplied: applied("approval").length, needDriverApproval: count((s) => s.auto.pendingApproval) },
      deliveredEnergyMilliWh: {
        static: sum(app.map((s) => s.staticColumn.deliveredMilliWh)),
        auto: sum(app.map((s) => s.auto.deliveredMilliWh)),
        approval: sum(app.map((s) => s.approval.deliveredMilliWh)),
      },
      shortfallMilliWh: {
        static: sum(app.map((s) => s.staticColumn.shortfallMilliWh)),
        auto: sum(app.map((s) => s.auto.shortfallMilliWh)),
        approval: sum(app.map((s) => s.approval.shortfallMilliWh)),
      },
      laterFinishThanAgreed: { auto: count((s) => s.auto.laterFinish), approval: count((s) => s.approval.laterFinish) },
      operatorEconomicsCents: {
        autoAppliedCostRaising: count((s) => s.auto.applied === "AUTO" && s.auto.costUpCents > 0),
        autoEnergyCostIncreaseTotal: sum(app.map((s) => s.auto.costUpCents)),
        approvalEnergyCostIncreaseTotal: sum(app.map((s) => s.approval.costUpCents)),
        minMarginVsBaselineAuto: Math.min(...app.filter((s) => s.auto.marginVsBaselineCents !== null).map((s) => s.auto.marginVsBaselineCents!)),
        minMarginVsBaselineApproval: Math.min(...app.filter((s) => s.approval.marginVsBaselineCents !== null).map((s) => s.approval.marginVsBaselineCents!)),
        appliedBelowMinimumMargin: count((s) => [s.auto, s.approval].some((c) => c.applied !== "NONE" && (c.marginVsBaselineCents ?? 0) < 1)),
      },
      customerModeledCost: "agreed price unchanged in every applied recovery (price is taken from the accepted terms)",
      capacityViolations: "not a recorded column: recovery commits pass the deterministic capacity validator, so a violating plan cannot be applied (see commitScheduleVersion tests)",
      byDisturbanceType: byType,
      knownShortfallSeeds: [91, 134, 152],
    };
    mkdirSync("artifacts/qa/evidence", { recursive: true });
    writeFileSync("artifacts/qa/evidence/benchmark-breakdown.json", JSON.stringify(stats, null, 2));
    console.warn("QA_BREAKDOWN", JSON.stringify(stats));

    expect(stats.targetMissed.static).toBe(4677);
    expect(stats.targetMissed.auto).toBe(4621);
    expect(stats.targetMissed.approval).toBe(3975);
    expect(stats.operatorEconomicsCents.appliedBelowMinimumMargin).toBe(0);
  });
});
