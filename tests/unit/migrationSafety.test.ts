/**
 * QA-1 regression: ordinary startup must never modify the schema of an external (non-loopback) database.
 * Uses a recording fake of `pg`; nothing here opens a network connection.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "@/server/db/migrations";

const sqlLog = vi.hoisted(() => ({ statements: [] as string[], applied: [] as string[], tableExists: true }));

vi.mock("pg", () => {
  const run = async (sql: string) => {
    sqlLog.statements.push(sql);
    if (/to_regclass/i.test(sql)) return { rows: [{ present: sqlLog.tableExists ? "schema_migrations" : null }] };
    if (/select id from schema_migrations/i.test(sql)) return { rows: sqlLog.applied.map((id) => ({ id })) };
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

const { openPostgres, SchemaNotReadyError, runExplicitMigration, describeMigrationTarget } = await import("@/server/db/client");

const HOSTED = "postgres://u:p@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const HOSTED_DIRECT = "postgres://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";
const LOCAL = "postgres://u:p@127.0.0.1:5432/gw_test";
const LATEST = MIGRATIONS[MIGRATIONS.length - 1]!.id;
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

describe("disposable local databases keep their automatic migration", () => {
  it("a loopback database is migrated on open", async () => {
    sqlLog.tableExists = false;
    await openPostgres(LOCAL).catch(() => undefined);
    expect(sqlLog.statements.some((s) => /create table if not exists schema_migrations/i.test(s))).toBe(true);
  });
});

describe("deliberate migration command", () => {
  const base = { url: HOSTED_DIRECT, confirmTarget: "ep-cool-name-123456.us-east-2.aws.neon.tech/neondb", expectLatest: LATEST };

  it("identifies the target without credentials", () => {
    expect(describeMigrationTarget(HOSTED_DIRECT)).toBe("ep-cool-name-123456.us-east-2.aws.neon.tech/neondb");
    expect(describeMigrationTarget(HOSTED_DIRECT)).not.toMatch(/u:p|sslmode/);
  });

  it("is a dry run unless apply is set: reports pending, executes nothing", async () => {
    sqlLog.applied = MIGRATIONS.slice(0, 2).map((m) => m.id);
    const out = await runExplicitMigration({ ...base, apply: false });
    expect(out.applied).toEqual([]);
    expect(out.pending).toEqual(MIGRATIONS.slice(2).map((m) => m.id));
    expect(ddl()).toEqual([]);
  });

  it("refuses when the confirmed target does not match the URL", async () => {
    await expect(runExplicitMigration({ ...base, confirmTarget: "other-host/neondb", apply: true })).rejects.toThrow(/target/i);
    expect(ddl()).toEqual([]);
  });

  it("refuses when the expected latest migration differs from this build", async () => {
    await expect(runExplicitMigration({ ...base, expectLatest: "004_recovery_orchestrator", apply: true })).rejects.toThrow(/version|latest/i);
    expect(ddl()).toEqual([]);
  });

  it("refuses a database that has applied a migration this build does not know", async () => {
    sqlLog.applied = [...MIGRATIONS.map((m) => m.id), "999_from_the_future"];
    await expect(runExplicitMigration({ ...base, apply: true })).rejects.toThrow(/unknown|newer/i);
    expect(ddl()).toEqual([]);
  });

  it("applies exactly the pending migrations, in order, when every check passes", async () => {
    sqlLog.applied = MIGRATIONS.slice(0, 2).map((m) => m.id);
    const out = await runExplicitMigration({ ...base, apply: true });
    expect(out.applied).toEqual(MIGRATIONS.slice(2).map((m) => m.id));
    const inserts = sqlLog.statements.filter((s) => /insert into schema_migrations/i.test(s));
    expect(inserts).toHaveLength(MIGRATIONS.length - 2);
  });
});
