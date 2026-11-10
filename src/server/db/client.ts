/**
 * Minimal SQL client abstraction over PGlite (embedded PostgreSQL) or node-postgres.
 * The same SQL and migrations run on both.
 */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Pool } from "pg";
import { applyPending, assertSchemaReady } from "./migrator";

/** Upper bound for opening one database connection, so an unreachable or suspended server fails the request instead of hanging it. */
export const PG_CONNECT_TIMEOUT_MS = 15_000;

export interface PostgresOptions {
  /**
   * Direct (non-pooled) URL used for migrations when autoMigrate is set; DDL should not run through a transaction pooler.
   * Ignored otherwise: the default path only reads the ledger, through connectionString.
   */
  migrationUrl?: string;
  connectionTimeoutMs?: number;
  /**
   * Apply pending migrations on open. Off by default: an external PostgreSQL must be migrated with `npm run db:migrate`,
   * and the app refuses to open a database whose schema does not match this build. Only for disposable databases.
   */
  autoMigrate?: boolean;
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

async function lock(q: Queryable, lockKey?: string): Promise<void> {
  if (lockKey) await q.query("select pg_advisory_xact_lock(hashtext($1))", [lockKey]);
}

export interface PgliteOptions {
  /** Default true: PGlite is embedded and owned by this process. Tests that need a bare database pass false. */
  autoMigrate?: boolean;
}

export async function openPglite(dataDir?: string, options: PgliteOptions = {}): Promise<Db> {
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
  if (options.autoMigrate ?? true) await applyPending(db);
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

/** Connects without checking or changing the schema. Used by the migration command, which inspects first. */
export async function connectPostgres(connectionString: string, connectionTimeoutMs = PG_CONNECT_TIMEOUT_MS): Promise<Db> {
  return postgresDb(await newPool(connectionString, 10, connectionTimeoutMs));
}

/**
 * Opens an external PostgreSQL database. Default: the schema must already match this build, otherwise this throws
 * SchemaNotReadyError and the app serves nothing. Migrations run only with autoMigrate (disposable databases).
 */
export async function openPostgres(connectionString: string, options: PostgresOptions = {}): Promise<Db> {
  const timeout = options.connectionTimeoutMs ?? PG_CONNECT_TIMEOUT_MS;
  if (options.autoMigrate && options.migrationUrl) {
    const admin = postgresDb(await newPool(options.migrationUrl, 1, timeout));
    try {
      await applyPending(admin);
    } finally {
      await admin.close();
    }
  }
  const db = await connectPostgres(connectionString, timeout);
  try {
    if (options.autoMigrate) await applyPending(db);
    else await assertSchemaReady(db);
  } catch (err) {
    await db.close().catch(() => undefined);
    throw err;
  }
  return db;
}
