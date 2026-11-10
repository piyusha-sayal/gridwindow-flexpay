/**
 * Minimal SQL client abstraction over PGlite (embedded PostgreSQL) or node-postgres.
 * The same SQL and migrations run on both.
 */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Pool } from "pg";
import { MIGRATIONS } from "./migrations";

/** Upper bound for opening one database connection, so an unreachable or suspended server fails the request instead of hanging it. */
export const PG_CONNECT_TIMEOUT_MS = 15_000;

export interface PostgresOptions {
  /** Direct (non-pooled) URL used only to apply migrations; DDL should not run through a transaction pooler. */
  migrationUrl?: string;
  connectionTimeoutMs?: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Runs fn in a transaction; `lockKey` serializes writers for e.g. one station-night. */
  tx<T>(fn: (q: Queryable) => Promise<T>, lockKey?: string): Promise<T>;
  close(): Promise<void>;
  readonly kind: "pglite" | "postgres";
}

/**
 * Applies pending migrations in one transaction under an advisory lock, so several processes starting
 * against the same PostgreSQL server serialize instead of racing (concurrent CREATE TABLE fails there).
 */
async function migrate(db: Db): Promise<void> {
  await db.tx(async (q) => {
    await q.query("create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())");
    const applied = new Set((await q.query<{ id: string }>("select id from schema_migrations")).map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      await q.query(m.sql);
      await q.query("insert into schema_migrations (id) values ($1)", [m.id]);
    }
  }, "gridwindow:migrations");
}

async function lock(q: Queryable, lockKey?: string): Promise<void> {
  if (lockKey) await q.query("select pg_advisory_xact_lock(hashtext($1))", [lockKey]);
}

export async function openPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) await mkdir(dirname(dataDir), { recursive: true });
  const pg = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
  const db: Db = {
    kind: "pglite",
    async query<T>(sql: string, params?: unknown[]) {
      if (!params || params.length === 0) {
        const results = await pg.exec(sql);
        return (results[results.length - 1]?.rows ?? []) as T[];
      }
      return (await pg.query<T>(sql, params)).rows;
    },
    tx(fn, lockKey) {
      return pg.transaction(async (t) => {
        const q: Queryable = {
          async query<T>(sql: string, params?: unknown[]) {
            if (!params || params.length === 0) {
              const results = await t.exec(sql);
              return (results[results.length - 1]?.rows ?? []) as T[];
            }
            return (await t.query<T>(sql, params)).rows;
          },
        };
        await lock(q, lockKey);
        return fn(q);
      });
    },
    close: () => pg.close(),
  };
  await migrate(db);
  return db;
}

async function newPool(connectionString: string, max: number, connectionTimeoutMillis: number): Promise<Pool> {
  const { Pool: PgPool } = await import("pg");
  const pool = new PgPool({ connectionString, max, connectionTimeoutMillis });
  // An idle client dropped by a server restart emits 'error'; unhandled, it would crash the process.
  pool.on("error", (err) => console.warn("[gridwindow] idle database connection lost:", err.message));
  return pool;
}

function postgresDb(pool: Pool): Db {
  return {
    kind: "postgres",
    async query<T>(sql: string, params?: unknown[]) {
      return (await pool.query(sql, params as unknown[] | undefined)).rows as T[];
    },
    async tx(fn, lockKey) {
      const client = await pool.connect();
      // A checked-out client has no pool listener: a connection dropped between queries would otherwise
      // be an uncaught 'error' that kills the process. The transaction's next query fails instead.
      let lost: Error | undefined;
      const onError = (err: Error) => {
        lost = err;
        console.warn("[gridwindow] database connection lost during a transaction:", err.message);
      };
      client.on("error", onError);
      try {
        await client.query("begin");
        const q: Queryable = { query: async <T>(sql: string, params?: unknown[]) => (await client.query(sql, params as unknown[] | undefined)).rows as T[] };
        await lock(q, lockKey);
        const out = await fn(q);
        await client.query("commit");
        return out;
      } catch (err) {
        await client.query("rollback").catch((e: Error) => {
          lost ??= e;
        });
        throw err;
      } finally {
        client.off("error", onError);
        // A broken connection is destroyed rather than returned to the pool.
        client.release(lost);
      }
    },
    close: () => pool.end(),
  };
}

/** Thrown at startup when an external database is missing migrations. Startup never applies them; see `npm run db:migrate`. */
export class SchemaNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaNotReadyError";
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Only a loopback server is treated as disposable. Anything else is external and is never migrated implicitly. */
export function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** `host/database` with no credentials or query string, for confirmation and error messages. */
export function describeMigrationTarget(url: string): string {
  const u = new URL(url);
  return `${u.host}${u.pathname}`;
}

/** Read-only: which known migrations are missing, and which applied ones this build does not know. Never creates anything. */
async function migrationState(q: Queryable): Promise<{ pending: string[]; unknown: string[] }> {
  const present = await q.query<{ present: string | null }>("select to_regclass('schema_migrations') as present");
  const applied = new Set(present[0]?.present ? (await q.query<{ id: string }>("select id from schema_migrations")).map((r) => r.id) : []);
  const known = new Set(MIGRATIONS.map((m) => m.id));
  return { pending: MIGRATIONS.filter((m) => !applied.has(m.id)).map((m) => m.id), unknown: [...applied].filter((id) => !known.has(id)) };
}

export interface ExplicitMigrationInput {
  url: string;
  /** Must equal `describeMigrationTarget(url)`: the operator re-types the target they intend to change. */
  confirmTarget: string;
  /** Must equal the newest migration id compiled into this build. */
  expectLatest: string;
  /** False reports what would run and changes nothing. */
  apply: boolean;
}

/**
 * The only path that migrates an external database. Refuses unless the target and version were confirmed, and
 * refuses a database that is ahead of this build. Dry run unless `apply` is true.
 */
export async function runExplicitMigration(input: ExplicitMigrationInput): Promise<{ target: string; pending: string[]; applied: string[] }> {
  const target = describeMigrationTarget(input.url);
  if (input.confirmTarget !== target) throw new Error(`Target mismatch: the URL points at "${target}" but "${input.confirmTarget}" was confirmed. Nothing was changed.`);
  const latest = MIGRATIONS[MIGRATIONS.length - 1]!.id;
  if (input.expectLatest !== latest) throw new Error(`Version check failed: this build's latest migration is "${latest}" but "${input.expectLatest}" was expected. Nothing was changed.`);
  const pool = await newPool(input.url, 1, PG_CONNECT_TIMEOUT_MS);
  try {
    const db = postgresDb(pool);
    const { pending, unknown } = await migrationState(db);
    if (unknown.length > 0) throw new Error(`The database has migrations this build does not know (${unknown.join(", ")}); it is newer than this code. Nothing was changed.`);
    if (!input.apply) return { target, pending, applied: [] };
    await migrate(db);
    return { target, pending, applied: pending };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function openPostgres(connectionString: string, options: PostgresOptions = {}): Promise<Db> {
  const timeout = options.connectionTimeoutMs ?? PG_CONNECT_TIMEOUT_MS;
  if (!isLoopbackUrl(connectionString)) {
    // External database: verify only. A migration URL is deliberately ignored here.
    const pool = await newPool(connectionString, 10, timeout);
    const db = postgresDb(pool);
    try {
      const { pending } = await migrationState(db);
      if (pending.length > 0) {
        throw new SchemaNotReadyError(
          `Database ${describeMigrationTarget(connectionString)} is missing migrations: ${pending.join(", ")}. Startup does not migrate external databases; run "npm run db:migrate" deliberately.`,
        );
      }
    } catch (err) {
      await pool.end().catch(() => undefined);
      throw err;
    }
    return db;
  }
  if (options.migrationUrl) {
    const admin = await newPool(options.migrationUrl, 1, timeout);
    try {
      await migrate(postgresDb(admin));
    } finally {
      await admin.end();
    }
  }
  const pool = await newPool(connectionString, 10, timeout);
  const db = postgresDb(pool);
  try {
    // With a migration URL this only confirms that nothing is pending.
    await migrate(db);
  } catch (err) {
    await pool.end().catch(() => undefined);
    throw err;
  }
  return db;
}
