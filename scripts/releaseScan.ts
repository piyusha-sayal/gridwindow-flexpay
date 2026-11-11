/**
 * Release secret scan helpers: client build assets and the env template. Reports only file paths
 * and variable names, never the values it found.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const SENSITIVE_KEYS = ["PAYPAL_CLIENT_SECRET", "PAYPAL_CLIENT_ID", "PAYPAL_WEBHOOK_ID", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "SESSION_SECRET", "OPERATOR_PASSPHRASE", "DATABASE_URL"] as const;

/** Shapes that must never appear in browser code, whatever the configured values are. */
const SECRET_SHAPES: [string, RegExp][] = [
  ["anthropic-key", /sk-ant-[A-Za-z0-9_-]{16,}/],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["basic-auth-header", /Basic [A-Za-z0-9+/]{40,}={0,2}/],
  ["postgres-url-with-password", /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]+@/],
];

export interface Finding {
  file: string;
  what: string;
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}

export interface AssetScan {
  findings: Finding[];
  /** Files or directories that could not be read; any entry makes the scan incomplete, never clean. */
  unreadable: string[];
  scannedFiles: number;
}

/** Scans every file under `dir` for secret shapes and for the literal configured sensitive values. */
export async function scanClientAssets(dir: string, configured: Record<string, string | undefined>): Promise<AssetScan> {
  const values = SENSITIVE_KEYS.flatMap((k) => (configured[k] && configured[k]!.length >= 8 ? [[k, configured[k]!] as const] : []));
  const findings: Finding[] = [];
  const unreadable: string[] = [];
  let files: string[];
  try {
    files = await listFiles(dir);
  } catch {
    return { findings, unreadable: [dir], scannedFiles: 0 };
  }
  if (files.length === 0) unreadable.push(`${dir} (empty: run npm run build first)`);
  let scannedFiles = 0;
  for (const file of files) {
    const rel = path.relative(dir, file);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      unreadable.push(rel);
      continue;
    }
    scannedFiles++;
    for (const [name, re] of SECRET_SHAPES) if (re.test(text)) findings.push({ file: rel, what: name });
    for (const [key, value] of values) if (text.includes(value)) findings.push({ file: rel, what: `value of ${key}` });
    for (const key of SENSITIVE_KEYS) if (text.includes(key)) findings.push({ file: rel, what: `name ${key}` });
  }
  return { findings, unreadable, scannedFiles };
}

const PLACEHOLDER = /^$|^<.*>$|^(?:change-?me|your[-_].*|replace[-_].*|xxx+|placeholder|example.*|sandbox|mock|paypal_sandbox|true|false|\d+|http:\/\/localhost.*)$/i;

/** Flags sensitive keys in an env template whose value does not look like a placeholder. */
export function auditEnvTemplate(text: string): { problems: string[]; documented: string[] } {
  const problems: string[] = [];
  const documented: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.trim().replace(/^["']|["']$/g, "");
    documented.push(key);
    if ((SENSITIVE_KEYS as readonly string[]).includes(key) && !PLACEHOLDER.test(value)) problems.push(`${key} has a non-placeholder value`);
    if (key === "PAYPAL_ENV" && value && value !== "sandbox") problems.push("PAYPAL_ENV is not sandbox");
  }
  return { problems, documented };
}
