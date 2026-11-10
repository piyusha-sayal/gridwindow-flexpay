/**
 * Explicit schema migration command (`npm run db:migrate`). Logic lives here so tests can drive it with a
 * local database; scripts/migrate.ts is the thin entry point. Output never includes the connection URL,
 * username, password or host name: the target is identified only by a one-way fingerprint of its host.
 */
import { createHash } from "node:crypto";
import type { Db } from "../src/server/db/client";
import { applyPending, describeMigration, inspectSchema, isSchemaReady, migrationChecksum, type SchemaReport } from "../src/server/db/migrator";
import { MIGRATIONS } from "../src/server/db/migrations";

export type MigrateMode = "status" | "plan" | "apply";

export interface MigrateArgs {
  mode: MigrateMode;
  /** Required for apply: must equal the target's fingerprint, as printed by --status. */
  confirm?: string;
}

export interface MigrateIo {
  connect: (url: string) => Promise<Db>;
  log: (line: string) => void;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export const USAGE = [
  "Usage:",
  "  npm run db:migrate -- --status",
  "  npm run db:migrate -- --plan",
  "  npm run db:migrate -- --apply --confirm-database <fingerprint>",
  "Target: MIGRATION_DATABASE_URL (direct URL), or DATABASE_URL when that is unset.",
].join("\n");

const MODES: Record<string, MigrateMode> = { "--status": "status", "--plan": "plan", "--apply": "apply" };

export function parseMigrateArgs(argv: readonly string[]): MigrateArgs {
  let mode: MigrateMode | undefined;
  let confirm: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (MODES[arg]) {
      if (mode) throw new UsageError("Choose exactly one of --status, --plan, --apply.");
      mode = MODES[arg];
    } else if (arg === "--confirm-database" || arg.startsWith("--confirm-database=")) {
      if (confirm !== undefined) throw new UsageError("--confirm-database was given more than once.");
      confirm = arg === "--confirm-database" ? argv[++i] : arg.slice("--confirm-database=".length);
      if (!confirm) throw new UsageError("--confirm-database needs the fingerprint printed by --status.");
    } else {
      throw new UsageError("Unknown argument. See the usage below.");
    }
  }
  if (!mode) throw new UsageError("Choose one of --status, --plan, --apply.");
  if (confirm !== undefined && mode !== "apply") throw new UsageError("--confirm-database applies only to --apply.");
  return { mode, confirm };
}

/** Twelve hex characters of SHA-256 over the host name: enough to tell targets apart, reveals nothing usable. */
export function databaseFingerprint(url: string): string {
  const host = new URL(url).hostname;
  if (!host) throw new UsageError("The target URL has no host name.");
  return createHash("sha256").update(host).digest("hex").slice(0, 12);
}

function printReport(report: SchemaReport, io: MigrateIo): void {
  const list = (ids: string[]) => (ids.length > 0 ? ids.join(", ") : "none");
  io.log(`ledger table: ${report.ledgerPresent ? "present" : "absent"}`);
  io.log(`applied (${report.applied.length}): ${list(report.applied)}`);
  io.log(`pending (${report.pending.length}): ${list(report.pending)}`);
  io.log(`recorded but unknown to this build (${report.unknown.length}): ${list(report.unknown)}`);
  io.log(`checksum changed since applied (${report.drift.length}): ${list(report.drift)}`);
  io.log(`applied before checksums were recorded (${report.unverified.length}): ${list(report.unverified)}`);
  io.log(`schema ready for this build: ${isSchemaReady(report) ? "yes" : "no"}`);
}

function printPlan(report: SchemaReport, io: MigrateIo): void {
  if (report.pending.length === 0) io.log("No pending migrations.");
  for (const m of MIGRATIONS.filter((x) => report.pending.includes(x.id))) {
    io.log(`${m.id} (sha256 ${migrationChecksum(m.sql).slice(0, 12)})`);
    for (const line of describeMigration(m)) io.log(`  ${line}`);
  }
  io.log("Plan only: nothing was changed.");
}

/** Runs one command and returns the process exit code: 0 ok, 1 not ready or failed, 2 refused. */
export async function runMigrateCommand(args: MigrateArgs, url: string, io: MigrateIo): Promise<number> {
  const fingerprint = databaseFingerprint(url);
  io.log(`target fingerprint: ${fingerprint}`);
  if (args.mode === "apply" && args.confirm !== fingerprint) {
    io.log("Refusing to apply: --confirm-database does not match the target. Run --status against this target to read its fingerprint.");
    return 2;
  }
  const db = await io.connect(url);
  try {
    const report = await inspectSchema(db);
    if (args.mode === "status") {
      printReport(report, io);
      return isSchemaReady(report) ? 0 : 1;
    }
    if (args.mode === "plan") {
      printReport(report, io);
      printPlan(report, io);
      return 0;
    }
    const applied = await applyPending(db);
    io.log(applied.length > 0 ? `Applied (${applied.length}): ${applied.join(", ")}` : "No pending migrations; nothing applied.");
    io.log("Verify with --status.");
    return 0;
  } finally {
    await db.close();
  }
}
