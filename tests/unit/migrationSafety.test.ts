/**
 * QA-1 regression: ordinary startup must never modify the schema of any external database; migrations are explicit (npm run db:migrate).
 * Uses a recording fake of `pg`; nothing here opens a network connection.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "@/server/db/migrations";
import { migrationChecksum } from "@/server/db/migrator";

const sqlLog = vi.hoisted(() => ({ statements: [] as string[], applied: [] as string[], tableExists: true }));

vi.mock("pg", () => {
  const run = async (sql: string) => {
    sqlLog.statements.push(sql);
    if (/information_schema\.tables/i.test(sql)) return { rows: sqlLog.tableExists ? [{ ok: 1 }] : [] };
    if (/information_schema\.columns/i.test(sql)) return { rows: [{ ok: 1 }] };
    if (/from schema_migrations/i.test(sql)) return { rows: sqlLog.applied.map((id) => ({ id, checksum: MIGRATIONS.find((m) => m.id === id) ? migrationChecksum(MIGRATIONS.find((m) => m.id === id)!.sql) : "x" })) };
    return { rows: [] };
  };
  class Pool {
    on() {}
    query = run;
    async connect() {
      return { query: run, on() {}, off() {}, release() {} };
    }
    async end() {}
  }
  return { Pool, default: { Pool } };
});

const { openPostgres } = await import("@/server/db/client");
const { SchemaNotReadyError } = await import("@/server/db/migrator");

const HOSTED = "postgres://u:p@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const HOSTED_DIRECT = "postgres://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";
const LOCAL = "postgres://u:p@127.0.0.1:5432/gw_test";
const ddl = () => sqlLog.statements.filter((s) => /\b(create|alter|drop|insert|update|delete|truncate)\b/i.test(s) && !/select/i.test(s.split(/\s+/)[0] ?? ""));

beforeEach(() => {
  sqlLog.statements = [];
  sqlLog.applied = [];
  sqlLog.tableExists = true;
});

describe("ordinary startup against an external database", () => {
  it("sends no DDL or writes when migrations are pending, and refuses to start", async () => {
    sqlLog.applied = MIGRATIONS.slice(0, 2).map((m) => m.id); // schema stops at 002: 003-005 pending
    await expect(openPostgres(HOSTED)).rejects.toBeInstanceOf(SchemaNotReadyError);
    expect(ddl()).toEqual([]);
  });

  it("does not even create the bookkeeping table on a database that has none", async () => {
    sqlLog.tableExists = false;
    await expect(openPostgres(HOSTED)).rejects.toBeInstanceOf(SchemaNotReadyError);
    expect(ddl()).toEqual([]);
  });

  it("ignores a migration URL: startup never runs migrations through it", async () => {
    sqlLog.applied = [];
    await expect(openPostgres(HOSTED, { migrationUrl: HOSTED_DIRECT })).rejects.toBeInstanceOf(SchemaNotReadyError);
    expect(ddl()).toEqual([]);
  });

  it("starts normally, still without writes, when the schema is already current", async () => {
    sqlLog.applied = MIGRATIONS.map((m) => m.id);
    const db = await openPostgres(HOSTED);
    expect(db.kind).toBe("postgres");
    expect(ddl()).toEqual([]);
    await db.close();
  });

  it("the error names what is pending and how to migrate deliberately, without leaking credentials", async () => {
    sqlLog.applied = [MIGRATIONS[0]!.id];
    const err = (await openPostgres(HOSTED).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain(MIGRATIONS[1]!.id);
    expect(err.message).toMatch(/db:migrate/);
    expect(err.message).not.toContain("u:p@");
  });
});

describe("a loopback database is not special-cased", () => {
  it("also fails closed unless autoMigrate is explicitly requested", async () => {
    sqlLog.tableExists = false;
    await expect(openPostgres(LOCAL)).rejects.toBeInstanceOf(SchemaNotReadyError);
    expect(ddl()).toEqual([]);
  });
});
