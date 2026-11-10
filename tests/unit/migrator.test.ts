import { afterEach, describe, expect, it } from "vitest";
import { openPglite, type Db } from "@/server/db/client";
import { MIGRATIONS, type Migration } from "@/server/db/migrations";
import { applyPending, assertSchemaReady, describeMigration, inspectSchema, isSchemaReady, migrationChecksum, migrationListProblems, SchemaNotReadyError, splitStatements } from "@/server/db/migrator";

const IDS = ["001_core", "002_operation_recovery", "003_recovery_engine", "004_recovery_orchestrator", "005_sweep_checked_at"];
const FIRST_TWO = MIGRATIONS.slice(0, 2);

/** Empty database: openPglite migrates on open by default, so tests that need a bare schema opt out. Each PGlite start takes seconds under load, hence the longer timeout. */
const opened: Db[] = [];
const bare = async () => {
  const db = await openPglite(undefined, { autoMigrate: false });
  opened.push(db);
  return db;
};
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close()));
});
const it60 = (name: string, fn: () => Promise<void> | void) => it(name, fn, 60_000);

/** A database holding only 001 and 002, with one row in each table an operator would expect to survive. */
async function seededAtFirstTwo(): Promise<Db> {
  const db = await bare();
  await applyPending(db, FIRST_TWO);
  await db.query(`
    insert into quote_sets (id, driver_session, station_id, night_of, created_at, expires_at, payload)
      values ('qs_1', 'drv_1', 'station_1', '2026-11-05', '2026-11-05T20:00:00Z', '2026-11-05T20:10:00Z', '{"offers":2}');
    insert into reservations (id, quote_set_id, offer_id, driver_session, station_id, night_of, port_id, plug_in_at, depart_at, amount_cents, currency,
      terms_hash, terms, payment_state, service_state, slots_committed, provider_mode, approve_url, checkout_state_hash, paypal_order_id,
      paypal_authorization_id, paypal_capture_id, authorization_expires_at, authorized_at, created_at, updated_at)
    values
      ('res_1', 'qs_1', 'offer_1', 'drv_1', 'station_1', '2026-11-05', 'port_a', '2026-11-05T20:00:00Z', '2026-11-06T07:00:00Z', 480, 'USD',
       'th_1', '{"powerW":[1000,1000]}', 'AUTHORIZED', 'SCHEDULED', true, 'MOCK', null, 'cs_1', 'ORDER_1', 'AUTH_1', null,
       '2026-12-05T00:00:00Z', '2026-11-05T20:02:00Z', '2026-11-05T20:02:00Z', '2026-11-05T20:02:00Z'),
      ('res_2', 'qs_1', 'offer_2', 'drv_2', 'station_1', '2026-11-05', 'port_b', '2026-11-05T20:00:00Z', '2026-11-06T07:00:00Z', 350, 'USD',
       'th_2', '{"powerW":[800,800]}', 'CAPTURED', 'DELIVERED', true, 'MOCK', null, 'cs_2', 'ORDER_2', 'AUTH_2', 'CAP_2',
       '2026-12-05T00:00:00Z', '2026-11-05T20:05:00Z', '2026-11-05T20:05:00Z', '2026-11-06T07:01:00Z');
    insert into payment_operations (reservation_id, kind, idempotency_key, status, provider_ref, started_at, completed_at)
      values ('res_1', 'CREATE_ORDER', 'k_order_1', 'SUCCEEDED', 'ORDER_1', '2026-11-05T20:00:01Z', '2026-11-05T20:00:02Z'),
             ('res_2', 'CAPTURE', 'k_cap_2', 'SUCCEEDED', 'CAP_2', '2026-11-06T07:00:00Z', '2026-11-06T07:00:01Z');
    insert into provider_proofs (reservation_id, proof_type, provider_mode, provider_ref, provider_status, amount_cents, evidence_source, observed_at)
      values ('res_1', 'AUTHORIZED', 'MOCK', 'AUTH_1', 'CREATED', 480, 'MOCK_PROVIDER', '2026-11-05T20:02:00Z');
    insert into webhook_inbox (event_id, event_type, resource_id, reservation_id, raw_sha256, received_at, processed_at)
      values ('evt_1', 'PAYMENT.AUTHORIZATION.CREATED', 'AUTH_1', 'res_1', 'abc123', '2026-11-05T20:02:00Z', '2026-11-05T20:02:01Z');
    insert into simulation_runs (id, reservation_id, outcome, delivered_battery_mwh, target_battery_mwh, faults, triggered_by, created_at)
      values ('run_1', 'res_2', 'DELIVERED', 30000, 30000, '[]', 'OPERATOR', '2026-11-06T07:00:00Z');
    insert into energy_records (run_id, reservation_id, slot_index, slot_start, commanded_w, delivered_w, grid_wh, battery_mwh, limited_by, source)
      values ('run_1', 'res_2', 0, '2026-11-05T20:00:00Z', 7000, 7000, 1900, 1700, 'NONE', 'SYNTHETIC');
    insert into events (reservation_id, type, source, payload, occurred_at)
      values ('res_1', 'RESERVATION_CREATED', 'APP', '{"a":1}', '2026-11-05T20:00:00Z');
    insert into mock_provider_objects (id, kind, data) values ('ORDER_1', 'order', '{"status":"APPROVED"}');
  `);
  return db;
}

/** Row-level JSON of every seeded table; the one column added later (reservations.sweep_checked_at) is removed so older rows compare byte-for-byte. */
const SEEDED_TABLES: Record<string, string> = {
  quote_sets: "id",
  reservations: "id",
  payment_operations: "id",
  provider_proofs: "reservation_id, proof_type",
  webhook_inbox: "event_id",
  simulation_runs: "id",
  energy_records: "run_id, slot_index",
  events: "id",
  mock_provider_objects: "id",
};

async function snapshot(db: Db): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const [table, order] of Object.entries(SEEDED_TABLES)) {
    const rows = await db.query<{ row: string }>(`select (to_jsonb(t) - 'sweep_checked_at')::text as row from ${table} t order by ${order}`);
    out[table] = rows.map((r) => r.row);
  }
  return out;
}

async function columnsOf(db: Db, table: string): Promise<string[]> {
  const rows = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = current_schema() and table_name = '${table}' order by ordinal_position`);
  return rows.map((r) => r.column_name);
}

describe("migration list", () => {
  it60("is well formed: unique, numbered, ascending", () => {
    expect(migrationListProblems(MIGRATIONS)).toEqual([]);
    expect(MIGRATIONS.map((m) => m.id)).toEqual(IDS);
  });

  it60("reports duplicate and out-of-order ids", () => {
    const bad: Migration[] = [
      { id: "002_b", sql: "" },
      { id: "001_a", sql: "" },
      { id: "001_a", sql: "" },
    ];
    expect(migrationListProblems(bad)).toEqual(expect.arrayContaining(["duplicate migration id", "ids are not in ascending order"]));
  });

  it60("holds only additive statements after the first migration: no drop, rename, type change, data rewrite or deletion", () => {
    for (const m of MIGRATIONS) {
      for (const statement of splitStatements(m.sql)) {
        const createsObject = /^create (unique )?(table|index|function|trigger) /i.test(statement);
        const addsColumns = /^alter table \w+ /i.test(statement) && statement.replace(/^alter table \w+ /i, "").split(/,\s*(?=add column)/i).every((c) => /^add column (if not exists )?\w+ /i.test(c));
        expect({ id: m.id, statement: statement.slice(0, 60), additive: createsObject || addsColumns }).toMatchObject({ additive: true });
      }
    }
  });

  it60("does not touch existing rows in any migration after 001 (no top-level update, delete, insert or truncate)", () => {
    for (const m of MIGRATIONS.slice(1)) {
      for (const statement of splitStatements(m.sql)) expect(statement).not.toMatch(/^(update|delete|insert|truncate)\b/i);
    }
  });
});

describe("applying migrations", () => {
  it60("applies every migration once in order and records a checksum for each", async () => {
    const db = await bare();
    expect(await applyPending(db)).toEqual(IDS);
    const rows = await db.query<{ id: string; checksum: string }>("select id, checksum from schema_migrations order by id");
    expect(rows).toEqual(MIGRATIONS.map((m) => ({ id: m.id, checksum: migrationChecksum(m.sql) })));
  });

  it60("is idempotent: a second apply is a no-op", async () => {
    const db = await bare();
    await applyPending(db);
    expect(await applyPending(db)).toEqual([]);
    expect(await inspectSchema(db)).toMatchObject({ pending: [], unknown: [], drift: [], unverified: [] });
  });

  it60("keeps every append-only and immutability trigger after migrating", async () => {
    const db = await seededAtFirstTwo();
    await applyPending(db);
    const triggers = (await db.query<{ tgname: string }>("select tgname from pg_trigger where not tgisinternal order by tgname")).map((r) => r.tgname);
    expect(triggers).toEqual(expect.arrayContaining(["events_append_only", "energy_records_append_only", "disruption_events_append_only", "schedule_versions_append_only", "reservations_terms_immutable"]));
    await expect(db.query("update events set type = 'X' where id = 1")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from energy_records")).rejects.toThrow(/append-only/);
    await expect(db.query("update reservations set amount_cents = 1 where id = 'res_1'")).rejects.toThrow(/immutable/);
  });
});

describe("pending detection and the fail-safe check", () => {
  it60("lists exactly the migrations after the ones recorded", async () => {
    const db = await seededAtFirstTwo();
    const report = await inspectSchema(db);
    expect(report).toMatchObject({ ledgerPresent: true, applied: FIRST_TWO.map((m) => m.id), pending: IDS.slice(2), unknown: [], drift: [] });
    expect(isSchemaReady(report)).toBe(false);
  });

  it60("treats a missing ledger as everything pending and does not create the ledger while inspecting", async () => {
    const db = await bare();
    const report = await inspectSchema(db);
    expect(report).toMatchObject({ ledgerPresent: false, pending: IDS });
    expect((await db.query("select 1 from information_schema.tables where table_name = 'schema_migrations'")).length).toBe(0);
  });

  it60("assertSchemaReady refuses a stale schema with a message that names the versions and no connection details", async () => {
    const db = await seededAtFirstTwo();
    const error = await assertSchemaReady(db).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SchemaNotReadyError);
    expect((error as Error).message).toContain("003_recovery_engine, 004_recovery_orchestrator, 005_sweep_checked_at");
    expect((error as Error).message).toContain("db:migrate -- --status");
    expect((error as Error).message).not.toMatch(/postgres:\/\/|password/i);
  });

  it60("assertSchemaReady accepts a schema that matches this build", async () => {
    const db = await bare();
    await applyPending(db);
    await expect(assertSchemaReady(db)).resolves.toBeUndefined();
  });

  it60("detects checksum drift when an applied migration's SQL has changed in this build", async () => {
    const db = await bare();
    await applyPending(db);
    const edited = MIGRATIONS.map((m) => (m.id === "002_operation_recovery" ? { ...m, sql: `${m.sql}\n-- edited` } : m));
    expect((await inspectSchema(db, edited)).drift).toEqual(["002_operation_recovery"]);
    await expect(applyPending(db, edited)).rejects.toBeInstanceOf(SchemaNotReadyError);
    await expect(assertSchemaReady(db, edited)).rejects.toThrow(/checksum changed since applied: 002_operation_recovery/);
  });

  it60("detects a ledger row this build does not know (database ahead of the code) and refuses to apply", async () => {
    const db = await bare();
    await applyPending(db);
    await db.query("insert into schema_migrations (id, checksum) values ('009_future', 'x')");
    expect((await inspectSchema(db)).unknown).toEqual(["009_future"]);
    await expect(applyPending(db)).rejects.toThrow(/009_future/);
    await expect(assertSchemaReady(db)).rejects.toThrow(/unknown to this build/);
  });

  it60("accepts ledgers from before checksums existed, records their checksums on apply, and reports them as unverified", async () => {
    const db = await bare();
    await db.query("create table schema_migrations (id text primary key, applied_at timestamptz not null default now())");
    for (const m of FIRST_TWO) {
      await db.query(m.sql);
      await db.query("insert into schema_migrations (id) values ($1)", [m.id]);
    }
    expect(await inspectSchema(db, FIRST_TWO)).toMatchObject({ unverified: FIRST_TWO.map((m) => m.id), pending: [] });
    expect(isSchemaReady(await inspectSchema(db, FIRST_TWO))).toBe(true);
    expect(await applyPending(db)).toEqual(IDS.slice(2));
    const rows = await db.query<{ id: string; checksum: string }>("select id, checksum from schema_migrations where id in ('001_core', '002_operation_recovery') order by id");
    expect(rows).toEqual(FIRST_TWO.map((m) => ({ id: m.id, checksum: migrationChecksum(m.sql) })));
  });
});

describe("existing rows across 003-005", () => {
  it60("keeps seeded reservations, operations, proofs, events and energy records byte-for-byte, and adds only new objects", async () => {
    const db = await seededAtFirstTwo();
    const before = await snapshot(db);
    const reservationColumns = await columnsOf(db, "reservations");
    const paymentOperationColumns = await columnsOf(db, "payment_operations");

    expect(await applyPending(db)).toEqual(IDS.slice(2));

    expect(await snapshot(db)).toEqual(before);
    expect(before.reservations).toHaveLength(2);
    expect(before.events).toHaveLength(1);
    expect(before.energy_records).toHaveLength(1);
    expect(await columnsOf(db, "reservations")).toEqual([...reservationColumns, "sweep_checked_at"]);
    expect(await columnsOf(db, "payment_operations")).toEqual(paymentOperationColumns);
    expect((await db.query("select count(*)::int as n from reservations where sweep_checked_at is not null"))[0]).toEqual({ n: 0 });
    expect((await db.query("select count(*)::int as n from recovery_runs"))[0]).toEqual({ n: 0 });
  });
});

describe("migration plan description", () => {
  it60("lists the objects migration 003 creates, in order", () => {
    const objects = describeMigration(MIGRATIONS[2]!);
    expect(objects.slice(0, 3)).toEqual(["CREATE TABLE disruption_events", "CREATE INDEX disruption_events_reservation", "CREATE TRIGGER disruption_events_append_only"]);
    expect(objects).toEqual(expect.arrayContaining(["CREATE TABLE recovery_runs", "CREATE TABLE schedule_versions", "CREATE TRIGGER schedule_versions_append_only"]));
  });

  it60("lists the columns migrations 004 and 005 add", () => {
    expect(describeMigration(MIGRATIONS[3]!)).toEqual(["ALTER TABLE recovery_runs ADD COLUMN attempts", "ALTER TABLE recovery_runs ADD COLUMN ai_used", "ALTER TABLE recovery_runs ADD COLUMN outcome", "ALTER TABLE recovery_runs ADD COLUMN explanation"]);
    expect(describeMigration(MIGRATIONS[4]!)).toEqual(["ALTER TABLE reservations ADD COLUMN sweep_checked_at"]);
  });
});
