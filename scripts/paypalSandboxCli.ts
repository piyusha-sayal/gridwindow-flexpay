/**
 * Shared CLI setup for the PayPal Sandbox scripts: reads .env.local in the owner's own session,
 * refuses anything but sandbox, and requires the expected merchant. Never prints configuration
 * values; the REST app is identified only by a one-way fingerprint of its client ID.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ProviderError } from "../src/payments/gateway";
import { PayPalSandboxGateway } from "../src/payments/paypalSandbox";
import { loadEnv } from "../src/server/env";

export const log = (msg: string) => process.stdout.write(`${msg}\n`);

/** KEY=value lines; surrounding quotes are stripped as Next.js does, so scripts and app read the same values. */
export function parseDotEnv(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => {
        const value = l.slice(l.indexOf("=") + 1).trim();
        return [l.slice(0, l.indexOf("=")), /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value];
      }),
  );
}

async function loadDotEnvLocal(): Promise<Record<string, string>> {
  try {
    return parseDotEnv(await readFile(path.join(process.cwd(), ".env.local"), "utf8"));
  } catch {
    return {};
  }
}

/** One-way fingerprint for comparing which REST app two runs used; not reversible to the client ID. */
export function credentialFingerprint(clientId: string): string {
  return createHash("sha256").update(clientId.trim()).digest("hex").slice(0, 12);
}

export interface SandboxSetup {
  gw: PayPalSandboxGateway;
  expectedMerchantId: string;
  raw: Record<string, string | undefined>;
  clientFingerprint: string;
}

export async function sandboxSetup(brandName: string): Promise<SandboxSetup> {
  const fromFile = await loadDotEnvLocal();
  const raw: Record<string, string | undefined> = { ...fromFile, ...process.env };
  const env = loadEnv(raw);
  if (env.PAYMENT_MODE !== "paypal_sandbox" || env.PAYPAL_ENV !== "sandbox") throw new Error("Set PAYMENT_MODE=paypal_sandbox and PAYPAL_ENV=sandbox in .env.local");
  const expectedMerchantId = raw.PAYPAL_EXPECTED_MERCHANT_ID?.trim();
  if (!expectedMerchantId) throw new Error("Set PAYPAL_EXPECTED_MERCHANT_ID (sandbox business account merchant ID) in .env.local; the run refuses to start without it");
  const clientFingerprint = credentialFingerprint(env.PAYPAL_CLIENT_ID!);
  const source = process.env.PAYPAL_CLIENT_ID ? "shell environment (overrides .env.local)" : ".env.local";
  log(`Sandbox REST app: client ID fingerprint ${clientFingerprint} (from ${source})`);
  if (process.env.PAYPAL_CLIENT_ID && fromFile.PAYPAL_CLIENT_ID && fromFile.PAYPAL_CLIENT_ID !== process.env.PAYPAL_CLIENT_ID) {
    log("WARNING: the shell's PAYPAL_CLIENT_ID differs from .env.local; orders made by one app are not visible to the other.");
  }
  const gw = new PayPalSandboxGateway({ clientId: env.PAYPAL_CLIENT_ID!, clientSecret: env.PAYPAL_CLIENT_SECRET!, webhookId: env.PAYPAL_WEBHOOK_ID ?? null, brandName });
  return { gw, expectedMerchantId, raw, clientFingerprint };
}

/** Value following `name` on the command line, if any. */
export function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export const ORDER_ID_FORMAT = /^[A-Z0-9]{10,30}$/;

/** Plain-language reading of an order lookup that PayPal answered with "not found". */
export function describeLookupFailure(err: unknown): string[] {
  if (!(err instanceof ProviderError) || err.httpStatus !== 404) return [];
  return [
    `PayPal does not recognise this order for the REST app these credentials belong to (${err.issue ?? "404"}). Possible causes:`,
    "  - the order was created by a different sandbox REST app or business account (compare the client ID fingerprint with the run that created it);",
    "  - the ID was mistyped (it is the token= value of the approval link, case-sensitive);",
    "  - PayPal no longer returns the order, e.g. an unapproved order past PayPal's retention (not confirmed by PayPal's public docs).",
    `Nothing was charged by this lookup. For PayPal support quote debug ID ${err.debugId ?? "(none returned)"}.`,
  ];
}

export function reportFailure(label: string, err: unknown): never {
  const e = err as { name?: string; message?: string; kind?: string; httpStatus?: number; debugId?: string; issue?: string };
  console.error(`${label} FAILED (${e.name ?? "Error"}): ${e.message ?? "unknown"} kind=${e.kind ?? "-"} status=${e.httpStatus ?? "-"} issue=${e.issue ?? "-"} debugId=${e.debugId ?? "-"}`);
  for (const line of describeLookupFailure(err)) console.error(line);
  process.exit(1);
}
