/**
 * Deliberate migration of an external PostgreSQL database. The app never does this at startup.
 *
 *   Dry run (changes nothing):
 *     npx tsx scripts/db-migrate.ts --confirm-target=<host/database> --expect-latest=<migration id>
 *   Execute:
 *     npx tsx scripts/db-migrate.ts --confirm-target=<host/database> --expect-latest=<migration id> --apply
 *
 * The URL comes from MIGRATION_DATABASE_URL, else DATABASE_URL, in the process environment (this script does not
 * read .env files). Prefer a direct, non-pooled URL. Run it against a Neon branch first.
 */
import { MIGRATIONS } from "../src/server/db/migrations";
import { describeMigrationTarget, runExplicitMigration } from "../src/server/db/client";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  const latest = MIGRATIONS[MIGRATIONS.length - 1]!.id;
  if (!url) throw new Error("Set MIGRATION_DATABASE_URL (or DATABASE_URL) in the environment.");
  const target = describeMigrationTarget(url);
  console.warn(`target:        ${target}`);
  console.warn(`build latest:  ${latest}`);
  const confirmTarget = arg("confirm-target");
  const expectLatest = arg("expect-latest");
  if (!confirmTarget || !expectLatest) {
    throw new Error(`Both --confirm-target=${target} and --expect-latest=${latest} are required. Nothing was changed.`);
  }
  const apply = process.argv.includes("--apply");
  const out = await runExplicitMigration({ url, confirmTarget, expectLatest, apply });
  console.warn(apply ? `applied:       ${out.applied.join(", ") || "(nothing pending)"}` : `DRY RUN. pending: ${out.pending.join(", ") || "(none)"}. Add --apply to execute.`);
}

main().catch((err: unknown) => {
  console.error(`db:migrate failed: ${err instanceof Error ? err.message : "unknown error"}`);
  process.exitCode = 1;
});
