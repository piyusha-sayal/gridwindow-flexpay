/** Runs the seeded benchmark and writes artifacts/benchmark/{summary.json,requests.csv}. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { POLICIES, runBenchmark, type PolicyName } from "../src/domain/benchmark";
import { SYNTHETIC_ECONOMICS } from "../src/domain/economics";
import { DEMO_STATION } from "../src/domain/station";

const count = Number(process.argv[2] ?? "500");
if (!Number.isInteger(count) || count < 1) throw new Error("usage: tsx scripts/benchmark.ts [scenarioCount]");
const seeds = Array.from({ length: count }, (_, i) => i + 1);

const started = performance.now();
const { summary, rows } = runBenchmark(DEMO_STATION, SYNTHETIC_ECONOMICS, seeds, new Date().toISOString());
const elapsedS = ((performance.now() - started) / 1000).toFixed(1);

const outDir = path.join(process.cwd(), "artifacts", "benchmark");
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
const names = Object.keys(POLICIES) as PolicyName[];
const csv = [
  ["seed", "nightOf", "index", "portId", "targetBatteryWh", ...names.map((n) => `${n}_cost_cents`), "offers"].join(","),
  ...rows.map((r) => [r.seed, r.nightOf, r.index, r.portId, r.targetBatteryWh, ...names.map((n) => r.costCents[n] ?? ""), r.offers].join(",")),
].join("\n");
await writeFile(path.join(outDir, "requests.csv"), csv + "\n");

process.stdout.write(`benchmark: ${summary.scenarioCount} scenarios, ${summary.requestCount} requests in ${elapsedS}s\n`);
for (const p of summary.policies) {
  process.stdout.write(
    `  ${p.policy.padEnd(15)} served=${p.served} infeasible=${p.infeasible} ${JSON.stringify(p.infeasibleReasons)} violations=${p.violations} meanCost=${p.meanEnergyCostCentsPerServed}c peak=${(p.meanPeakSiteW / 1000).toFixed(2)}kW congested=${p.congestedRequests}\n`,
  );
}
for (const c of summary.pairwise) {
  process.stdout.write(`  optimized vs ${c.baseline}: requests=${c.requests} pairs=${c.pairs} excluded(baselineInfeasible=${c.excludedBaselineInfeasible} optimizedInfeasible=${c.excludedOptimizedInfeasible} both=${c.excludedBothInfeasible}) cheaper=${c.optimizedCheaper} equal=${c.equal} worse=${c.optimizedWorse} meanDelta=${c.meanDeltaCents}c\n`);
}
process.stdout.write(`  offers: ${JSON.stringify(summary.offers)}\n`);
