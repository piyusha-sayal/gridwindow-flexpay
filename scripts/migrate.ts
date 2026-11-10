/**
 * Entry point for `npm run db:migrate`. Reads .env.local in the owner's own session (existing shell variables win),
 * then runs one explicit mode. See docs/MIGRATIONS.md before using --apply on any real database.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { connectPostgres } from "../src/server/db/client";
import { SchemaNotReadyError } from "../src/server/db/migrator";
import { parseMigrateArgs, runMigrateCommand, UsageError, USAGE } from "./migrateCli";

const log = (line: string) => process.stdout.write(`${line}\n`);

/** Prints the error class, driver code and a message with the host name redacted: driver messages can echo the host. */
function describeFailure(err: unknown, url: string): string {
  if (err instanceof SchemaNotReadyError) return err.message;
  const code = (err as { code?: unknown } | null)?.code;
  const host = hostOf(url);
  const detail = err instanceof Error && host ? err.message.replaceAll(host, "<target host>") : "";
  return `Migration command failed: ${err instanceof Error ? err.name : "UnknownError"}${code ? ` (code ${String(code)})` : ""}. ${detail}`.trim();
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

async function main(): Promise<number> {
  const envFile = path.join(process.cwd(), ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  let args;
  try {
    args = parseMigrateArgs(process.argv.slice(2));
  } catch (err) {
    log(err instanceof UsageError ? `${err.message}\n${USAGE}` : USAGE);
    return 2;
  }
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    log(`No target database. Set MIGRATION_DATABASE_URL (direct URL) or DATABASE_URL.\n${USAGE}`);
    return 2;
  }
  try {
    return await runMigrateCommand(args, url, { connect: connectPostgres, log });
  } catch (err) {
    log(describeFailure(err, url));
    return 1;
  }
}

main().then((code) => {
  process.exitCode = code;
});
