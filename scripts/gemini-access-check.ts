/**
 * Model-access check for Gemini: exactly ONE models.get metadata request (no generation, no tokens, no retries).
 * Dry run by default: prints the plan and does not open .env.local. With --approve-metadata-call it reads only the
 * allowlisted Gemini keys from .env.local, makes the one request, and writes a sanitized artifact.
 *   npm run ai:access -- --model=gemini-3.6-flash                           (dry run)
 *   npm run ai:access -- --model=gemini-3.6-flash --approve-metadata-call   (one metadata request)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GEMINI_MODEL, GeminiLlm } from "../src/server/ai/geminiLlm";
import { METADATA_APPROVAL_FLAG, planAccessCheck, summarizeAccess } from "./geminiAccessCheckFlow";
import { pickLiveEnv } from "./recoveryLiveFlow";

const log = (line: string) => void process.stdout.write(line + "\n");

async function main(): Promise<void> {
  const plan = planAccessCheck(process.argv, DEFAULT_GEMINI_MODEL);
  log(`Gemini model-access check: models.get(${plan.model}), one metadata request, no generation, no retries, no tokens.`);
  if (!plan.approved) {
    log(`Dry run only. The .env.local file is not opened and no request is sent. Re-run with ${METADATA_APPROVAL_FLAG} to make the one request.`);
    return;
  }
  const fileEnv = pickLiveEnv(await readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => ""));
  const apiKey = fileEnv.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in .env.local");
  const started = Date.now();
  const result = await GeminiLlm.checkModelAccess(apiKey, plan.model);
  const evidence = summarizeAccess(plan.model, result, Date.now() - started, new Date().toISOString());
  const dir = path.join(process.cwd(), "artifacts");
  await mkdir(dir, { recursive: true });
  const file = `gemini-access-${evidence.ranAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(path.join(dir, file), JSON.stringify(evidence, null, 2), { flag: "wx" });
  log(`available=${evidence.available} generateContent=${evidence.supportsGenerateContent} inputTokenLimit=${evidence.inputTokenLimit ?? "-"} latency=${evidence.latencyMs}ms verdict=${evidence.verdict}`);
  if (evidence.diagnostic) log(`diagnostic: ${JSON.stringify(evidence.diagnostic)}`);
  log(`Evidence: artifacts/${file}`);
  process.exitCode = evidence.verdict === "PASS" ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(`Access check stopped: ${err instanceof Error ? err.message : "unknown error"}. Nothing was retried.`);
  process.exitCode = 1;
});
