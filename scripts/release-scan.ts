/**
 * Local release scan, run by the project owner: `npm run build && npm run release:scan`.
 * Checks .next/static (browser assets) for secret shapes, sensitive variable names and the actual
 * configured values from .env.local, and checks .env.example for real-looking values.
 * Prints only file paths and variable names. Each artifact is PASS, FAIL or INCOMPLETE (could not
 * be read); exit code 0 only when every artifact is PASS. `--root <dir>` scans another checkout.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditEnvTemplate, scanClientAssets } from "./releaseScan";

const log = (msg: string) => process.stdout.write(`${msg}\n`);

function rootDir(): string {
  const i = process.argv.indexOf("--root");
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]!) : process.cwd();
}

async function readEnvFile(file: string): Promise<Record<string, string>> {
  try {
    const text = await readFile(file, "utf8");
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .filter((l) => /^[A-Z0-9_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
}

async function scanAssets(root: string): Promise<boolean> {
  const configured = { ...(await readEnvFile(path.join(root, ".env.local"))), ...process.env };
  const scan = await scanClientAssets(path.join(root, process.env.NEXT_DIST_DIR || ".next", "static"), configured);
  for (const f of scan.findings) log(`FAIL .next/static/${f.file}: ${f.what}`);
  for (const u of scan.unreadable) log(`INCOMPLETE .next/static: could not read ${path.relative(root, u) || u}`);
  if (scan.findings.length === 0 && scan.unreadable.length === 0) log(`PASS .next/static: ${scan.scannedFiles} files, no secret shapes, sensitive names or configured values`);
  return scan.findings.length === 0 && scan.unreadable.length === 0;
}

async function scanTemplate(root: string): Promise<boolean> {
  let template: string;
  try {
    template = await readFile(path.join(root, ".env.example"), "utf8");
  } catch {
    log("INCOMPLETE .env.example: could not read the file");
    return false;
  }
  const { problems, documented } = auditEnvTemplate(template);
  for (const p of problems) log(`FAIL .env.example: ${p}`);
  if (problems.length === 0) log(`PASS .env.example: placeholders only (${documented.length} keys: ${documented.join(", ")})`);
  return problems.length === 0;
}

async function main() {
  const root = rootDir();
  const assetsOk = await scanAssets(root);
  const templateOk = await scanTemplate(root);
  process.exit(assetsOk && templateOk ? 0 : 1);
}

main().catch((err: unknown) => {
  log(`INCOMPLETE release scan aborted: ${err instanceof Error ? err.name : "unknown error"}`);
  process.exit(1);
});
