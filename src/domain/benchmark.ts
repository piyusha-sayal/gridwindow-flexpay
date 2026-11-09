/**
 * Deterministic policy benchmark over seeded synthetic nights. Reports infeasible and
 * unfavorable cases as well as wins; nothing here is real-world measurement.
 */
import { allocate, sessionCostMicrocents, committedLoadW, type AllocationPolicy } from "./allocator";
import { microcentsToCentsCeil, validateOfferEconomics, type EconomicsConfig } from "./economics";
import { mulberry32 } from "./forecast";
import { generateQuote } from "./quotes";
import { allocationContext, buildNightScenario, FORECAST_LABEL } from "./scenario";
import type { ChargeRequest, SessionPlan, StationConfig } from "./station";
import { addLocalDays, slotStartMs } from "./time";
import { validatePlans } from "./validator";

export type PolicyName = "immediate" | "static_offpeak" | "greedy_tariff" | "optimized";

export const POLICIES: Record<PolicyName, AllocationPolicy> = {
  immediate: { kind: "immediate" },
  static_offpeak: { kind: "static_offpeak", startLocalHour: 0 },
  greedy_tariff: { kind: "greedy_tariff" },
  optimized: { kind: "optimized" },
};

export interface PolicyStats {
  policy: PolicyName;
  served: number;
  infeasible: number;
  /** Allocator reason code -> count, so every unserved request is accounted for. */
  infeasibleReasons: Record<string, number>;
  violations: number;
  meanEnergyCostCentsPerServed: number;
  meanPeakSiteW: number;
  congestedRequests: number;
}

export interface PairwiseStats {
  baseline: Exclude<PolicyName, "optimized">;
  /** Requests in the benchmark; pairs + the three exclusion counts always equal this. */
  requests: number;
  pairs: number;
  excludedBaselineInfeasible: number;
  excludedOptimizedInfeasible: number;
  excludedBothInfeasible: number;
  optimizedCheaper: number;
  equal: number;
  optimizedWorse: number;
  meanDeltaCents: number;
}

export interface BenchmarkSummary {
  generatedAt: string;
  scenarioCount: number;
  requestCount: number;
  seedRange: string;
  provenance: "SYNTHETIC";
  policies: PolicyStats[];
  pairwise: PairwiseStats[];
  offers: {
    withOffer: number;
    withTwoOrMore: number;
    withZero: number;
    zeroReasons: Record<string, number>;
    offerCount: number;
    /** Driver saving: list price - offer price, per published offer. */
    meanDiscountCents: number;
    /** Operator gross energy saving: immediate modeled energy cost - offer modeled energy cost. */
    meanEnergyCostSavingCents: number;
    /** Operator net change: offer contribution - immediate contribution (after discount, assumed fee, operating cost). */
    meanOperatorImprovementCents: number;
    validatorFailures: number;
  };
  methodology: string[];
}

export interface RequestRow {
  seed: number;
  nightOf: string;
  index: number;
  portId: string;
  targetBatteryWh: number;
  costCents: Partial<Record<PolicyName, number | null>>;
  offers: number;
}

function isoDate(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** Seeded requests: one per port, evening arrivals, morning departures, 10–55 kWh. */
export function scenarioRequests(station: StationConfig, seed: number): { nightOf: string; requests: ChargeRequest[] } {
  const rand = mulberry32(seed * 104_729 + 7);
  const nightOf = isoDate(addLocalDays({ year: 2026, month: 1, day: 1 }, Math.floor(rand() * 365)));
  const scenario = buildNightScenario(station, nightOf, seed);
  const slot = (i: number) => slotStartMs(scenario.grid, i);
  const lastSlot = scenario.grid.slotCount;
  const requests = station.ports.map((port) => {
    const plugIn = Math.floor(rand() * 22); // 18:00–23:15
    const departFromEnd = 4 + Math.floor(rand() * 17); // 05:00–09:00 (non-DST nights)
    const targetBatteryWh = (10 + Math.floor(rand() * 46)) * 1000;
    return {
      portId: port.id,
      plugInMs: slot(plugIn),
      departMs: slot(lastSlot - departFromEnd),
      targetBatteryWh,
      efficiencyBp: 9_200,
      spendCapCents: 1_000_000,
    };
  });
  requests.sort((a, b) => a.plugInMs - b.plugInMs || a.portId.localeCompare(b.portId));
  return { nightOf, requests };
}

const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

export function runBenchmark(station: StationConfig, economics: EconomicsConfig, seeds: number[], generatedAt: string): { summary: BenchmarkSummary; rows: RequestRow[] } {
  const names = Object.keys(POLICIES) as PolicyName[];
  const acc = Object.fromEntries(names.map((n) => [n, { served: 0, infeasible: 0, reasons: {} as Record<string, number>, violations: 0, costs: [] as number[], peaks: [] as number[], congested: 0 }])) as Record<
    PolicyName,
    { served: number; infeasible: number; reasons: Record<string, number>; violations: number; costs: number[]; peaks: number[]; congested: number }
  >;
  const rows: RequestRow[] = [];
  const offerStats = { withOffer: 0, withTwoOrMore: 0, withZero: 0, zeroReasons: {} as Record<string, number>, discounts: [] as number[], energySavings: [] as number[], improvements: [] as number[], validatorFailures: 0 };

  for (const seed of seeds) {
    const { nightOf, requests } = scenarioRequests(station, seed);
    const scenario = buildNightScenario(station, nightOf, seed);
    const touOnly = { ...scenario.tariff, congestionSurchargeMcPerKWh: 0 };
    const seedRows: RequestRow[] = requests.map((r, index) => ({ seed, nightOf, index, portId: r.portId, targetBatteryWh: r.targetBatteryWh, costCents: {}, offers: 0 }));

    for (const name of names) {
      const committed: SessionPlan[] = [];
      requests.forEach((req, index) => {
        const ctx = allocationContext(station, scenario, committed);
        const res = allocate(ctx, req, POLICIES[name]);
        if (!res.ok) {
          acc[name].infeasible++;
          acc[name].reasons[res.reason] = (acc[name].reasons[res.reason] ?? 0) + 1;
          seedRows[index]!.costCents[name] = null;
          return;
        }
        acc[name].served++;
        const cents = microcentsToCentsCeil(res.costMicrocents);
        acc[name].costs.push(cents);
        seedRows[index]!.costCents[name] = cents;
        const tou = sessionCostMicrocents({ ...ctx, tariff: touOnly }, res.powerW, committedLoadW(committed, scenario.grid.slotCount));
        if (res.costMicrocents > tou) acc[name].congested++;
        committed.push({ sessionId: `${seed}:${index}`, portId: req.portId, plugInMs: req.plugInMs, departMs: req.departMs, powerW: res.powerW });
      });
      const targets = committed.map((p) => {
        const req = requests[Number(p.sessionId.split(":")[1])]!;
        return { sessionId: p.sessionId, targetBatteryWh: req.targetBatteryWh, efficiencyBp: req.efficiencyBp };
      });
      acc[name].violations += validatePlans(station, scenario.grid, scenario.forecastBaseLoadW, committed, targets).length;
      const ev = committedLoadW(committed, scenario.grid.slotCount);
      acc[name].peaks.push(Math.max(...ev.map((w, i) => w + (scenario.forecastBaseLoadW[i] ?? 0))));
    }

    // Offer generation as drivers would see it, arriving in order, against optimized commitments.
    const committed: SessionPlan[] = [];
    requests.forEach((req, index) => {
      const quote = generateQuote({
        ctx: allocationContext(station, scenario, committed),
        economics,
        request: { ...req, spendCapCents: Math.ceil((req.targetBatteryWh * economics.listPriceCentsPerBatteryKWh) / 1000) },
        quoteSetId: `bench_${seed}_${index}`,
        merchantRef: "benchmark",
        nowMs: 0,
        ttlMs: 1,
        forecastLabel: FORECAST_LABEL,
      });
      seedRows[index]!.offers = quote.offers.length;
      if (quote.offers.length === 0) {
        offerStats.withZero++;
        const reason = quote.baseline.feasible ? (quote.rejected[0]?.reason ?? "NONE") : `BASELINE_${quote.baseline.reason?.split(":")[0] ?? "INFEASIBLE"}`;
        offerStats.zeroReasons[reason] = (offerStats.zeroReasons[reason] ?? 0) + 1;
      } else {
        offerStats.withOffer++;
        if (quote.offers.length >= 2) offerStats.withTwoOrMore++;
      }
      for (const o of quote.offers) {
        offerStats.discounts.push(o.discountCents);
        offerStats.energySavings.push((quote.baseline.energyCostCents ?? 0) - o.energyCostCents);
        offerStats.improvements.push(o.operatorImprovementCents);
        const plan = { sessionId: o.offerId, portId: req.portId, plugInMs: req.plugInMs, departMs: req.departMs, powerW: o.powerW };
        const phys = validatePlans(station, scenario.grid, scenario.forecastBaseLoadW, [...committed, plan], [{ sessionId: o.offerId, targetBatteryWh: req.targetBatteryWh, efficiencyBp: req.efficiencyBp }]);
        const money = validateOfferEconomics(economics, { priceCents: o.priceCents, listPriceCents: o.listPriceCents, energyCostCents: o.energyCostCents, baselineEnergyCostCents: quote.baseline.energyCostCents ?? 0 });
        if (phys.length || money.length) offerStats.validatorFailures++;
      }
      // The driver accepts the first offer when one exists; otherwise charges immediately if feasible.
      const chosen = quote.offers[0]?.powerW ?? quote.baseline.powerW;
      if (chosen) committed.push({ sessionId: `${seed}:${index}`, portId: req.portId, plugInMs: req.plugInMs, departMs: req.departMs, powerW: chosen });
    });
    rows.push(...seedRows);
  }

  const pairwise = (["immediate", "static_offpeak", "greedy_tariff"] as const).map((baseline) => {
    const served = (r: RequestRow, p: PolicyName) => typeof r.costCents[p] === "number";
    const deltas = rows.filter((r) => served(r, "optimized") && served(r, baseline)).map((r) => (r.costCents.optimized as number) - (r.costCents[baseline] as number));
    return {
      baseline,
      requests: rows.length,
      pairs: deltas.length,
      excludedBaselineInfeasible: rows.filter((r) => served(r, "optimized") && !served(r, baseline)).length,
      excludedOptimizedInfeasible: rows.filter((r) => !served(r, "optimized") && served(r, baseline)).length,
      excludedBothInfeasible: rows.filter((r) => !served(r, "optimized") && !served(r, baseline)).length,
      optimizedCheaper: deltas.filter((d) => d < 0).length,
      equal: deltas.filter((d) => d === 0).length,
      optimizedWorse: deltas.filter((d) => d > 0).length,
      meanDeltaCents: mean(deltas),
    };
  });

  const summary: BenchmarkSummary = {
    generatedAt,
    scenarioCount: seeds.length,
    requestCount: rows.length,
    seedRange: `${Math.min(...seeds)}–${Math.max(...seeds)}`,
    provenance: "SYNTHETIC",
    policies: names.map((n) => ({
      policy: n,
      served: acc[n].served,
      infeasible: acc[n].infeasible,
      infeasibleReasons: acc[n].reasons,
      violations: acc[n].violations,
      meanEnergyCostCentsPerServed: mean(acc[n].costs),
      meanPeakSiteW: mean(acc[n].peaks),
      congestedRequests: acc[n].congested,
    })),
    pairwise,
    offers: {
      withOffer: offerStats.withOffer,
      withTwoOrMore: offerStats.withTwoOrMore,
      withZero: offerStats.withZero,
      zeroReasons: offerStats.zeroReasons,
      offerCount: offerStats.discounts.length,
      meanDiscountCents: mean(offerStats.discounts),
      meanEnergyCostSavingCents: mean(offerStats.energySavings),
      meanOperatorImprovementCents: mean(offerStats.improvements),
      validatorFailures: offerStats.validatorFailures,
    },
    methodology: [
      "Each scenario: one seeded synthetic night (date drawn across 2026, including DST nights) on the demo station (24 kW cap, 1 kW safety headroom, ports of 3.6, 7.2 and 11 kW), one request per port with plug-in 18:00–23:15, departure ~05:00–09:00 local, 10–55 kWh battery target, 92 % efficiency.",
      "Requests arrive in plug-in order; each policy allocates every request against the commitments it already made (no re-optimization of earlier sessions).",
      "Policies: immediate = max power from plug-in; static_offpeak = start at 00:00 local at max power; greedy_tariff = cheapest TOU slots first at max power, ignoring congestion; optimized = marginal-cost greedy over TOU + congestion surcharge in 100 W steps.",
      "Cost = synthetic TOU energy + congestion surcharge attributable to the session (forecast base load), rounded up to cents. Pairwise comparisons pair the same request; because earlier commitments differ by policy, a later request can be cheaper under a baseline.",
      "Hard violations are counted by the independent validator (station cap incl. headroom, port cap, charging while unplugged, port double-booking, energy shortfall) over each policy's final committed set.",
      "Offer statistics re-run the production quote engine with each request's spend cap set to its list price; drivers accept the first offer when one exists, otherwise charge immediately.",
      "Pairwise denominators: a request is paired only when both optimized and the baseline served it; requests a policy could not serve are listed as exclusions with reasons, so pairs + exclusions = all requests.",
      "Three distinct money measures per offer: driver discount (list price minus offer price), operator gross energy saving (immediate minus flexible modeled energy cost), and operator contribution improvement (net, after the driver discount, assumed payment fee and operating cost). Means are per published offer, not per request.",
      "All inputs are synthetic; results are not measured savings or real-world grid benefits.",
    ],
  };
  return { summary, rows };
}
