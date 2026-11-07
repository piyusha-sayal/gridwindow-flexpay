import { describe, expect, it } from "vitest";
import { runBenchmark } from "@/domain/benchmark";
import { SYNTHETIC_ECONOMICS } from "@/domain/economics";
import { DEMO_STATION } from "@/domain/station";

describe("benchmark harness", () => {
  const seeds = Array.from({ length: 25 }, (_, i) => i + 1);
  const a = runBenchmark(DEMO_STATION, SYNTHETIC_ECONOMICS, seeds, "t");

  it("produces zero hard-constraint violations for every policy and zero validator failures for offers", () => {
    for (const p of a.summary.policies) expect(p.violations).toBe(0);
    expect(a.summary.offers.validatorFailures).toBe(0);
    expect(a.summary.requestCount).toBe(seeds.length * DEMO_STATION.ports.length);
  });

  it("is deterministic for fixed seeds", () => {
    const b = runBenchmark(DEMO_STATION, SYNTHETIC_ECONOMICS, seeds, "t");
    expect(b.summary).toEqual(a.summary);
  });

  it("accounts for every request under every policy (served + infeasible)", () => {
    for (const p of a.summary.policies) expect(p.served + p.infeasible).toBe(a.summary.requestCount);
  });
});
