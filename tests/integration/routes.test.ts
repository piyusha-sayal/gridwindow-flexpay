/**
 * HTTP route handlers called directly with Request objects. Cookies (next/headers) and the runtime are replaced by
 * in-memory fakes; the database, services and signing rules are the real ones.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { recordDisruption, runRecovery } from "@/server/services/scheduleService";
import { SLOT_MS } from "@/domain/units";
import { DEMO_STATION } from "@/domain/station";
import { scenarioFor } from "@/server/services/quoteService";
import { makeApp, NIGHT, request, resetApp, type TestApp } from "./helpers";

const fake = vi.hoisted(() => ({ cookies: new Map<string, string>(), runtime: null as unknown }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (fake.cookies.has(name) ? { name, value: fake.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void fake.cookies.set(name, value),
    delete: (name: string) => void fake.cookies.delete(name),
  }),
}));
vi.mock("@/server/runtime", () => ({ getRuntime: async () => fake.runtime }));

const { POST: postEvent } = await import("@/app/api/recovery/events/route");
const { GET: getRun } = await import("@/app/api/recovery/runs/[id]/route");
const { POST: approveRoute } = await import("@/app/api/recovery/runs/[id]/approve/route");
const { POST: rejectRoute } = await import("@/app/api/recovery/runs/[id]/reject/route");
const { GET: getSchedule } = await import("@/app/api/schedule/route");

const ORIGIN = "http://test.local";
const DRIVER = "drv_routes_1";
const OTHER_DRIVER = "drv_routes_2";
const SESSION_KEY = Buffer.alloc(32, 7);
let app: TestApp;

const signed = (value: string) => `${value}.${createHmac("sha256", SESSION_KEY).update(value).digest("base64url")}`;
const asDriver = (id: string) => fake.cookies.set("gw_drv", signed(id));
const asOperator = () => fake.cookies.set("gw_op", signed(`op:${Date.now() + 3_600_000}`));
const signOut = () => fake.cookies.clear();

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = { origin: ORIGIN }): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const getRequest = (path: string) => new Request(`${ORIGIN}${path}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  app = await makeApp();
  app.deps.awaitRecovery = true;
  fake.runtime = { env: { APP_BASE_URL: ORIGIN }, deps: app.deps, sessionKey: SESSION_KEY, operatorPassHash: null, llm: null };
});
beforeEach(async () => {
  await resetApp(app);
  app.deps.llm = null;
  app.deps.awaitRecovery = true;
  signOut();
});
afterAll(async () => {
  await app.db.close();
});

async function scheduled(session: string, portId = "port_c"): Promise<string> {
  const quote = await createQuote(app.deps, session, request({ portId }));
  const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost")!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, session, accepted.reservationId, state, r.paypal_order_id!);
  return accepted.reservationId;
}

const grid = scenarioFor(DEMO_STATION, NIGHT).grid;
const PLUG_SLOT = (Date.parse("2026-11-06T03:00:00Z") - grid.startMs) / SLOT_MS;
const EARLY_DEPART_MS = Date.parse("2026-11-06T12:00:00Z");

/** A proposal awaiting the driver's approval, created by the real recovery path. */
async function proposal(rid: string, eventId: string): Promise<string> {
  const { event } = await recordDisruption(app.deps, { eventId, reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: EARLY_DEPART_MS }, effectiveSlot: PLUG_SLOT });
  const run = await runRecovery(app.deps, event.eventId);
  expect(run.status).toBe("NEEDS_APPROVAL");
  return run.runId;
}

const eventBody = (rid: string, eventId: string) => ({ eventId, reservationId: rid, type: "CHARGER_FAILURE", params: {}, effectiveSlot: 60 });

describe("POST /api/recovery/events", () => {
  it("refuses requests without a same-origin header, and anonymous or driver callers", async () => {
    const rid = await scheduled(DRIVER);
    const body = eventBody(rid, "evt_route_0001");
    expect((await postEvent(jsonRequest("/api/recovery/events", body, {}))).status).toBe(403);
    expect((await postEvent(jsonRequest("/api/recovery/events", body))).status).toBe(401);
    asDriver(DRIVER);
    expect((await postEvent(jsonRequest("/api/recovery/events", body))).status).toBe(401);
    expect(await app.db.query("select id from disruption_events")).toHaveLength(0);
  });

  it("refuses a cross-origin operator request", async () => {
    const rid = await scheduled(DRIVER);
    asOperator();
    const res = await postEvent(jsonRequest("/api/recovery/events", eventBody(rid, "evt_route_0002"), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("records a disturbance for an operator once; a repeat is idempotent; a reused id with other data is refused", async () => {
    const rid = await scheduled(DRIVER);
    asOperator();
    const body = eventBody(rid, "evt_route_0003");
    expect((await postEvent(jsonRequest("/api/recovery/events", body))).status).toBe(201);
    const again = await postEvent(jsonRequest("/api/recovery/events", body));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ created: false });
    const reused = await postEvent(jsonRequest("/api/recovery/events", { ...body, effectiveSlot: 61 }));
    expect(reused.status).toBe(409);
    expect((await reused.json()).error.code).toBe("EVENT_ID_REUSED");
  });

  it("rejects an invalid body and an unknown reservation", async () => {
    asOperator();
    const bad = await postEvent(jsonRequest("/api/recovery/events", { eventId: "evt_route_0004" }));
    expect(bad.status).toBe(400);
    const missing = await postEvent(jsonRequest("/api/recovery/events", eventBody("res_nope", "evt_route_0005")));
    expect(missing.status).toBe(404);
  });

  it("concurrent duplicates of one event produce one disturbance and one recovery run", async () => {
    const rid = await scheduled(DRIVER);
    asOperator();
    const body = eventBody(rid, "evt_route_0006");
    const statuses = (await Promise.all([postEvent(jsonRequest("/api/recovery/events", body)), postEvent(jsonRequest("/api/recovery/events", body))])).map((r) => r.status);
    expect(statuses.sort()).toEqual([200, 201]);
    expect(await app.db.query("select id from disruption_events")).toHaveLength(1);
    expect(await app.db.query("select id from recovery_runs")).toHaveLength(1);
  });
});

describe("GET /api/schedule", () => {
  it("the operator sees every session on the night; a driver sees only their own", async () => {
    const mine = await scheduled(DRIVER);
    const theirs = await scheduled(OTHER_DRIVER, "port_b");
    asOperator();
    const op = await (await getSchedule(getRequest(`/api/schedule?nightOf=${NIGHT}`))).json();
    expect(op.schedule.sessions.map((s: { reservationId: string }) => s.reservationId).sort()).toEqual([mine, theirs].sort());

    signOut();
    asDriver(DRIVER);
    const drv = await (await getSchedule(getRequest(`/api/schedule?nightOf=${NIGHT}`))).json();
    expect(drv.schedule.sessions.map((s: { reservationId: string }) => s.reservationId)).toEqual([mine]);
    expect(JSON.stringify(drv)).not.toContain(theirs);
  });

  it("refuses a malformed night and a caller with no session", async () => {
    expect((await getSchedule(getRequest("/api/schedule?nightOf=yesterday"))).status).toBe(400);
    expect((await getSchedule(getRequest(`/api/schedule?nightOf=${NIGHT}`))).status).toBe(401);
  });
});

describe("GET /api/recovery/runs/[id]", () => {
  it("the owner reads the run; a stranger gets 404; the operator reads it; no secrets are returned", async () => {
    const rid = await scheduled(DRIVER);
    const runId = await proposal(rid, "evt_route_run1");
    asDriver(DRIVER);
    const owner = await getRun(getRequest(`/api/recovery/runs/${runId}`), ctx(runId));
    expect(owner.status).toBe(200);
    const text = await owner.text();
    expect(text).not.toContain(DRIVER);
    expect(text).not.toMatch(/CLIENT_SECRET|access_token|paypal_order_id|PAYPAL-/);

    signOut();
    asDriver(OTHER_DRIVER);
    expect((await getRun(getRequest(`/api/recovery/runs/${runId}`), ctx(runId))).status).toBe(404);

    signOut();
    asOperator();
    expect((await getRun(getRequest(`/api/recovery/runs/${runId}`), ctx(runId))).status).toBe(200);
  });
});

describe("POST /api/recovery/runs/[id]/approve and reject", () => {
  it("the owner approves the exact proposal once; a double submit is refused", async () => {
    const rid = await scheduled(DRIVER);
    const runId = await proposal(rid, "evt_route_appr1");
    asDriver(DRIVER);
    const first = await approveRoute(jsonRequest(`/api/recovery/runs/${runId}/approve`, {}), ctx(runId));
    expect(first.status).toBe(200);
    expect((await first.json()).run.status).toBe("COMMITTED");
    const second = await approveRoute(jsonRequest(`/api/recovery/runs/${runId}/approve`, {}), ctx(runId));
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("NOT_PENDING");
  });

  it("a stranger, a bad origin and a missing session are refused without changing the schedule", async () => {
    const rid = await scheduled(DRIVER);
    const runId = await proposal(rid, "evt_route_appr2");
    signOut();
    expect((await approveRoute(jsonRequest(`/api/recovery/runs/${runId}/approve`, {}), ctx(runId))).status).toBe(404);
    asDriver(OTHER_DRIVER);
    expect((await approveRoute(jsonRequest(`/api/recovery/runs/${runId}/approve`, {}), ctx(runId))).status).toBe(404);
    asDriver(DRIVER);
    expect((await approveRoute(jsonRequest(`/api/recovery/runs/${runId}/approve`, {}, { origin: "https://evil.example" }), ctx(runId))).status).toBe(403);
    expect(await app.db.query("select version from schedule_versions")).toHaveLength(0);
  });

  it("an expired proposal is refused with PROPOSAL_EXPIRED", async () => {
    const rid = await scheduled(DRIVER);
    const runId = await proposal(rid, "evt_route_appr3");
    app.clock.now += 31 * 60_000;
    asDriver(DRIVER);
    const res = await approveRoute(jsonRequest(`/api/recovery/runs/${runId}/approve`, {}), ctx(runId));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("PROPOSAL_EXPIRED");
  });

  it("a proposal made against an older schedule version is refused with VERSION_CONFLICT", async () => {
    const rid = await scheduled(DRIVER);
    const runId = await proposal(rid, "evt_route_appr4");
    await app.db.query("insert into schedule_versions (reservation_id, version, source, power_w, reason) values ($1, 2, 'MANUAL', $2, 'TEST')", [
      rid,
      JSON.stringify((await getReservation(app.db, rid))!.terms.powerW),
    ]);
    asDriver(DRIVER);
    const res = await approveRoute(jsonRequest(`/api/recovery/runs/${runId}/approve`, {}), ctx(runId));
    expect((await res.json()).error.code).toBe("VERSION_CONFLICT");
  });

  it("the owner rejects a proposal; a later approval is refused", async () => {
    const rid = await scheduled(DRIVER);
    const runId = await proposal(rid, "evt_route_rej01");
    asDriver(DRIVER);
    const rejected = await rejectRoute(jsonRequest(`/api/recovery/runs/${runId}/reject`, {}), ctx(runId));
    expect((await rejected.json()).run.status).toBe("REJECTED");
    const late = await approveRoute(jsonRequest(`/api/recovery/runs/${runId}/approve`, {}), ctx(runId));
    expect(late.status).toBe(409);
  });
});

