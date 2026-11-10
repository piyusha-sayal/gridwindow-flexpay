/**
 * Independent QA security regression tests (synthetic data, MOCK provider, in-memory PGlite only).
 * No network, no real money, no PayPal, no Gemini. Adds negative coverage that does not duplicate routes.test.ts.
 */
import { createHmac } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "@/server/db/migrations";
import { openPglite } from "@/server/db/client";
import { getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { captureAuthorization, runSimulation, voidAuthorization } from "@/server/services/settlementService";
import { makeApp, request, resetApp, type TestApp } from "./helpers";

const fake = vi.hoisted(() => ({ cookies: new Map<string, string>(), runtime: null as unknown }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (fake.cookies.has(name) ? { name, value: fake.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void fake.cookies.set(name, value),
    delete: (name: string) => void fake.cookies.delete(name),
  }),
}));
vi.mock("@/server/runtime", () => ({ getRuntime: async () => fake.runtime }));

const { POST: webhook } = await import("@/app/api/webhooks/paypal/route");
const { POST: opSimulate } = await import("@/app/api/operator/reservations/[id]/simulate/route");
const { POST: opMockCapture } = await import("@/app/api/operator/reservations/[id]/mock-capture/route");
const { POST: opReconcile } = await import("@/app/api/operator/reservations/[id]/reconcile/route");
const { POST: opDemo } = await import("@/app/api/operator/demo/route");
const { GET: opDashboard } = await import("@/app/api/operator/dashboard/route");
const { POST: driverSimulate } = await import("@/app/api/reservations/[id]/simulate/route");
const { GET: getReservationRoute } = await import("@/app/api/reservations/[id]/route");

const ORIGIN = "http://test.local";
const KEY = Buffer.alloc(32, 9);
const signed = (v: string) => `${v}.${createHmac("sha256", KEY).update(v).digest("base64url")}`;
const asDriver = (id: string) => fake.cookies.set("gw_drv", signed(id));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (p: string, body: unknown = {}, headers: Record<string, string> = { origin: ORIGIN }) =>
  new Request(`${ORIGIN}${p}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

let app: TestApp;
beforeAll(async () => {
  app = await makeApp();
  fake.runtime = { env: { APP_BASE_URL: ORIGIN, DEMO_TOOLS: "true" }, deps: app.deps, sessionKey: KEY, operatorPassHash: null, llm: null };
});
beforeEach(async () => {
  await resetApp(app);
  fake.cookies.clear();
});
afterAll(async () => {
  await app.db.close();
});

async function authorized(session: string): Promise<string> {
  const quote = await createQuote(app.deps, session, request({ portId: "port_c" }));
  const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost") ?? quote.offers[0]!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  await handleCheckoutReturn(app.deps, session, accepted.reservationId, new URL(order.returnUrl).searchParams.get("state")!, r.paypal_order_id!);
  return accepted.reservationId;
}
const providerCalls = (name: string) => app.gateway.calls.filter((c) => c === name).length;

describe("static route guard sweep", () => {
  const root = path.resolve(__dirname, "../../src/app/api");
  const routes: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n === "route.ts") routes.push(p);
    }
  };
  walk(root);
  const rel = (p: string) => path.relative(root, p).replace(/\\/g, "/");

  it("finds the expected API surface (guards against silently unscanned routes)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(24);
  });

  it("every state-changing handler (POST/PUT/PATCH/DELETE) checks same-origin, except the signature-verified PayPal webhook", () => {
    for (const p of routes) {
      const src = readFileSync(p, "utf8");
      if (!/export (const|async function) (POST|PUT|PATCH|DELETE)\b/.test(src)) continue;
      if (rel(p) === "webhooks/paypal/route.ts") continue;
      expect(src, `${rel(p)} must call assertSameOrigin`).toContain("assertSameOrigin");
    }
  });

  it("every /operator/* route except the login route requires the operator", () => {
    for (const p of routes.filter((r) => rel(r).startsWith("operator/") && rel(r) !== "operator/session/route.ts")) {
      expect(readFileSync(p, "utf8"), `${rel(p)} must call requireOperator`).toContain("requireOperator");
    }
  });

  it("no route reads a payment amount, price or provider id from the request body of a recovery or settlement call", () => {
    for (const p of routes.filter((r) => /recovery|simulate|reconcile|mock-capture/.test(rel(r)))) {
      expect(readFileSync(p, "utf8"), rel(p)).not.toMatch(/amountCents|amount_cents|priceCents|captureId|authorizationId/);
    }
  });
});

describe("operator-only routes refuse anonymous and driver callers", () => {
  it("returns 401 and moves no money", async () => {
    const rid = await authorized("drv_sec_a");
    const attempts = async () => [
      await opSimulate(post(`/api/operator/reservations/${rid}/simulate`, { outage: { fromSlot: 0, toSlot: 99 } }), ctx(rid)),
      await opMockCapture(post(`/api/operator/reservations/${rid}/mock-capture`, { outcome: "PENDING" }), ctx(rid)),
      await opReconcile(post(`/api/operator/reservations/${rid}/reconcile`), ctx(rid)),
      await opDashboard(new Request(`${ORIGIN}/api/operator/dashboard?night=2026-11-05`)),
    ];
    for (const res of await attempts()) expect(res.status).toBe(401);
    asDriver("drv_sec_a");
    for (const res of await attempts()) expect(res.status).toBe(401);
    expect((await getReservation(app.db, rid))!.payment_state).toBe("AUTHORIZED");
    expect(providerCalls("captureAuthorization") + providerCalls("voidAuthorization")).toBe(0);
  });

  it("demo reset is refused to drivers and anonymous callers even with the confirmation word", async () => {
    await authorized("drv_sec_b");
    // 404 (tool hidden) or 401 (operator required) are both refusals; 200 would be a defect.
    expect([401, 404]).toContain((await opDemo(post("/api/operator/demo", { action: "reset", confirm: "RESET" }))).status);
    asDriver("drv_sec_b");
    expect([401, 404]).toContain((await opDemo(post("/api/operator/demo", { action: "reset", confirm: "RESET" }))).status);
    expect((await app.db.query("select id from reservations")).length).toBe(1);
  });
});

describe("driver ownership and fault-injection boundary", () => {
  it("a driver cannot simulate or read another driver's reservation (404, nothing changes)", async () => {
    const rid = await authorized("drv_owner");
    asDriver("drv_intruder");
    expect((await driverSimulate(post(`/api/reservations/${rid}/simulate`), ctx(rid))).status).toBe(404);
    expect((await getReservationRoute(new Request(`${ORIGIN}/api/reservations/${rid}`), ctx(rid))).status).toBe(404);
    expect((await app.db.query("select id from simulation_runs")).length).toBe(0);
  });

  it("a driver cannot inject a charger outage through the service layer", async () => {
    const rid = await authorized("drv_owner2");
    await expect(runSimulation(app.deps, rid, { kind: "DRIVER", session: "drv_owner2" }, { outage: { fromSlot: 0, toSlot: 96 } })).rejects.toMatchObject({ httpStatus: 403 });
    expect((await app.db.query("select id from simulation_runs")).length).toBe(0);
  });

  it("a driver request body cannot smuggle a fault into the driver simulate route", async () => {
    const rid = await authorized("drv_owner3");
    asDriver("drv_owner3");
    const res = await driverSimulate(post(`/api/reservations/${rid}/simulate`, { outage: { fromSlot: 0, toSlot: 96 } }), ctx(rid));
    expect(res.status).toBe(200);
    const runs = await app.db.query<{ faults: unknown }>("select faults from simulation_runs");
    expect(JSON.stringify(runs[0]!.faults)).not.toContain("outage");
  });
});

describe("settlement: no duplicate money movement, no capture after void", () => {
  it("repeated and concurrent settle requests produce exactly one provider capture", async () => {
    const rid = await authorized("drv_pay1");
    await Promise.all([runSimulation(app.deps, rid, { kind: "OPERATOR" }), runSimulation(app.deps, rid, { kind: "OPERATOR" }), captureAuthorization(app.deps, rid)]);
    await runSimulation(app.deps, rid, { kind: "OPERATOR" });
    await captureAuthorization(app.deps, rid);
    expect((await getReservation(app.db, rid))!.payment_state).toBe("CAPTURED");
    expect(providerCalls("captureAuthorization")).toBe(1);
    const ops = await app.db.query<{ kind: string }>("select kind from payment_operations where reservation_id = $1", [rid]);
    expect(ops.filter((o) => o.kind === "CAPTURE")).toHaveLength(1);
    expect(ops.filter((o) => o.kind === "VOID")).toHaveLength(0);
  });

  it("an operator-injected outage voids once, and a later capture attempt never reaches the provider", async () => {
    const rid = await authorized("drv_pay2");
    await runSimulation(app.deps, rid, { kind: "OPERATOR" }, { outage: { fromSlot: 0, toSlot: 96 } });
    expect((await getReservation(app.db, rid))!.payment_state).toBe("VOIDED");
    await captureAuthorization(app.deps, rid);
    await voidAuthorization(app.deps, rid, "AGAIN");
    expect(providerCalls("captureAuthorization")).toBe(0);
    expect(providerCalls("voidAuthorization")).toBe(1);
    expect((await getReservation(app.db, rid))!.payment_state).toBe("VOIDED");
  });

  it("capture is refused before delivery: no provider capture on an undelivered authorization", async () => {
    const rid = await authorized("drv_pay3");
    await captureAuthorization(app.deps, rid);
    expect(providerCalls("captureAuthorization")).toBe(0);
    expect((await getReservation(app.db, rid))!.payment_state).toBe("AUTHORIZED");
  });
});

describe("PayPal webhook intake", () => {
  const hdr = { "content-type": "application/json", "paypal-transmission-id": "tx-1", "paypal-transmission-sig": "bad", "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/c", "paypal-transmission-time": "2026-11-05T20:00:00Z" };
  const hook = (body: string, headers: Record<string, string> = hdr) => webhook(new Request(`${ORIGIN}/api/webhooks/paypal`, { method: "POST", headers, body }));

  it("an unverified webhook is rejected with 401 and writes nothing", async () => {
    const rid = await authorized("drv_hook1");
    const before = (await app.db.query("select 1 from events")).length;
    const res = await hook(JSON.stringify({ id: "WH-FORGED", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: (await getReservation(app.db, rid))!.paypal_order_id } }));
    expect(res.status).toBe(401);
    expect((await app.db.query("select 1 from webhook_inbox")).length).toBe(0);
    expect((await app.db.query("select 1 from events")).length).toBe(before);
    expect((await getReservation(app.db, rid))!.payment_state).toBe("AUTHORIZED");
  });

  it("an oversized body is refused before verification", async () => {
    const res = await hook(JSON.stringify({ id: "WH-BIG", event_type: "X", pad: "a".repeat(70_000) }));
    expect(res.status).toBe(413);
    expect(app.gateway.calls).not.toContain("verifyWebhook");
  });

  it("a verified but malformed body is a 400 with no inbox row", async () => {
    app.gateway.webhookValid = true;
    expect((await hook("{not json")).status).toBe(400);
    expect((await hook(JSON.stringify({ event_type: "X" }))).status).toBe(400);
    expect((await app.db.query("select 1 from webhook_inbox")).length).toBe(0);
  });

  it("a verified duplicate is processed once; an uncorrelated event never touches a reservation", async () => {
    const rid = await authorized("drv_hook2");
    app.gateway.webhookValid = true;
    const r = (await getReservation(app.db, rid))!;
    const body = JSON.stringify({ id: "WH-OK-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: r.paypal_order_id } });
    expect(await (await hook(body)).json()).toEqual({ result: "PROCESSED" });
    expect(await (await hook(body)).json()).toEqual({ result: "DUPLICATE" });
    expect((await app.db.query("select 1 from webhook_inbox where event_id = 'WH-OK-1'")).length).toBe(1);
    const stranger = JSON.stringify({ id: "WH-OK-2", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "NOT-OURS" } });
    expect(await (await hook(stranger)).json()).toEqual({ result: "UNCORRELATED" });
    expect(providerCalls("captureAuthorization")).toBe(0);
    expect((await getReservation(app.db, rid))!.payment_state).toBe("AUTHORIZED");
  });

  it("a webhook claiming capture cannot create a CAPTURED state the provider does not confirm (reordered/hostile event)", async () => {
    const rid = await authorized("drv_hook3");
    app.gateway.webhookValid = true;
    const r = (await getReservation(app.db, rid))!;
    await hook(JSON.stringify({ id: "WH-LIE", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: r.paypal_authorization_id, status: "COMPLETED" } }));
    expect((await getReservation(app.db, rid))!.payment_state).not.toBe("CAPTURED");
    expect((await getReservation(app.db, rid))!.paypal_capture_id).toBeNull();
  });
});

describe("migrations 003-005 on a database that already holds 001-002 data", () => {
  it("preserve existing rows, are idempotent on reopen, and keep the terms-immutability trigger", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = mkdtempSync(path.join(tmpdir(), "gw-qa-mig-"));
    const pg = await PGlite.create(dir);
    await pg.exec("create table schema_migrations (id text primary key, applied_at timestamptz not null default now())");
    for (const m of MIGRATIONS.slice(0, 2)) {
      await pg.exec(m.sql);
      await pg.query("insert into schema_migrations (id) values ($1)", [m.id]);
    }
    await pg.query("insert into quote_sets (id, driver_session, station_id, night_of, created_at, expires_at, payload) values ('q1','d','s','2026-11-05',now(),now(),'{}')");
    await pg.query(
      `insert into reservations (id, quote_set_id, offer_id, driver_session, station_id, night_of, port_id, plug_in_at, depart_at, amount_cents, currency, terms_hash, terms, payment_state, service_state, provider_mode, checkout_state_hash)
       values ('legacy1','q1','o1','d','s','2026-11-05','port_c',now(),now(),1234,'USD','h','{"legacy":true}','AUTHORIZED','SCHEDULED','MOCK','c')`,
    );
    await pg.close();

    // Fresh full migration path as the app runs it, then a second open of the same schema state.
    const db = await openPglite(dir);
    const legacy = await db.query<{ amount_cents: number; terms: { legacy?: boolean } }>("select amount_cents, terms from reservations where id = 'legacy1'");
    expect(legacy).toHaveLength(1);
    expect(legacy[0]!.amount_cents).toBe(1234);
    expect(legacy[0]!.terms.legacy).toBe(true);
    await db.close();
    const db2 = await openPglite(dir);
    const applied = await db2.query<{ id: string }>("select id from schema_migrations order by id");
    expect(applied.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
    await db2.close();
    rmSync(dir, { recursive: true, force: true });
    expect(MIGRATIONS.map((m) => m.id)).toEqual(["001_core", "002_operation_recovery", "003_recovery_engine", "004_recovery_orchestrator", "005_sweep_checked_at"]);
  });

  it("003-005 only add objects: no drop, truncate, delete or destructive rewrite of earlier data", () => {
    for (const m of MIGRATIONS.slice(2)) {
      expect(m.sql, m.id).not.toMatch(/\bdrop\s+(table|column|schema)\b|\btruncate\b|\bdelete\s+from\b/i);
    }
  });

  it("the accepted-terms immutability trigger still blocks a price change after all migrations", async () => {
    const rid = await authorized("drv_mig");
    await expect(app.db.query("update reservations set amount_cents = amount_cents + 100 where id = $1", [rid])).rejects.toThrow(/immutable/);
  });
});
