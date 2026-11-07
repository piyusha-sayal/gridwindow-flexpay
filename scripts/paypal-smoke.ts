/**
 * Real PayPal SANDBOX smoke test: one authorize → capture order and one authorize → void order,
 * USD 1.23 each, on api-m.sandbox.paypal.com only. A human approves each order on PayPal's own
 * sandbox checkout page; nothing here logs in or approves on the buyer's behalf.
 *
 * Without --approve-sandbox-orders it only prints the plan and exits (no network calls).
 * `--capture-only` / `--void-only` create just one order (authorize → capture, or authorize → void).
 * `--resume-order <ORDER_ID>` finishes one existing smoke order instead of creating new ones.
 * PAYPAL_SMOKE_APPROVAL_MINUTES sets the buyer approval window (default 30, max 180).
 * Requires .env.local with PAYMENT_MODE=paypal_sandbox, PAYPAL_ENV=sandbox, sandbox credentials
 * and PAYPAL_EXPECTED_MERCHANT_ID. Each run gets its own git-ignored, redacted evidence files that
 * are never overwritten: artifacts/paypal-smoke-<mode>-<runId>.progress.json after every provider
 * response, and artifacts/paypal-smoke-<mode>-<runId>.json when the run passes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PAYPAL_SANDBOX_API } from "../src/payments/paypalSandbox";
import { argValue, log, ORDER_ID_FORMAT, reportFailure, sandboxSetup } from "./paypalSandboxCli";
import { DEFAULT_APPROVAL_TIMEOUT_MS, redact, resumeSmokeOrder, runSmokeFlow, selectSmokeFlows, SMOKE_AMOUNT_CENTS, type SmokeFlow, type SmokeOptions } from "./paypalSmokeFlow";

const APPROVAL_FLAG = "--approve-sandbox-orders";
const RESUME_FLAG = "--resume-order";

/**
 * Writes a redacted artifact synchronously, so evidence survives a crash or Ctrl+C right after.
 * `create` refuses to replace an existing file, so one run can never overwrite another's evidence.
 */
function saveArtifact(file: string, data: unknown, mode: "create" | "update"): void {
  const dir = path.join(process.cwd(), "artifacts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2) + "\n", { flag: mode === "create" ? "wx" : "w" });
}

function printPlan(resumeId: string | undefined, flows: readonly SmokeFlow[]): void {
  log(`PayPal Sandbox smoke plan (${PAYPAL_SANDBOX_API}):`);
  if (resumeId) {
    log(`  resume existing order ${resumeId}: no new order → you approve on PayPal if still needed → authorize once → capture or void once (per the order's flow)`);
  } else {
    for (const flow of flows) {
      log(`  ${flow}: create AUTHORIZE order USD ${(SMOKE_AMOUNT_CENTS / 100).toFixed(2)} → you approve on PayPal → authorize → ${flow === "capture" ? "capture once → re-read capture" : "void once → re-read authorization"}`);
    }
    log(`  Orders created: ${flows.length}`);
  }
  log("  Writes are sent once each with a fixed PayPal-Request-Id; nothing is retried. Any mismatch stops the run.");
}

function approvalTimeoutMs(raw: Record<string, string | undefined>): number {
  const minutes = Number(raw.PAYPAL_SMOKE_APPROVAL_MINUTES ?? DEFAULT_APPROVAL_TIMEOUT_MS / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) throw new Error("PAYPAL_SMOKE_APPROVAL_MINUTES must be between 1 and 180");
  return minutes * 60_000;
}

async function main() {
  const resumeId = argValue(RESUME_FLAG);
  if (resumeId !== undefined && !ORDER_ID_FORMAT.test(resumeId)) throw new Error(`${RESUME_FLAG} needs a PayPal order ID (letters and digits only)`);
  const flows = selectSmokeFlows(process.argv, resumeId !== undefined);
  printPlan(resumeId, flows);
  if (!process.argv.includes(APPROVAL_FLAG)) {
    log(`\nDry run only. Re-run with ${APPROVAL_FLAG} to send these sandbox requests.`);
    return;
  }
  const { gw, expectedMerchantId, raw, clientFingerprint } = await sandboxSetup("GridWindow smoke test");
  const timeoutMs = approvalTimeoutMs(raw);

  const created: string[] = [];
  const runId = `smoke_${Date.now()}`;
  const mode = resumeId ? "resume" : flows.length === 1 ? `${flows[0]}-only` : "capture+void";
  const base = `paypal-smoke-${mode}-${runId}`;
  const progressFile = `${base}.progress.json`;
  const progress = {
    startedAt: new Date().toISOString(),
    environment: "sandbox",
    apiBase: PAYPAL_SANDBOX_API,
    clientFingerprint,
    mode,
    steps: [] as { flow: SmokeFlow; kind: string; id: string; status: string; at: string }[],
  };
  saveArtifact(progressFile, progress, "create");
  log(`Progress evidence: artifacts/${progressFile}`);
  process.once("SIGINT", () => {
    log(`\nInterrupted. No further requests will be sent. References so far: ${created.join(", ") || "none"}.`);
    log("An unapproved order cannot be charged. To finish it later without a new order, use --resume-order <ORDER_ID> (the ID printed above).");
    process.exit(130);
  });

  const options: SmokeOptions = {
    runId,
    expectedMerchantId,
    approvalTimeoutMs: timeoutMs,
    log,
    promptApproval: (flow, url) =>
      log(`[${flow}] Approve with your SANDBOX buyer account within ${Math.round(timeoutMs / 60_000)} min, then return here (the example.com page can be closed):\n  ${url}`),
    onReference: (flow, kind, id, status) => {
      created.push(`${flow}/${kind} ${kind === "order" ? id : redact(id)}`);
      progress.steps.push({ flow, kind, id: redact(id), status, at: new Date().toISOString() });
      saveArtifact(progressFile, progress, "update");
    },
  };
  const evidence = resumeId ? [await resumeSmokeOrder(gw, resumeId, options)] : await runSmokeFlow(gw, options, flows);
  const file = `${base}.json`;
  saveArtifact(file, { ranAt: new Date().toISOString(), environment: "sandbox", apiBase: PAYPAL_SANDBOX_API, clientFingerprint, mode, evidence }, "create");
  log(`PASS. Wrote artifacts/${file} (redacted).`);
}

main().catch((err: unknown) => {
  console.error(`Nothing was retried. Do not re-run blindly: a fresh run creates new orders. Redacted progress is in artifacts/paypal-smoke-*.progress.json. Inspect with npm run paypal:order -- <ORDER_ID>.`);
  reportFailure("PayPal sandbox smoke", err);
});
