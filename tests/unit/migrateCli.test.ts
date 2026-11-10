import { afterEach, describe, expect, it } from "vitest";
import { openPglite, type Db } from "@/server/db/client";
import { databaseFingerprint, parseMigrateArgs, runMigrateCommand, UsageError } from "../../scripts/migrateCli";

const URL_A = "postgres://gwuser:s3cret-pass@ep-test-alpha.example.neon.tech/gridwindow?sslmode=require";
const URL_B = "postgres://gwuser:s3cret-pass@ep-test-beta.example.neon.tech/gridwindow";

/** One shared local database behind the command's connect hook; close() is a no-op so the test can inspect it afterwards. */
const opened: Db[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close()));
});

async function harness() {
  const db = await openPglite(undefined, { autoMigrate: false });
  opened.push(db);
  const lines: string[] = [];
  const connects: string[] = [];
  const shared: Db = { ...db, close: async () => undefined };
  const io = { connect: async (url: string) => (connects.push(url), shared), log: (line: string) => lines.push(line) };
  return { db, lines, connects, io, output: () => lines.join("\n") };
}

describe("parseMigrateArgs", () => {
  it.each([
    [["--status"], { mode: "status", confirm: undefined }],
    [["--plan"], { mode: "plan", confirm: undefined }],
    [["--apply", "--confirm-database", "abc123"], { mode: "apply", confirm: "abc123" }],
    [["--apply", "--confirm-database=abc123"], { mode: "apply", confirm: "abc123" }],
  ])("accepts %j", (argv, expected) => {
    expect(parseMigrateArgs(argv)).toEqual(expected);
  });

  it.each([
    [[]],
    [["--status", "--plan"]],
    [["--bogus"]],
    [["--apply", "--confirm-database"]],
    [["--status", "--confirm-database", "abc"]],
    [["--apply", "--confirm-database", "a", "--confirm-database", "b"]],
  ])("rejects %j with a usage error", (argv) => {
    expect(() => parseMigrateArgs(argv)).toThrow(UsageError);
  });
});

const it60 = (name: string, fn: () => Promise<void> | void) => it(name, fn, 60_000);

describe("databaseFingerprint", () => {
  it60("is twelve hex characters and depends only on the host name", () => {
    expect(databaseFingerprint(URL_A)).toMatch(/^[0-9a-f]{12}$/);
    expect(databaseFingerprint(URL_A)).toBe(databaseFingerprint("postgres://other:pw@ep-test-alpha.example.neon.tech/x"));
    expect(databaseFingerprint(URL_A)).not.toBe(databaseFingerprint(URL_B));
  });

  it60("does not contain the host name, user or password", () => {
    const fp = databaseFingerprint(URL_A);
    expect(fp).not.toMatch(/alpha|neon|s3cret|gwuser/);
  });
});

describe("runMigrateCommand", () => {
  it60("refuses apply without the matching fingerprint, before connecting, and changes nothing", async () => {
    const h = await harness();
    const code = await runMigrateCommand({ mode: "apply", confirm: "000000000000" }, URL_A, h.io);
    expect(code).toBe(2);
    expect(h.connects).toEqual([]);
    expect((await h.db.query("select 1 from information_schema.tables where table_name = 'schema_migrations'")).length).toBe(0);
    expect(h.output()).toContain("does not match the target");
    expect(h.output()).not.toMatch(/s3cret|gwuser|neon\.tech/);
  });

  it60("refuses apply with no confirmation at all", async () => {
    const h = await harness();
    expect(await runMigrateCommand({ mode: "apply" }, URL_A, h.io)).toBe(2);
    expect(h.connects).toEqual([]);
  });

  it60("apply with the matching fingerprint migrates, and a second apply reports nothing pending", async () => {
    const h = await harness();
    const fp = databaseFingerprint(URL_A);
    expect(await runMigrateCommand({ mode: "apply", confirm: fp }, URL_A, h.io)).toBe(0);
    expect(h.output()).toContain("Applied (5): 001_core, 002_operation_recovery, 003_recovery_engine, 004_recovery_orchestrator, 005_sweep_checked_at");
    h.lines.length = 0;
    expect(await runMigrateCommand({ mode: "apply", confirm: fp }, URL_A, h.io)).toBe(0);
    expect(h.output()).toContain("No pending migrations");
  });

  it60("status is read-only: it reports pending versions, exits 1 when not ready, and never prints the URL", async () => {
    const h = await harness();
    expect(await runMigrateCommand({ mode: "status" }, URL_A, h.io)).toBe(1);
    expect(h.output()).toContain("pending (5): 001_core, 002_operation_recovery, 003_recovery_engine, 004_recovery_orchestrator, 005_sweep_checked_at");
    expect(h.output()).toContain("schema ready for this build: no");
    expect(h.output()).toContain(`target fingerprint: ${databaseFingerprint(URL_A)}`);
    expect(h.output()).not.toMatch(/s3cret|gwuser|neon\.tech|postgres:\/\//);
    expect((await h.db.query("select 1 from information_schema.tables where table_name = 'schema_migrations'")).length).toBe(0);
  });

  it60("status exits 0 once the database matches this build", async () => {
    const h = await harness();
    await runMigrateCommand({ mode: "apply", confirm: databaseFingerprint(URL_A) }, URL_A, h.io);
    h.lines.length = 0;
    expect(await runMigrateCommand({ mode: "status" }, URL_A, h.io)).toBe(0);
    expect(h.output()).toContain("schema ready for this build: yes");
  });

  it60("plan prints the objects of each pending migration and writes nothing", async () => {
    const h = await harness();
    expect(await runMigrateCommand({ mode: "plan" }, URL_A, h.io)).toBe(0);
    expect(h.output()).toContain("003_recovery_engine");
    expect(h.output()).toContain("CREATE TABLE disruption_events");
    expect(h.output()).toContain("ALTER TABLE reservations ADD COLUMN sweep_checked_at");
    expect(h.output()).toContain("Plan only: nothing was changed.");
    expect((await h.db.query("select 1 from information_schema.tables where table_name = 'schema_migrations'")).length).toBe(0);
  });

  it60("plan on a migrated database reports nothing pending", async () => {
    const h = await harness();
    await runMigrateCommand({ mode: "apply", confirm: databaseFingerprint(URL_A) }, URL_A, h.io);
    h.lines.length = 0;
    expect(await runMigrateCommand({ mode: "plan" }, URL_A, h.io)).toBe(0);
    expect(h.output()).toContain("No pending migrations.");
  });
});
