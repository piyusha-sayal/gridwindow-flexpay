/**
 * Read-only preflight for the PayPal Sandbox certification through the real app. It creates NO quote row, NO order and
 * makes NO PayPal or model call. The only I/O is: opening .env.local, and a READ ONLY transaction on DATABASE_URL to
 * see which sessions already occupy the chosen nights. It prints configuration as pass/fail only, never values.
 *
 *   npm run payment:preflight -- --night-a 2026-11-24 --night-b 2026-11-25
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEMO_STATION } from "../src/domain/station";
import { ConfigError, loadEnv } from "../src/server/env";
import { checkLiveCertification } from "../src/server/liveCertification";
import { committedPlans } from "../src/server/repo";
import { demoToolsAllowed } from "../src/server/services/demoService";
import { buildScenarioSpecs, planScenario, type ScenarioPlan } from "./paymentPreflight";

const log = (msg: string) => process.stdout.write(`${msg}\n`);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

interface Check {
  name: string;
  status: "PASS" | "FAIL";
  note?: string;
}

function configChecks(env: NodeJS.ProcessEnv): Check[] {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, note?: string) => checks.push({ name, status: ok ? "PASS" : "FAIL", ...(note ? { note } : {}) });
  let parsed: ReturnType<typeof loadEnv> | null = null;
  try {
    parsed = loadEnv(env as Record<string, string | undefined>);
    add("environment loads (sandbox-only guard, credentials, merchant id format)", true);
  } catch (err) {
    add("environment loads (sandbox-only guard, credentials, merchant id format)", false, err instanceof ConfigError ? err.message : "invalid environment");
  }
  add("PAYMENT_MODE=paypal_sandbox", env.PAYMENT_MODE === "paypal_sandbox");
  add("PAYPAL_ENV=sandbox", env.PAYPAL_ENV === "sandbox");
  add("SESSION_SECRET is 32+ characters", (env.SESSION_SECRET ?? "").length >= 32);
  add("OPERATOR_PASSPHRASE is 12+ characters", (env.OPERATOR_PASSPHRASE ?? "").length >= 12);
  add("DATABASE_URL set (persistent database)", Boolean(env.DATABASE_URL));
  add("GW_ISOLATED_DB is not set", env.GW_ISOLATED_DB !== "true", "this run would refuse to start");
  add("demo reset/seed tools are closed", parsed ? !demoToolsAllowed(parsed) : env.DEMO_TOOLS !== "true", "closed by PAYMENT_MODE and DATABASE_URL as well as DEMO_TOOLS");
  // Mandatory for the live webhook certification: any unmet requirement is a FAIL and the run exits nonzero.
  for (const c of checkLiveCertification(env)) add(c.name, c.ok, c.reason);
  return checks;
}

async function main() {
  const nightA = arg("--night-a");
  const nightB = arg("--night-b");
  if (!nightA || !nightB || !NIGHT.test(nightA) || !NIGHT.test(nightB) || nightA === nightB) throw new Error("usage: payment:preflight --night-a YYYY-MM-DD --night-b YYYY-MM-DD (two different future nights)");
  process.loadEnvFile(path.join(process.cwd(), ".env.local"));

  const checks = configChecks(process.env);
  const specs = buildScenarioSpecs(nightA, nightB);
  const plans: ScenarioPlan[] = [];
  const dbNotes: string[] = [];

  if (process.env.DATABASE_URL) {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15_000 });
    await client.connect();
    try {
      // READ ONLY: any write attempt fails inside the transaction.
      await client.query("begin read only");
      const q = { query: async <T>(sql: string, params?: unknown[]) => (await client.query(sql, params as unknown[] | undefined)).rows as T[] };
      for (const spec of specs) {
        const total = Number((await q.query<{ n: string }>("select count(*) n from reservations where station_id = $1 and night_of = $2", [DEMO_STATION.id, spec.input.nightOf]))[0]!.n);
        const committed = await committedPlans(q, DEMO_STATION.id, spec.input.nightOf);
        if (total > 0) dbNotes.push(`night ${spec.input.nightOf} already has ${total} reservation(s) in the database (${committed.length} still hold capacity)`);
        plans.push(planScenario(spec, Date.now(), committed));
      }
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  } else {
    for (const spec of specs) plans.push(planScenario(spec, Date.now(), []));
    dbNotes.push("DATABASE_URL not set: previews assume an empty database");
  }

  log("== Configuration (pass/fail only; no values printed) ==");
  for (const c of checks) log(`${c.status.padEnd(11)} ${c.name}${c.status === "FAIL" && c.note ? `  [${c.note}]` : ""}`);
  log("");
  for (const p of plans) {
    log(`== Scenario ${p.spec.id}: ${p.spec.title} ==`);
    log(`night ${p.spec.input.nightOf}, ${p.spec.input.portId}, plug-in ${p.spec.input.plugInLocal}, depart ${p.spec.input.departLocal}, ${p.spec.input.targetBatteryKWh} kWh, spend cap $${(p.spec.input.spendCapCents / 100).toFixed(2)}`);
    log(`offers: ${p.allOffers.map((o) => `${o.label} ${(o.priceCents / 100).toFixed(2)} (save ${(o.discountCents / 100).toFixed(2)})`).join("; ")}`);
    log(`CHOSEN  ${p.chosen.label}: charge ${p.chosen.chargeWindow}, list $${(p.chosen.listPriceCents / 100).toFixed(2)}, discount $${(p.chosen.discountCents / 100).toFixed(2)}, terms ${p.chosen.termsHashPrefix}...`);
    log(`MAX SANDBOX AUTHORIZATION: ${p.maxAuthorizationUsd} ${p.currency} (${p.maxAuthorizationCents} cents; the server authorizes exactly this and captures at most this)`);
    log(`merchant: ${p.merchantRef} (PayPal payee must equal PAYPAL_EXPECTED_MERCHANT_ID or the order is not authorized); quote valid ${p.quoteValidMinutes} min from creation; buyer must approve before ${p.approvalDeadline} (${p.hoursUntilApprovalDeadline} h from now)`);
    for (const w of p.warnings) log(`WARNING ${w}`);
    log(`expected transitions: ${p.spec.path.join(" -> ")}`);
    log("");
  }
  for (const n of dbNotes) log(`database: ${n}`);
  const failed = checks.filter((c) => c.status === "FAIL");
  const out = { generatedAt: new Date().toISOString(), checks, plans, dbNotes, orderCreated: false };
  await mkdir(path.join(process.cwd(), "artifacts"), { recursive: true });
  const file = path.join(process.cwd(), "artifacts", `payment-preflight-${out.generatedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(out, null, 2) + "\n");
  log(`no order, quote row or provider call was made. Evidence: ${path.relative(process.cwd(), file)}`);
  if (failed.length > 0) {
    log(`NOT READY for live certification: ${failed.length} mandatory requirement(s) FAIL (exit 1). Fix each FAIL row above, then rerun.`);
    process.exit(1);
  }
  log("READY: all mandatory live-certification requirements PASS.");
}

main().catch((err: unknown) => {
  console.error(`payment preflight FAILED: ${err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "<redacted>") : "unknown"}`);
  process.exit(1);
});
