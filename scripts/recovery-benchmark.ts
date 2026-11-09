/**
 * Runs the seeded recovery benchmark and writes docs/RECOVERY_BENCHMARK.md. Usage: npm run benchmark:recovery [seedCount]
 * Every figure is SYNTHETIC and modeled (see scripts/recoveryBenchmarkRun.ts for the three columns).
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { DEMO_STATION } from "../src/domain/station";
import { SYNTHETIC_ECONOMICS } from "../src/domain/economics";
import { SEVERITIES, runRecoveryBenchmark, type ApplicableScenario, type ColumnOutcome, type RecoveryBenchmarkRun, type ScenarioRecord } from "./recoveryBenchmarkRun";

const DEFAULT_SEED_COUNT = 200;
const COMMAND = "npm run benchmark:recovery";

export interface Tally {
  satisfied: number;
  shortfallMilliWh: number;
  appliedAuto: number;
  appliedApproval: number;
  satisfiedAfterApproval: number;
  awaitingApproval: number;
  infeasible: number;
  infeasibleByBinding: Record<string, number>;
  laterFinish: number;
  costUp: number;
  operatorChangeCents: number;
  /** Lowest operator margin versus the immediate baseline among applied changes (cents); null when none applied. */
  minMarginCents: number | null;
  /** Applied changes whose margin is below the accepted minimum (expect 0). */
  marginBreaches: number;
  lessThanStatic: number;
}

function emptyTally(): Tally {
  return {
    satisfied: 0,
    shortfallMilliWh: 0,
    appliedAuto: 0,
    appliedApproval: 0,
    satisfiedAfterApproval: 0,
    awaitingApproval: 0,
    infeasible: 0,
    infeasibleByBinding: {},
    laterFinish: 0,
    costUp: 0,
    operatorChangeCents: 0,
    minMarginCents: null,
    marginBreaches: 0,
    lessThanStatic: 0,
  };
}

function addColumn(t: Tally, c: ColumnOutcome, s: ApplicableScenario): void {
  if (c.satisfied) t.satisfied++;
  t.shortfallMilliWh += c.shortfallMilliWh;
  if (c.applied === "AUTO") t.appliedAuto++;
  if (c.applied === "APPROVAL") t.appliedApproval++;
  if (c.applied === "APPROVAL" && c.satisfied) t.satisfiedAfterApproval++;
  if (c.pendingApproval) t.awaitingApproval++;
  if (c.infeasible) {
    t.infeasible++;
    const key = c.binding ?? "NONE";
    t.infeasibleByBinding[key] = (t.infeasibleByBinding[key] ?? 0) + 1;
  }
  if (c.laterFinish) t.laterFinish++;
  if (c.costUpCents > 0) t.costUp++;
  if (c.operatorChangeCents !== null) t.operatorChangeCents += c.operatorChangeCents;
  if (c.marginVsBaselineCents !== null) {
    t.minMarginCents = Math.min(t.minMarginCents ?? Number.POSITIVE_INFINITY, c.marginVsBaselineCents);
    if (c.marginVsBaselineCents < SYNTHETIC_ECONOMICS.minOperatorImprovementCents) t.marginBreaches++;
  }
  if (c.deliveredMilliWh < s.staticColumn.deliveredMilliWh) t.lessThanStatic++;
}

export interface Block {
  scenarios: number;
  affected: number;
  notApplicable: number;
  staticT: Tally;
  autoT: Tally;
  approvalT: Tally;
}

/** Totals over applicable scenarios that satisfy the filter. Every column shares the same scenario denominator. */
export function blockOf(records: readonly ScenarioRecord[], keep: (r: ScenarioRecord) => boolean): Block {
  const block: Block = { scenarios: 0, affected: 0, notApplicable: 0, staticT: emptyTally(), autoT: emptyTally(), approvalT: emptyTally() };
  for (const r of records) {
    if (!keep(r)) continue;
    if (!r.applicable) {
      block.notApplicable++;
      continue;
    }
    block.scenarios++;
    if (r.affected) block.affected++;
    addColumn(block.staticT, r.staticColumn, r);
    addColumn(block.autoT, r.auto, r);
    addColumn(block.approvalT, r.approval, r);
  }
  return block;
}

const kwh = (mWh: number) => (mWh / 1_000_000).toFixed(2);
const cents = (v: number | null) => (v === null ? "-" : String(v));

function blockTable(b: Block): string {
  const s = b.staticT;
  const a = b.autoT;
  const p = b.approvalT;
  const dash = "-";
  const n = b.scenarios;
  const bindings = (t: Tally) => Object.entries(t.infeasibleByBinding).map(([k, v]) => `${k} ${v}`).join(", ") || dash;
  const rows: [string, string, string, string][] = [
    ["Scenarios run (applicable)", String(n), String(n), String(n)],
    ["Sessions affected (static delivery below undisturbed plan)", String(b.affected), String(b.affected), String(b.affected)],
    ["Satisfied on time (battery target met, of scenarios run)", `${s.satisfied} / ${n}`, `${a.satisfied} / ${n}`, `${p.satisfied} / ${n}`],
    ["Changed without driver approval", dash, String(a.appliedAuto), String(p.appliedAuto)],
    ["Served only after driver approval (target met)", dash, "0 (not applied)", `${p.satisfiedAfterApproval} (of ${p.appliedApproval} approval changes)`],
    ["Awaiting driver approval (not applied under auto-only)", dash, String(a.awaitingApproval), dash],
    ["Infeasible (no schedule passes checks), by binding constraint", dash, `${a.infeasible} (${bindings(a)})`, `${p.infeasible} (${bindings(p)})`],
    ["Energy shortfall, battery kWh (realized replay)", kwh(s.shortfallMilliWh), kwh(a.shortfallMilliWh), kwh(p.shortfallMilliWh)],
    ["Operator contribution change, modeled cents (agreed price held)", "n/m", String(a.operatorChangeCents), String(p.operatorChangeCents)],
    ["Lowest operator margin vs immediate baseline, applied changes (cents; minimum 1)", dash, cents(a.minMarginCents), cents(p.minMarginCents)],
    ["Applied changes below minimum operator margin (expect 0)", dash, String(a.marginBreaches), String(p.marginBreaches)],
    ["Finishes after agreed ready-by time", dash, String(a.laterFinish), String(p.laterFinish)],
    ["Higher energy cost than agreed plan", dash, String(a.costUp), String(p.costUp)],
    ["Recovery delivered less than static (known shortfall cases, see RECOVERY_BENCHMARK_FINDINGS.md)", dash, String(a.lessThanStatic), String(p.lessThanStatic)],
  ];
  return [
    "| Metric | STATIC (agreed plan kept) | RECOVERY, auto-commit only | RECOVERY, driver approval allowed (upper bound) |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`),
  ].join("\n");
}

function severityTable(records: readonly ScenarioRecord[], types: readonly string[]): string {
  const lines = [
    "| Type | Severity | Run | Affected | Satisfied: static | Satisfied: auto | Satisfied: approval | Infeasible (approval col.) | Awaiting approval (auto col.) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const type of types) {
    for (const sev of SEVERITIES.filter((x) => x.type === type)) {
      const b = blockOf(records, (r) => r.type === sev.type && r.severity === sev.label);
      lines.push(`| ${type} | ${sev.label} | ${b.scenarios} | ${b.affected} | ${b.staticT.satisfied} | ${b.autoT.satisfied} | ${b.approvalT.satisfied} | ${b.approvalT.infeasible} | ${b.autoT.awaitingApproval} |`);
    }
  }
  return lines.join("\n");
}

function reasonsOf(r: ApplicableScenario): string[] {
  const reasons: string[] = [];
  if (r.approval.applied === "APPROVAL") reasons.push("needs driver approval");
  if (r.approval.laterFinish) reasons.push("finishes after agreed ready-by");
  if (r.approval.costUpCents > 0) reasons.push(`energy cost up ${r.approval.costUpCents} c vs agreed plan`);
  if (r.approval.deliveredMilliWh < r.staticColumn.deliveredMilliWh) reasons.push("delivers less than static");
  return reasons;
}

function listTable(header: string, rows: string[][]): string {
  const cols = header.split("|").length - 2;
  return [header, `|${" --- |".repeat(cols)}`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

function unfavorableSection(records: readonly ScenarioRecord[]): string {
  const rows = records
    .filter((r): r is ApplicableScenario => r.applicable && reasonsOf(r).length > 0)
    .map((r) => [String(r.seed), r.portId, r.type, r.severity, reasonsOf(r).join("; ")]);
  if (rows.length === 0) return "No unfavorable cases.";
  return listTable("| Seed | Port | Type | Severity | Recovery worse than static on |", rows);
}

function infeasibleSection(records: readonly ScenarioRecord[]): string {
  const rows = records
    .filter((r): r is ApplicableScenario => r.applicable && r.approval.infeasible)
    .map((r) => [String(r.seed), r.portId, r.type, r.severity, r.approval.binding ?? "NONE", r.staticColumn.satisfied ? "yes" : "no", r.affected ? "yes" : "no"]);
  if (rows.length === 0) return "No infeasible cases.";
  return listTable("| Seed | Port | Type | Severity | Binding constraint | Static satisfied | Affected |", rows);
}

export function renderMarkdown(run: RecoveryBenchmarkRun): string {
  const seedRange = `${run.seeds[0]}..${run.seeds[run.seeds.length - 1]} (${run.seeds.length} seeds)`;
  const types = ["CHARGER_POWER_REDUCTION", "SITE_CAP_REDUCTION", "EARLY_DEPARTURE", "CHARGER_FAILURE"];
  const overall = blockOf(run.scenarios, () => true);
  const notApplicableByType = types.map((t) => `${t}: ${run.scenarios.filter((r) => !r.applicable && r.type === t).length}`).join(", ");
  const perType = types
    .map((t) => {
      const b = blockOf(run.scenarios, (r) => r.type === t);
      return `### ${t}\n\nScenarios not applicable (disturbance rejected by validation, excluded from counts): ${b.notApplicable}\n\n${blockTable(b)}`;
    })
    .join("\n\n");
  return [
    "# Recovery benchmark (SYNTHETIC, modeled)",
    "",
    `Generated by \`${COMMAND}\` (\`scripts/recovery-benchmark.ts\`, engine in \`scripts/recoveryBenchmarkRun.ts\`).`,
    `Seeds: ${seedRange}. Station: DEMO_STATION (synthetic). Economics: SYNTHETIC_ECONOMICS (assumptions, not tariffs or fees).`,
    "Deterministic: no clock, randomness, network or model. Re-running with the same seed count produces identical output.",
    "",
    "Provenance: SYNTHETIC. Seeded synthetic nights, a synthetic station and assumed economics. These are not field measurements, not real grid results and not a live PayPal or Gemini run. The recovery column uses the deterministic pipeline only (no model).",
    "",
    "## Definitions",
    "",
    "- STATIC: the agreed schedule is kept unchanged. Its delivered energy is replayed under the disturbed constraints (port caps, departure cut-off, site cap) with realized base load.",
    "- RECOVERY, auto-commit only: the validated recovery pipeline. A change that needs driver approval is not applied; the static plan stays and the change is counted as awaiting approval.",
    "- RECOVERY, approval allowed: the same pipeline with the driver approving the chosen change. Upper bound on what approval unlocks; it is not the auto-only result.",
    "- Satisfied on time: realized battery delivery before the effective departure meets the agreed battery target.",
    "- Operator contribution change: modeled from SYNTHETIC_ECONOMICS at the agreed price; energy cost difference versus the agreed plan. Static is not modeled (n/m) because a shortfall settles to operator resolution, not a capture.",
    "- Operator margin vs baseline: operator contribution after recovery minus the immediate baseline's contribution, at the agreed price. This is the accepted economics constraint (at least 1 c); recovery whose margin falls below it is never applied.",
    "- Denominators are stated in each row. Not-applicable disturbances (rejected by validation) are excluded and counted separately.",
    "",
    "## Inputs",
    "",
    `- Flexible sessions with an accepted offer: ${run.flexibleSessions}`,
    `- Control: undisturbed agreed plans that meet the battery target under realized base load: ${run.controlSatisfied} / ${run.flexibleSessions}`,
    `- Scenarios evaluated: ${run.scenarios.length} (applicable ${overall.scenarios}, not applicable ${overall.notApplicable}; ${notApplicableByType})`,
    "",
    "## Summary (all disturbance types)",
    "",
    blockTable(overall),
    "",
    "## Per disturbance type",
    "",
    perType,
    "",
    "## Per severity",
    "",
    severityTable(run.scenarios, types),
    "",
    "## Unfavorable cases (recovery worse than static on at least one metric, approval column)",
    "",
    unfavorableSection(run.scenarios),
    "",
    "## Infeasible cases (no schedule passes the checks, with the binding constraint)",
    "",
    infeasibleSection(run.scenarios),
    "",
  ].join("\n");
}

const seedCount = Number(process.argv[2] ?? DEFAULT_SEED_COUNT);
if (!Number.isInteger(seedCount) || seedCount < 1) throw new Error(`usage: ${COMMAND} [seedCount]`);
const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);

const started = performance.now();
const run = runRecoveryBenchmark(DEMO_STATION, SYNTHETIC_ECONOMICS, seeds);
const elapsedS = ((performance.now() - started) / 1000).toFixed(1);
const outFile = path.join(process.cwd(), "docs", "RECOVERY_BENCHMARK.md");
await writeFile(outFile, renderMarkdown(run));
process.stdout.write(`recovery benchmark: ${seeds.length} seeds, ${run.scenarios.length} scenarios in ${elapsedS}s -> ${outFile}\n`);
