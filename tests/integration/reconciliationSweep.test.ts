/** Reconciliation sweep: bounded fair selection, reconciliation of unresolved rows, overlap safety, operator deadline view. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RESOLUTION_GRACE_MS } from "@/domain/outdatedSession";
import { effectivePowerOf, getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { operatorDashboard } from "@/server/services/viewService";
import { createQuote } from "@/server/services/quoteService";
import { OUTDATED_VOID_DECIDED, resolveOutdatedSession, resolveOutdatedSessions } from "@/server/services/outdatedSessionService";
import { makeApp, NIGHT, request, resetApp, type TestApp, timeout } from "./helpers";

const DRIVER = "drv_sweep_1";
let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
  app.deps.awaitRecovery = true;
});
beforeEach(async () => {
  await resetApp(app);
  app.deps.llm = null;
});
afterAll(async () => {
  await app.db.close();
});

const STUCK_PREFIX = "AUTH_STUCK_";

async function scheduled(session: string): Promise<string> {
  const quote = await createQuote(app.deps, session, request());
  const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost")!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, session, accepted.reservationId, state, r.paypal_order_id!);
  return accepted.reservationId;
}

async function firstChargingSlot(rid: string): Promise<number> {
  const powerW = await effectivePowerOf(app.db, (await getReservation(app.db, rid))!);
  return powerW.findIndex((w) => w > 0);
}

async function stage(rid: string, eventId: string, type: string, effectiveSlot: number): Promise<void> {
  await app.db.query(
    "insert into disruption_events (id, event_id, reservation_id, type, params, effective_slot, created_by) values ($1, $2, $3, $4, '{}', $5, 'TEST')",
    [`dis_${eventId}`, eventId, rid, type, effectiveSlot],
  );
  // Confirmed operator attribution: only that may auto-void under the full-void policy.
  await app.db.query("insert into events (reservation_id, type, source, payload) values ($1, 'DISRUPTION_RECORDED', 'OPERATOR', $2::jsonb)", [
    rid,
    JSON.stringify({ eventId, type, effectiveSlot, attribution: "OPERATOR" }),
  ]);
  await app.db.query("insert into recovery_runs (id, disruption_event_id, status, attempts) values ($1, $2, 'INFEASIBLE', 1)", [`rrun_${eventId}`, eventId]);
}

const callsOf = (name: string) => app.gateway.calls.filter((c) => c === name).length;
const countEvents = async (rid: string, type: string) =>
  (await app.db.query<{ n: number }>("select count(*)::int as n from events where reservation_id = $1 and type = $2", [rid, type]))[0]!.n;
const stateOf = async (rid: string) => (await getReservation(app.db, rid))!.payment_state;

/** Copies a reservation into `count` NEEDS_RECONCILIATION rows whose provider authorization the test makes unreachable. */
async function cloneUnresolvable(source: string, count: number): Promise<void> {
  await app.db.query(
    `insert into reservations select (jsonb_populate_record(null::reservations, to_jsonb(r) || jsonb_build_object(
        'id', 'stuck_' || g, 'offer_id', 'offer_stuck_' || g, 'paypal_order_id', null, 'paypal_capture_id', null,
        'paypal_authorization_id', '${STUCK_PREFIX}' || g, 'payment_state', 'NEEDS_RECONCILIATION'))).*
     from reservations r cross join generate_series(1, $2::int) g where r.id = $1`,
    [source, count],
  );
  const inner = app.gateway.inner;
  app.gateway.overrides.getAuthorization = async (id: string) => {
    if (id.startsWith(STUCK_PREFIX)) throw timeout();
    return inner.getAuthorization(id);
  };
}

describe("bounded fair selection", () => {
  it("120 unresolvable rows and one resolvable row: the resolvable row is reconciled within 3 passes of batch 50", async () => {
    const resolvable = await scheduled(DRIVER);
    await cloneUnresolvable(resolvable, 120);
    await app.db.query("update reservations set payment_state = 'NEEDS_RECONCILIATION' where id = $1", [resolvable]);

    const passes: { examined: number; failed: number }[] = [];
    for (let pass = 1; pass <= 3; pass++) {
      passes.push(await resolveOutdatedSessions(app.deps, 50));
      if ((await stateOf(resolvable)) === "AUTHORIZED") break;
    }
    expect(passes.length).toBeLessThanOrEqual(3);
    expect(passes.every((p) => p.examined <= 50)).toBe(true);
    expect(await stateOf(resolvable)).toBe("AUTHORIZED");
    expect(await countEvents(resolvable, "RECONCILED")).toBe(1);
    // Unresolvable rows stay unresolved and no money moves.
    const stuck = await app.db.query<{ payment_state: string }>("select payment_state from reservations where id like 'stuck_%'");
    expect(stuck).toHaveLength(120);
    expect(stuck.every((s) => s.payment_state === "NEEDS_RECONCILIATION")).toBe(true);
    expect(callsOf("captureAuthorization") + callsOf("voidAuthorization")).toBe(0);
  });

  it("every row is checked within ceil(n / batch) passes, so a backlog rotates", async () => {
    const source = await scheduled(DRIVER);
    await cloneUnresolvable(source, 120);
    for (let pass = 0; pass < 3; pass++) await resolveOutdatedSessions(app.deps, 50);
    const checked = await app.db.query<{ n: number }>("select count(*)::int as n from reservations where sweep_checked_at is not null");
    expect(checked[0]!.n).toBe(121);
  });
});

describe("reconciliation scope", () => {
  it("an expired authorization is left to the expired-authorization path and is not re-reconciled every pass", async () => {
    const rid = await scheduled(DRIVER);
    app.clock.now = (await getReservation(app.db, rid))!.authorization_expires_at!.getTime() + 1;
    expect(await resolveOutdatedSession(app.deps, rid)).toBe("PROVIDER_EXPIRED");
    expect(await stateOf(rid)).toBe("NEEDS_RECONCILIATION");

    app.gateway.calls = [];
    await resolveOutdatedSessions(app.deps);
    await resolveOutdatedSessions(app.deps);
    expect(callsOf("getAuthorization")).toBe(0);
    expect(await stateOf(rid)).toBe("NEEDS_RECONCILIATION");
    expect(await countEvents(rid, "RECONCILED")).toBe(0);
  });

  it("a reconciled authorization that still needs capacity is committed, as the boot path would", async () => {
    const rid = await scheduled(DRIVER);
    await app.db.query("update reservations set payment_state = 'NEEDS_RECONCILIATION', slots_committed = false, service_state = 'AWAITING_PAYMENT' where id = $1", [rid]);
    await resolveOutdatedSessions(app.deps);
    const r = (await getReservation(app.db, rid))!;
    expect(r).toMatchObject({ payment_state: "AUTHORIZED", slots_committed: true, service_state: "SCHEDULED" });
  });
});

describe("overlap safety", () => {
  it("overlapping sweeps and direct session resolutions void exactly once and never capture", async () => {
    const rid = await scheduled(DRIVER);
    await stage(rid, "evt_overlap_01", "CHARGER_FAILURE", await firstChargingSlot(rid));

    await Promise.all([
      resolveOutdatedSession(app.deps, rid),
      resolveOutdatedSession({ ...app.deps }, rid),
      resolveOutdatedSessions(app.deps),
      resolveOutdatedSessions({ ...app.deps }),
    ]);
    expect(callsOf("voidAuthorization")).toBe(1);
    expect(callsOf("captureAuthorization")).toBe(0);
    expect(await countEvents(rid, OUTDATED_VOID_DECIDED)).toBe(1);
    expect(await getReservation(app.db, rid)).toMatchObject({ payment_state: "VOIDED", service_state: "FAILED" });
  });
});

describe("operator resolution deadline view", () => {
  it("exposes the stored deadline and flips overdue once it has passed, without moving money", async () => {
    const rid = await scheduled(DRIVER);
    app.clock.now = (await getReservation(app.db, rid))!.terms.departMs + RESOLUTION_GRACE_MS;
    expect(await resolveOutdatedSession(app.deps, rid)).toBe("OPERATOR_RESOLUTION");

    const before = (await operatorDashboard(app.deps, NIGHT)).sessions.find((s) => s.id === rid)!;
    expect(before.operatorResolutionRequired).toBe(true);
    expect(before.resolutionDeadline).not.toBeNull();
    expect(Date.parse(before.resolutionDeadline!)).toBeGreaterThan(app.clock.now);
    expect(before.resolutionOverdue).toBe(false);

    app.clock.now = Date.parse(before.resolutionDeadline!) + 1;
    const after = (await operatorDashboard(app.deps, NIGHT)).sessions.find((s) => s.id === rid)!;
    expect(after.resolutionOverdue).toBe(true);
    expect(after.resolutionDeadline).toBe(before.resolutionDeadline);
    expect(await stateOf(rid)).toBe("AUTHORIZED");
  });

  it("a session without an open flag has no deadline", async () => {
    const rid = await scheduled(DRIVER);
    const row = (await operatorDashboard(app.deps, NIGHT)).sessions.find((s) => s.id === rid)!;
    expect(row).toMatchObject({ operatorResolutionRequired: false, resolutionDeadline: null, resolutionOverdue: false });
  });
});
