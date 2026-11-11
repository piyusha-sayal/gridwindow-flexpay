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
    expect(stats.targetMissed.approval).toBe(3943);
    expect(stats.operatorEconomicsCents.appliedBelowMinimumMargin).toBe(0);
  });
});

/**
 * Figures re-pinned on 2026-11-11, after recovery stopped counting other sessions' pre-existing violations against a
 * candidate (see tests/integration/recoveryAfterDisturbance.test.ts). Before: 648 approval recoveries, 3,832 no-feasible,
 * 136 partial, 704 repaired (592 later than agreed), raw infeasible 3,882 (3,832 + 3 + 47), delivered energy +2.6 %,
 * approval-column misses 3,975. Auto-applied changes (71) and the 1 c minimum operator margin are unchanged.
 */
describe("impact-statement reconciliation (SYNTHETIC): which numbers overlap and what each denominator is", () => {
  const disturbed = app.filter((s) => !s.staticColumn.satisfied && s.affected);
  const infeasible = (s: ApplicableScenario) => s.auto.infeasible && s.approval.infeasible;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it("the four outcome classes of the 4,672 disturbed-and-missed scenarios are disjoint and add to 4,672", () => {
    const recoveredAuto = disturbed.filter((s) => s.auto.satisfied);
    const recoveredApproval = disturbed.filter((s) => !s.auto.satisfied && s.approval.satisfied);
    const noFeasible = disturbed.filter((s) => !s.auto.satisfied && !s.approval.satisfied && infeasible(s));
    const partial = disturbed.filter((s) => !s.auto.satisfied && !s.approval.satisfied && !infeasible(s));
    expect([disturbed.length, recoveredAuto.length, recoveredApproval.length, noFeasible.length, partial.length]).toEqual([4672, 56, 680, 3765, 171]);
    expect(recoveredAuto.length + recoveredApproval.length).toBe(736);
  });

  it("charger failures (1,455) are a subset of the 3,765 no-feasible-recovery cases, not an addition to them", () => {
    const failures = disturbed.filter((s) => s.type === "CHARGER_FAILURE");
    expect(failures).toHaveLength(1455);
    expect(failures.every((s) => !s.auto.satisfied && !s.approval.satisfied && infeasible(s))).toBe(true);
  });

  it("the raw 'infeasible' flag counts 3,812 = 3,765 disturbance misses + 3 pre-existing misses + the scenarios that still met the target", () => {
    const flagged = app.filter(infeasible);
    expect(flagged).toHaveLength(3812);
    const disturbedMisses = flagged.filter((s) => !s.staticColumn.satisfied && s.affected && !s.approval.satisfied);
    const preexistingMisses = flagged.filter((s) => !s.staticColumn.satisfied && !s.affected);
    const metOrUnaffected = flagged.filter((s) => s.staticColumn.satisfied || s.approval.satisfied);
    expect([disturbedMisses.length, preexistingMisses.length, metOrUnaffected.length]).toEqual([3765, 3, 44]);
  });

  it("the +2.9% delivered-energy figure is over all 5,789 applicable scenarios; over the 4,672 disturbed ones it is larger", () => {
    const all = (pick: (s: ApplicableScenario) => number) => sum(app.map(pick));
    const dist = (pick: (s: ApplicableScenario) => number) => sum(app.filter((s) => s.affected).map(pick));
    const pctAll = ((all((s) => s.approval.deliveredMilliWh) - all((s) => s.staticColumn.deliveredMilliWh)) / all((s) => s.staticColumn.deliveredMilliWh)) * 100;
    const pctDist = ((dist((s) => s.approval.deliveredMilliWh) - dist((s) => s.staticColumn.deliveredMilliWh)) / dist((s) => s.staticColumn.deliveredMilliWh)) * 100;
    console.warn("QA_RECON pctAll", pctAll.toFixed(2), "pctDisturbed", pctDist.toFixed(2), "affected", app.filter((s) => s.affected).length);
    expect(pctAll).toBeGreaterThan(2.85);
    expect(pctAll).toBeLessThan(3.0);
  });

  it("repaired is not the same as finished on time: how many of the 736 finish after the agreed ready-by", () => {
    const repaired = disturbed.filter((s) => s.auto.satisfied || s.approval.satisfied);
    const later = repaired.filter((s) => (s.auto.satisfied ? s.auto.laterFinish : s.approval.laterFinish));
    console.warn("QA_RECON repaired", repaired.length, "repairedButFinishLater", later.length);
    expect(repaired).toHaveLength(736);
    expect(later).toHaveLength(624); // repaired = energy target met; most only by finishing after the agreed ready-by, with consent
    expect(repaired.length - later.length).toBe(112);
  });
});
