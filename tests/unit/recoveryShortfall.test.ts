import { describe, expect, it } from "vitest";
import { SYNTHETIC_ECONOMICS } from "@/domain/economics";
import { DEMO_STATION } from "@/domain/station";
import { replayScenario, runRecoveryBenchmark, type ApplicableScenario } from "../../scripts/recoveryBenchmarkRun";
import { captureOrVoidFor, energyShortfallMilliWh } from "@/domain/deliveredEnergy";
import { energyView } from "@/server/services/recoveryReceipt";

/**
 * The seeds 1..200 benchmark has exactly three scenarios where recovery delivered less than static (four column-level
 * occurrences: one auto, three approval). Each is explained by forecast error larger than the safety headroom in a slot
 * where recovery placed power up to the forecast room limit. See docs/RECOVERY_BENCHMARK_FINDINGS.md.
 */
const KNOWN_SHORTFALLS = [
  { seed: 91, reservationId: "res_91_port_c", type: "SITE_CAP_REDUCTION", severity: "site cap 18 kW" },
  { seed: 134, reservationId: "res_134_port_c", type: "EARLY_DEPARTURE", severity: "departs 1 h early" },
  { seed: 152, reservationId: "res_152_port_c", type: "EARLY_DEPARTURE", severity: "departs 3 h early" },
] as const;

const SEEDS = [91, 134, 152];
const run = runRecoveryBenchmark(DEMO_STATION, SYNTHETIC_ECONOMICS, SEEDS);
const applicable = run.scenarios.filter((r): r is ApplicableScenario => r.applicable);
const key = (r: { seed: number; reservationId: string; type: string; severity: string }) => `${r.seed}|${r.reservationId}|${r.type}|${r.severity}`;

describe("recovery delivered less than static: known shortfall cases", () => {
  it("are exactly the known scenarios: one auto-column and three approval-column occurrences", () => {
    const worseAuto = applicable.filter((r) => r.auto.deliveredMilliWh < r.staticColumn.deliveredMilliWh);
    const worseApproval = applicable.filter((r) => r.approval.deliveredMilliWh < r.staticColumn.deliveredMilliWh);
    expect(worseAuto.map(key)).toEqual([key(KNOWN_SHORTFALLS[0])]);
    expect(worseApproval.map(key).sort()).toEqual(KNOWN_SHORTFALLS.map(key).sort());
  });

  for (const known of KNOWN_SHORTFALLS) {
    it(`explains ${known.reservationId} (${known.severity}) by forecast error beyond headroom where recovery fills the forecast room`, () => {
      const replay = replayScenario(DEMO_STATION, SYNTHETIC_ECONOMICS, known.seed, known.reservationId, known.type, known.severity);
      expect(replay).not.toBeNull();
      if (!replay) return;

      const record = applicable.find((r) => key(r) === key(known))!;
      // The replay reproduces the benchmark's static delivery exactly, so both read the same realized inputs.
      expect(replay.staticDelivered).toBe(record.staticColumn.deliveredMilliWh);

      // The planner never placed power above the room it could see from forecast (recovered slots only).
      const recoveredSlots = replay.slots.filter((s) => s.slot >= replay.effectiveSlot);
      for (const s of recoveredSlots) expect(s.recoveredW).toBeLessThanOrEqual(s.forecastRoomW);

      // The realized room is smaller than the planned power, and forecast error exceeds the safety headroom there.
      const clipped = recoveredSlots.filter((s) => s.recoveredW > s.realizedRoomW);
      expect(clipped.length).toBeGreaterThan(0);
      for (const s of clipped) {
        expect(s.actualBaseW - s.forecastBaseW).toBeGreaterThan(DEMO_STATION.safetyHeadroomW);
        expect(s.recoveredW).toBeLessThanOrEqual(s.forecastRoomW);
      }
    });
  }
});

/**
 * Forecast versus actual: the recovered plan's forecast meets the target, but the realized ledger replay falls short.
 * The shortfall is reported, the receipt exposes it and the capture decision follows actual delivery (no tolerance in terms).
 */
describe("forecast versus actual delivery on the three known shortfall cases", () => {
  const CASES = [
    { ...KNOWN_SHORTFALLS[0], column: "auto", shortfallWh: 50 },
    { ...KNOWN_SHORTFALLS[1], column: "approval", shortfallWh: 3 },
    { ...KNOWN_SHORTFALLS[2], column: "approval", shortfallWh: 15 },
  ] as const;

  for (const c of CASES) {
    it(`${c.reservationId}: forecast says met, ledger is ${c.shortfallWh} Wh short, receipt shows it, settlement voids`, () => {
      const replay = replayScenario(DEMO_STATION, SYNTHETIC_ECONOMICS, c.seed, c.reservationId, c.type, c.severity);
      expect(replay).not.toBeNull();
      if (!replay) return;
      expect(replay.decision.kind).toBe("CHOSEN");
      const record = applicable.find((r) => key(r) === key(c))!;
      const column = record[c.column];
      const { targetMilliWh, forecastBatteryMilliWh, realizedDeliveredMilliWh } = replay.recovered;

      // Forecast: the planned plan meets the agreed target.
      expect(forecastBatteryMilliWh).toBeGreaterThanOrEqual(targetMilliWh);
      // Actual: the ledger replay of the same plan is short, by the recorded amount.
      expect(realizedDeliveredMilliWh).toBe(column.deliveredMilliWh);
      expect(Math.round(energyShortfallMilliWh(targetMilliWh / 1000, realizedDeliveredMilliWh) / 1000)).toBe(c.shortfallWh);
      expect(column.shortfallMilliWh).toBe(energyShortfallMilliWh(targetMilliWh / 1000, realizedDeliveredMilliWh));

      // Receipt/view data carries the actual shortfall next to the forecast, labelled by its source.
      const view = energyView(targetMilliWh / 1000, Math.round(forecastBatteryMilliWh / 1000), realizedDeliveredMilliWh);
      expect(view.shortfallBatteryMilliWh).toBe(column.shortfallMilliWh);
      expect(view.provenance).toBe("SYNTHETIC");

      // Settlement: the recovered plan's actual delivery voids; the static plan captures only if it actually delivered.
      expect(captureOrVoidFor(targetMilliWh / 1000, realizedDeliveredMilliWh)).toBe("VOID");
      expect(captureOrVoidFor(targetMilliWh / 1000, replay.staticDelivered)).toBe(replay.staticDelivered >= targetMilliWh ? "CAPTURE" : "VOID");
    });
  }

  it("seed 91 is auto-committed on the forecast alone, while seeds 134 and 152 need driver approval", () => {
    const consentOf = (c: (typeof CASES)[number]) => {
      const replay = replayScenario(DEMO_STATION, SYNTHETIC_ECONOMICS, c.seed, c.reservationId, c.type, c.severity);
      return replay?.decision.kind === "CHOSEN" ? replay.decision.candidate.consent : null;
    };
    expect(consentOf(CASES[0])).toBe("AUTO_COMMIT");
    expect(consentOf(CASES[1])).toBe("NEEDS_DRIVER_APPROVAL");
    expect(consentOf(CASES[2])).toBe("NEEDS_DRIVER_APPROVAL");
  });
});

describe("operator economics on recovery", () => {
  // Seed 3, port_b, 75% power limit: the lowest-cost recovery raises energy cost and is auto-committed.
  const seed3 = runRecoveryBenchmark(DEMO_STATION, SYNTHETIC_ECONOMICS, [3]);
  const costRaising = seed3.scenarios.find(
    (r): r is ApplicableScenario => r.applicable && r.portId === "port_b" && r.severity === "limited to 75% of rated power",
  )!;
  const PARAMS = ["CHARGER_POWER_REDUCTION", "limited to 75% of rated power"] as const;
  const replayWithMinimum = (minOperatorImprovementCents: number) =>
    replayScenario(DEMO_STATION, SYNTHETIC_ECONOMICS, 3, costRaising.reservationId, PARAMS[0], PARAMS[1], { ...SYNTHETIC_ECONOMICS, minOperatorImprovementCents });

  it("keeps a cost-raising recovery auto-committed when the operator margin still meets the minimum", () => {
    expect(costRaising.auto.applied).toBe("AUTO");
    expect(costRaising.auto.costUpCents).toBeGreaterThan(0);
    expect(costRaising.auto.marginVsBaselineCents).not.toBeNull();
    expect(costRaising.auto.marginVsBaselineCents!).toBeGreaterThanOrEqual(SYNTHETIC_ECONOMICS.minOperatorImprovementCents);
  });

  it("blocks a recovery whose operator margin would fall below the minimum", () => {
    const replay = replayWithMinimum(1_000_000);
    expect(replay).not.toBeNull();
    // No schedule is applied. The binding label names a physical limit first when one variant is also physically blocked.
    expect(replay!.decision.kind).toBe("INFEASIBLE");
  });

  it("allows the recovery when the minimum equals its margin, and changes the outcome one cent above", () => {
    const margin = costRaising.auto.marginVsBaselineCents!;
    const atLimit = replayWithMinimum(margin);
    expect(atLimit?.decision.kind).toBe("CHOSEN");
    if (atLimit?.decision.kind !== "CHOSEN") return;
    expect(atLimit.decision.candidate.consent).toBe("AUTO_COMMIT");

    const aboveLimit = replayWithMinimum(margin + 1);
    const aboveLimitPlan = aboveLimit?.decision.kind === "CHOSEN" ? aboveLimit.decision.candidate.powerW : null;
    expect(aboveLimitPlan).not.toEqual(atLimit.decision.candidate.powerW);
  });
});
