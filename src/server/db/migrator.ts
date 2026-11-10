/**
 * Migration ledger, read-only schema inspection and the apply runner. Shared by the explicit
 * `npm run db:migrate` command, the boot check on external PostgreSQL, and the auto-migrate path
 * (PGlite and disposable test databases only; see client.ts).
 */
import { createHash } from "node:crypto";
import type { Db, Queryable } from "./client";
import { MIGRATIONS, type Migration } from "./migrations";

/** Same key as earlier builds, so runners from old and new code still serialize. */
export const MIGRATION_LOCK_KEY = "gridwindow:migrations";

export function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export interface SchemaReport {
  ledgerPresent: boolean;
  /** Ids this build knows that the ledger records (includes drift and unverified). */
  applied: string[];
  /** Ids this build knows that the ledger does not record yet. */
  pending: string[];
  /** Ids the ledger records that this build does not know: the database is ahead of this code. */
  unknown: string[];
  /** Applied ids whose recorded checksum differs from this build's SQL. */
  drift: string[];
  /** Applied ids recorded before checksums existed. They cannot be verified; this is not a failure. */
  unverified: string[];
}

export function isSchemaReady(report: SchemaReport): boolean {
  return report.pending.length === 0 && report.unknown.length === 0 && report.drift.length === 0;
}

/** Names of problems only: ids and fixed wording, never connection details. */
export function describeProblems(report: SchemaReport): string {
  const parts: string[] = [];
  if (report.pending.length > 0) parts.push(`pending: ${report.pending.join(", ")}`);
  if (report.unknown.length > 0) parts.push(`recorded but unknown to this build: ${report.unknown.join(", ")}`);
  if (report.drift.length > 0) parts.push(`checksum changed since applied: ${report.drift.join(", ")}`);
  return parts.join("; ");
}

export class SchemaNotReadyError extends Error {
  constructor(readonly report: SchemaReport) {
    super(
      `Database schema is not ready for this build (${describeProblems(report)}). ` +
        `The app does not migrate external PostgreSQL on startup. Run "npm run db:migrate -- --status", review with "--plan", then apply deliberately (docs/MIGRATIONS.md).`,
    );
    this.name = "SchemaNotReadyError";
  }
}

/** Read-only: never creates the ledger. A missing ledger means every migration is pending. */
export async function inspectSchema(q: Queryable, migrations: readonly Migration[] = MIGRATIONS): Promise<SchemaReport> {
  const ledger = await q.query("select 1 as ok from information_schema.tables where table_schema = current_schema() and table_name = 'schema_migrations'");
  const ledgerPresent = ledger.length > 0;
  let recorded = new Map<string, string | null>();
  if (ledgerPresent) {
    const withChecksum = await q.query("select 1 as ok from information_schema.columns where table_schema = current_schema() and table_name = 'schema_migrations' and column_name = 'checksum'");
    const column = withChecksum.length > 0 ? "checksum" : "null::text as checksum";
    const rows = await q.query<{ id: string; checksum: string | null }>(`select id, ${column} from schema_migrations`);
    recorded = new Map(rows.map((r) => [r.id, r.checksum]));
  }
  const status = migrations.map((m) => ({ id: m.id, recorded: recorded.has(m.id), checksum: recorded.get(m.id) ?? null, expected: migrationChecksum(m.sql) }));
  const known = new Set(migrations.map((m) => m.id));
  return {
    ledgerPresent,
    applied: status.filter((s) => s.recorded).map((s) => s.id),
    pending: status.filter((s) => !s.recorded).map((s) => s.id),
    unknown: [...recorded.keys()].filter((id) => !known.has(id)).sort(),
    drift: status.filter((s) => s.checksum !== null && s.checksum !== s.expected).map((s) => s.id),
    unverified: status.filter((s) => s.recorded && s.checksum === null).map((s) => s.id),
  };
}

/** Throws unless the database matches this build exactly (no pending, unknown or drifted migrations). */
export async function assertSchemaReady(q: Queryable, migrations: readonly Migration[] = MIGRATIONS): Promise<void> {
  const report = await inspectSchema(q, migrations);
  if (!isSchemaReady(report)) throw new SchemaNotReadyError(report);
}

/** Problems with the migration list itself: duplicate or malformed ids, or ids out of order. */
export function migrationListProblems(list: readonly Migration[]): string[] {
  const ids = list.map((m) => m.id);
  const problems: string[] = [];
  if (new Set(ids).size !== ids.length) problems.push("duplicate migration id");
  for (const id of ids) if (!/^\d{3}_[a-z0-9_]+$/.test(id)) problems.push(`malformed id ${id}`);
  if ([...ids].sort().join("\n") !== ids.join("\n")) problems.push("ids are not in ascending order");
  return problems;
}

/** Top-level statements with comments and dollar-quoted bodies removed. */
export function splitStatements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

const CREATE_OBJECT = /^create (unique )?(table|index|function|trigger) (?:if not exists )?(\w+)/i;
const ALTER_TABLE = /^alter table (\w+) (.*)$/i;

function describeStatement(statement: string): string[] {
  const created = CREATE_OBJECT.exec(statement);
  if (created) return [`CREATE ${created[1] ? "UNIQUE " : ""}${created[2]!.toUpperCase()} ${created[3]}`];
  const altered = ALTER_TABLE.exec(statement);
  if (altered) {
    const columns = [...altered[2]!.matchAll(/add column (?:if not exists )?(\w+)/gi)].map((m) => `ALTER TABLE ${altered[1]} ADD COLUMN ${m[1]}`);
    return columns.length > 0 ? columns : [`ALTER TABLE ${altered[1]}: ${altered[2]!.slice(0, 80)}`];
  }
  return [];
}

/** Object-level summary of what a migration creates or alters, in statement order (for `--plan`). */
export function describeMigration(m: Migration): string[] {
  return splitStatements(m.sql).flatMap(describeStatement);
}

/** Creates the ledger if needed and adds the checksum column to ledgers written by older builds. */
export async function ensureLedger(q: Queryable): Promise<void> {
  await q.query("create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now(), checksum text)");
  await q.query("alter table schema_migrations add column if not exists checksum text");
}

/** One migration, its ledger row and the adoption of a legacy checksum, in one transaction under the advisory lock. */
async function applyOne(db: Db, m: Migration): Promise<boolean> {
  const checksum = migrationChecksum(m.sql);
  return db.tx(async (q) => {
    await ensureLedger(q);
    const [row] = await q.query<{ checksum: string | null }>("select checksum from schema_migrations where id = $1", [m.id]);
    if (row) {
      if (row.checksum === null) await q.query("update schema_migrations set checksum = $2 where id = $1", [m.id, checksum]);
      else if (row.checksum !== checksum) throw new Error(`Migration ${m.id} changed after it was applied; refusing to continue.`);
      return false;
    }
    await q.query(m.sql);
    await q.query("insert into schema_migrations (id, checksum) values ($1, $2)", [m.id, checksum]);
    return true;
  }, MIGRATION_LOCK_KEY);
}

/**
 * Applies pending migrations in list order, each in its own transaction, serialized by the advisory lock.
 * Refuses (throws SchemaNotReadyError) when the ledger holds unknown ids or checksum drift. Returns the ids applied now.
 */
export async function applyPending(db: Db, migrations: readonly Migration[] = MIGRATIONS): Promise<string[]> {
  const before = await inspectSchema(db, migrations);
  if (before.unknown.length > 0 || before.drift.length > 0) throw new SchemaNotReadyError(before);
  if (before.pending.length === 0 && before.unverified.length === 0) return [];
  const applied: string[] = [];
  for (const m of migrations) {
    if (await applyOne(db, m)) applied.push(m.id);
  }
  return applied;
}
