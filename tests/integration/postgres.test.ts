/**
 * Real-PostgreSQL certification. Runs only with TEST_DATABASE_URL pointing at an isolated throwaway
 * server (never a shared one). Exercises what PGlite cannot: concurrent connections, real row/advisory
 * locking across sessions, killed backends and (optionally) a server restart via TEST_PG_RESTART_CMD.
 * The restart drops every connection on that server, so set TEST_PG_RESTART_CMD only when running
 * this file alone; parallel test files sharing the server would see their connections killed.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { validatePlans } from "@/domain/validator";
import { connectPostgres, openPostgres } from "@/server/db/client";
import { applyPending, SchemaNotReadyError } from "@/server/db/migrator";
import { MIGRATIONS } from "@/server/db/migrations";
import { committedPlans, getReservation, leaseOperation, claimOperation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote, scenarioFor } from "@/server/services/quoteService";
import { recoverPendingReservations } from "@/server/services/recoveryService";
import { runSimulation } from "@/server/services/settlementService";
import { assertDisposableTestUrl } from "./dbGuard";
import { makeApp, NIGHT, request, resetApp, type TestApp } from "./helpers";

const PG_URL = process.env.TEST_DATABASE_URL;
if (PG_URL) assertDisposableTestUrl(PG_URL);

async function freshSchemaUrl(): Promise<string> {
  const { Client } = await import("pg");
  const schema = `m_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new Client({ connectionString: PG_URL });
  await admin.connect();
  await admin.query(`create schema ${schema}`);
  await admin.end();
  return `${PG_URL}${PG_URL!.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
}

describe.skipIf(!PG_URL)("real PostgreSQL", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await makeApp();
    expect(app.db.kind).toBe("postgres");
  });
  afterAll(async () => app.db.close());
  beforeEach(async () => resetApp(app));

  async function authorized(driver: string, overrides: Parameters<typeof request>[0] = {}) {
    const quote = await createQuote(app.deps, driver, request(overrides));
    const offer = quote.offers[0]!;
    const accepted = await acceptOffer(app.deps, driver, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
    const r = (await getReservation(app.db, accepted.reservationId))!;
    const order = await app.mock.approve(r.paypal_order_id!);
    return handleCheckoutReturn(app.deps, driver, r.id, new URL(order.returnUrl).searchParams.get("state")!, r.paypal_order_id!);
  }

  it("fresh migration, repeated migration and concurrent migrators leave one consistent schema", async () => {
    const url = await freshSchemaUrl();
    // Several processes starting at once must not race on the same migration.
    const dbs = await Promise.all(Array.from({ length: 4 }, () => openPostgres(url, { autoMigrate: true })));
    const again = await openPostgres(url, { autoMigrate: true });
    const rows = await again.query<{ id: string }>("select id from schema_migrations order by id");
    expect(rows.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
    await Promise.all([...dbs, again].map((d) => d.close()));
  });

  it("a dedicated migration URL applies pending migrations and the runtime pool then finds nothing to do", async () => {
    const url = await freshSchemaUrl();
    const db = await openPostgres(url, { migrationUrl: url, autoMigrate: true });
    const rows = await db.query<{ id: string }>("select id from schema_migrations order by id");
    expect(rows.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
    await db.close();
    const reopened = await openPostgres(url, { migrationUrl: url, autoMigrate: true });
    expect((await reopened.query<{ n: number }>("select count(*)::int as n from schema_migrations"))[0]!.n).toBe(MIGRATIONS.length);
    await reopened.close();
  });

  it("an unmigrated external database is refused on open by default and gets no ledger", async () => {
    const url = await freshSchemaUrl();
    await expect(openPostgres(url)).rejects.toBeInstanceOf(SchemaNotReadyError);
    const { Client } = await import("pg");
    const probe = new Client({ connectionString: url });
    await probe.connect();
    const ledger = await probe.query<{ t: string | null }>("select to_regclass('schema_migrations')::text as t");
    await probe.end();
    expect(ledger.rows[0]!.t).toBeNull();
  });

  it("once the migrator has applied the list, the default open succeeds without auto-migrating", async () => {
    const url = await freshSchemaUrl();
    const migrator = await connectPostgres(url);
    await applyPending(migrator);
    await migrator.close();
    const db = await openPostgres(url);
    expect((await db.query<{ n: number }>("select count(*)::int as n from schema_migrations"))[0]!.n).toBe(MIGRATIONS.length);
    await db.close();
  });

  it("double-click acceptance across connections creates one reservation, one order operation and one provider order", async () => {
    const quote = await createQuote(app.deps, "drv_dbl", request());
    const offer = quote.offers[0]!;
    const input = { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true as const };
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => acceptOffer(app.deps, "drv_dbl", input)));
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect((await app.db.query("select id from reservations")).length).toBe(1);
    expect((await app.db.query("select 1 from payment_operations where kind = 'CREATE_ORDER'")).length).toBe(1);
    expect((await app.db.query("select 1 from mock_provider_objects where kind = 'order'")).length).toBe(1);
  });

  it("simultaneous capacity commitments never overbook a port or the station cap", async () => {
    // Every driver is quoted against an empty station, then all commit concurrently on separate connections.
    const drivers = ["port_a", "port_a", "port_b", "port_b", "port_c", "port_c"].map((portId, i) => ({ driver: `drv_cap_${i}`, portId }));
    const outcomes = await Promise.allSettled(drivers.map((d) => authorized(d.driver, { portId: d.portId, targetBatteryKWh: 45, spendCapCents: 5_000 })));
    expect(outcomes.filter((o) => o.status === "fulfilled").length).toBeGreaterThan(0);
    const committed = await committedPlans(app.db, app.deps.station.id, NIGHT);
    const rows = await app.db.query<{ id: string; terms: { targetBatteryWh: number; efficiencyBp: number } }>("select id, terms from reservations where slots_committed");
    const scenario = scenarioFor(app.deps.station, NIGHT);
    const violations = validatePlans(app.deps.station, scenario.grid, scenario.forecastBaseLoadW, committed, rows.map((r) => ({ sessionId: r.id, targetBatteryWh: r.terms.targetBatteryWh, efficiencyBp: r.terms.efficiencyBp })));
    expect(violations).toEqual([]);
    // Each port holds at most one overlapping vehicle; losers were voided, not left authorized without capacity.
    expect(new Set(committed.map((p) => p.portId)).size).toBe(committed.length);
    const stranded = await app.db.query("select id from reservations where payment_state = 'AUTHORIZED' and not slots_committed");
    expect(stranded).toEqual([]);
  });

  it("parallel settlement workers on separate connections produce exactly one capture", async () => {
    const r = await authorized("drv_par");
    const runs = await Promise.allSettled(Array.from({ length: 8 }, () => runSimulation(app.deps, r.id, { kind: "OPERATOR" })));
    expect(runs.some((x) => x.status === "fulfilled")).toBe(true);
    expect((await app.db.query("select 1 from mock_provider_objects where kind = 'capture'")).length).toBe(1);
    expect((await getReservation(app.db, r.id))!.payment_state).toBe("CAPTURED");
  });

  it("an expired lease from a crashed worker is taken over by exactly one of many workers", async () => {
    const r = await authorized("drv_lease");
    const { op } = await claimOperation(app.db, r.id, "CAPTURE", { termsHash: r.terms_hash, amountCents: r.amount_cents });
    const t0 = Date.now();
    expect(await leaseOperation(app.db, op.idempotency_key, t0)).not.toBeNull(); // crashed holder
    expect(await leaseOperation(app.db, op.idempotency_key, t0 + 1_000)).toBeNull();
    const takeovers = await Promise.all(Array.from({ length: 10 }, () => leaseOperation(app.db, op.idempotency_key, t0 + 61_000)));
    expect(takeovers.filter(Boolean).length).toBe(1);
  });

  it("the app's own transaction connection dropped while idle rejects that transaction without crashing or poisoning the pool", async () => {
    const run = app.db.tx(async (q) => {
      const pid = (await q.query<{ pid: number }>("select pg_backend_pid() as pid"))[0]!.pid;
      await app.db.query("select pg_terminate_backend($1)", [pid]);
      await new Promise((resolve) => setTimeout(resolve, 300)); // the drop arrives while no query is pending
      await q.query("select 1");
    });
    await expect(run).rejects.toThrow();
    for (let i = 0; i < 12; i++) expect(await app.db.query<{ one: number }>("select 1 as one")).toEqual([{ one: 1 }]);
  });

  it("a backend killed mid-transaction leaves no partial writes, and accepted terms stay immutable", async () => {
    const r = await authorized("drv_kill");
    const { Client } = await import("pg");
    const victim = new Client({ connectionString: PG_URL });
    victim.on("error", () => undefined);
    await victim.connect();
    const schema = (await app.db.query<{ s: string }>("select current_schema() as s"))[0]!.s;
    await victim.query(`set search_path to ${schema}`);
    await victim.query("begin");
    await victim.query("update reservations set service_state = 'FAILED' where id = $1", [r.id]);
    const pid = (await victim.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
    await app.db.query("select pg_terminate_backend($1)", [pid]);
    await expect(victim.query("commit")).rejects.toThrow();
    expect((await getReservation(app.db, r.id))!.service_state).toBe("SCHEDULED");
    await expect(app.db.query("update reservations set amount_cents = 1 where id = $1", [r.id])).rejects.toThrow(/immutable/);
    await expect(app.db.query("update reservations set terms = terms || '{\"powerW\":[]}'::jsonb where id = $1", [r.id])).rejects.toThrow(/immutable/);
  });

  it.skipIf(!process.env.TEST_PG_RESTART_CMD)("server restart: the pool reconnects and recovery finishes an interrupted settlement exactly once", async () => {
    const r = await authorized("drv_restart");
    // Crash after the synthetic run committed but before capture: capture never resolves.
    app.gateway.overrides.captureAuthorization = () => new Promise(() => undefined);
    void runSimulation(app.deps, r.id, { kind: "OPERATOR" }).catch(() => undefined);
    await expect.poll(async () => (await app.db.query("select 1 from simulation_runs where reservation_id = $1", [r.id])).length).toBe(1);
    delete app.gateway.overrides.captureAuthorization;
    execSync(process.env.TEST_PG_RESTART_CMD!, { stdio: "ignore" });
    // Stale pooled connections were killed by the restart; the next queries must recover, not crash the process.
    await expect.poll(async () => (await app.db.query("select 1 as ok").catch(() => []))[0], { timeout: 20_000 }).toEqual({ ok: 1 });
    // Lease from the "crashed" worker must expire before another worker may call the provider.
    app.clock.now += 61_000;
    await recoverPendingReservations(app.deps);
    expect((await getReservation(app.db, r.id))!.payment_state).toBe("CAPTURED");
    expect((await app.db.query("select 1 from mock_provider_objects where kind = 'capture'")).length).toBe(1);
  });

  it("financial invariants hold across everything above", async () => {
    // Seed a mixed night (one authorized, one failed + voided) and check global invariants directly in SQL.
    await authorized("drv_inv_a", { portId: "port_a" });
    const b = await authorized("drv_inv_b", { portId: "port_b" });
    await runSimulation(app.deps, b.id, { kind: "OPERATOR" }, { outage: { fromSlot: 0, toSlot: 200 } });
    const bothSettlements = await app.db.query("select reservation_id from payment_operations where kind in ('CAPTURE','VOID') group by reservation_id having count(distinct kind) > 1");
    expect(bothSettlements).toEqual([]);
    const capturedWithoutProof = await app.db.query("select r.id from reservations r where payment_state = 'CAPTURED' and not exists (select 1 from provider_proofs p where p.reservation_id = r.id and p.proof_type = 'CAPTURED')");
    expect(capturedWithoutProof).toEqual([]);
    const capacityOnTerminal = await app.db.query("select id from reservations where slots_committed and payment_state in ('VOIDED','CANCELLED','FAILED','CAPTURE_DECLINED')");
    expect(capacityOnTerminal).toEqual([]);
  });
});
