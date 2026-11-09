/** Authorized sessions that a disturbance made unschedulable: settled or escalated, never captured from an invalid plan. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_STATION } from "@/domain/station";
import { SLOT_MS } from "@/domain/units";
import { getReservation, effectivePowerOf } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote, scenarioFor } from "@/server/services/quoteService";

import { RESOLUTION_GRACE_MS } from "@/domain/outdatedSession";
import { SETTLEMENT_POLICY_V1, termsHash } from "@/domain/terms";
import { SYNTHETIC_ECONOMICS } from "@/domain/economics";
import { FAILURE_REMEDY_COST_RECORDED, OPERATOR_RESOLUTION_REQUIRED, OUTDATED_VOID_DECIDED, resolveOutdatedSession, resolveOutdatedSessions } from "@/server/services/outdatedSessionService";
import { reconcileReservation } from "@/server/services/reconcileService";
import { settleFromExistingRun } from "@/server/services/settlementService";
import { handlePayPalWebhook } from "@/server/services/webhookService";
import { ProviderError } from "@/payments/gateway";
import { makeApp, NIGHT, request, resetApp, type TestApp, timeout } from "./helpers";

const DRIVER = "drv_outdated_1";
const OTHER_DRIVER = "drv_outdated_2";
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

const grid = scenarioFor(DEMO_STATION, NIGHT).grid;
const slotAt = (iso: string) => (Date.parse(iso) - grid.startMs) / SLOT_MS;
const PLUG_SLOT = slotAt("2026-11-06T03:00:00Z");

/**
 * Authorized, scheduled session. "legacy" re-stores the same offer as an agreement made before the settlement policy
 * existed: the policy field is absent and the terms are re-hashed, so the legacy rules apply to it.
 */
async function scheduled(session: string, portId = "port_c", agreement: "current" | "legacy" = "current"): Promise<string> {
  const quote = await createQuote(app.deps, session, request({ portId }));
  let offer = quote.offers.find((o) => o.kind === "flex_lowest_cost")!;
  if (agreement === "legacy") {
    const legacyTerms = Object.fromEntries(Object.entries(offer.terms).filter(([k]) => k !== "settlementPolicy")) as typeof offer.terms;
    const legacyHash = termsHash(legacyTerms);
    offer = { ...offer, terms: legacyTerms, termsHash: legacyHash };
    const legacyQuote = { ...quote, offers: quote.offers.map((o) => (o.kind === "flex_lowest_cost" ? offer : o)) };
    await app.db.query("update quote_sets set payload = $2::jsonb where id = $1", [quote.quoteSetId, JSON.stringify(legacyQuote)]);
  }
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, session, accepted.reservationId, state, r.paypal_order_id!);
  return accepted.reservationId;
}

/** First slot of the agreed plan that charges: a disturbance here delivers nothing. */
async function firstChargingSlot(rid: string): Promise<number> {
  const powerW = await effectivePowerOf(app.db, (await getReservation(app.db, rid))!);
  return powerW.findIndex((w) => w > 0);
}

/**
 * Records a disturbance without starting recovery, and the run row that recovery would have left. The attribution
 * defaults to a CONFIRMED operator cause, the scenario the void tests describe; other attributions are passed explicitly.
 */
async function stage(
  rid: string,
  eventId: string,
  type: string,
  params: Record<string, number>,
  effectiveSlot: number,
  runStatus: string | null,
  attempts = 1,
  expiresAt: Date | null = null,
  attribution = "OPERATOR",
): Promise<void> {
  await app.db.query(
    "insert into disruption_events (id, event_id, reservation_id, type, params, effective_slot, created_by) values ($1, $2, $3, $4, $5, $6, 'TEST')",
    [`dis_${eventId}`, eventId, rid, type, JSON.stringify(params), effectiveSlot],
  );
  await app.db.query("insert into events (reservation_id, type, source, payload) values ($1, 'DISRUPTION_RECORDED', 'OPERATOR', $2::jsonb)", [
    rid,
    JSON.stringify({ eventId, type, effectiveSlot, attribution }),
  ]);
  if (runStatus) {
    await app.db.query("insert into recovery_runs (id, disruption_event_id, status, attempts, expires_at) values ($1, $2, $3, $4, $5)", [`rrun_${eventId}`, eventId, runStatus, attempts, expiresAt]);
  }
}

const reservationState = async (rid: string) => {
  const r = (await getReservation(app.db, rid))!;
  return { payment: r.payment_state, service: r.service_state };
};
const versionRowCount = async (rid: string) => (await app.db.query<{ n: number }>("select count(*)::int as n from schedule_versions where reservation_id = $1", [rid]))[0]!.n;
const callsOf = (name: string) => app.gateway.calls.filter((c) => c === name).length;
const countEvents = async (rid: string, type: string) =>
  (await app.db.query<{ n: number }>("select count(*)::int as n from events where reservation_id = $1 and type = $2", [rid, type]))[0]!.n;

describe("zero delivered, permanently infeasible: void through the existing workflow", () => {
  it("is voided once; repeated and concurrent sweeps make no further provider calls", async () => {
    const rid = await scheduled(DRIVER);
    const slot = await firstChargingSlot(rid);
    await stage(rid, "evt_zero_0001", "CHARGER_FAILURE", {}, slot, "INFEASIBLE");

    expect(await resolveOutdatedSession(app.deps, rid)).toBe("VOIDED");
    expect(await reservationState(rid)).toEqual({ payment: "VOIDED", service: "FAILED" });
    expect(callsOf("voidAuthorization")).toBe(1);

    await resolveOutdatedSessions(app.deps);
    await Promise.all([resolveOutdatedSessions(app.deps), resolveOutdatedSessions({ ...app.deps, newId: app.deps.newId })]);
    expect(callsOf("voidAuthorization")).toBe(1);
    expect(await countEvents(rid, OUTDATED_VOID_DECIDED)).toBe(1);
  });

  it("a restarted process (new deps, same database) finishes nothing twice", async () => {
    const rid = await scheduled(DRIVER);
    await stage(rid, "evt_restart01", "CHARGER_FAILURE", {}, await firstChargingSlot(rid), "INFEASIBLE");
    await resolveOutdatedSessions(app.deps);
    const restarted = { ...app.deps, now: () => app.clock.now + 60_000 };
    await resolveOutdatedSessions(restarted);
    expect(await reservationState(rid)).toEqual({ payment: "VOIDED", service: "FAILED" });
    expect(callsOf("voidAuthorization")).toBe(1);
  });

  it("a repeated webhook for the void does not duplicate side effects", async () => {
    const rid = await scheduled(DRIVER);
    const r = (await getReservation(app.db, rid))!;
    await stage(rid, "evt_hook_0001", "CHARGER_FAILURE", {}, await firstChargingSlot(rid), "INFEASIBLE");
    await resolveOutdatedSessions(app.deps);
    app.gateway.webhookValid = true;
    const headers = { "paypal-transmission-id": "t-outdated" };
    const body = JSON.stringify({ id: "WH-OUTDATED-1", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: r.paypal_authorization_id } });
    await handlePayPalWebhook(app.deps, headers, body);
    expect((await handlePayPalWebhook(app.deps, headers, body)).result).toBe("DUPLICATE");
    expect(callsOf("voidAuthorization")).toBe(1);
    expect(await reservationState(rid)).toEqual({ payment: "VOIDED", service: "FAILED" });
  });

  it("a provider timeout on the void goes to reconciliation, and the retry replays the same idempotency key", async () => {
    const rid = await scheduled(DRIVER);
    await stage(rid, "evt_timeout01", "CHARGER_FAILURE", {}, await firstChargingSlot(rid), "INFEASIBLE");
    const keys: string[] = [];
    const inner = app.gateway.inner;
    app.gateway.overrides.voidAuthorization = async (id: string, key: string) => {
      keys.push(key);
      throw timeout();
    };
    await resolveOutdatedSessions(app.deps);
    expect(await reservationState(rid)).toMatchObject({ service: "FAILED" });
    expect((await getReservation(app.db, rid))!.payment_state).not.toBe("VOIDED");

    app.gateway.overrides.voidAuthorization = async (id: string, key: string) => {
      keys.push(key);
      return inner.voidAuthorization(id, key);
    };
    await resolveOutdatedSessions(app.deps);
    expect(await reservationState(rid)).toEqual({ payment: "VOIDED", service: "FAILED" });
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  it("a definitive provider refusal is not retried with a new key", async () => {
    const rid = await scheduled(DRIVER);
    await stage(rid, "evt_refuse001", "CHARGER_FAILURE", {}, await firstChargingSlot(rid), "INFEASIBLE");
    app.gateway.overrides.voidAuthorization = async () => {
      throw new ProviderError("HTTP_4XX", "refused", 422, undefined, "AUTHORIZATION_NOT_VOIDABLE");
    };
    await resolveOutdatedSessions(app.deps);
    expect(callsOf("voidAuthorization")).toBe(1);
    await resolveOutdatedSessions(app.deps);
    expect(callsOf("voidAuthorization")).toBe(1);
    expect(await countEvents(rid, "MANUAL_REVIEW_REQUIRED")).toBe(1);
  });
});

describe("partial delivered on a legacy agreement: no partial capture, operator resolution", () => {
  it("flags the reservation once and neither captures nor voids", async () => {
    const rid = await scheduled(DRIVER, "port_c", "legacy");
    const slot = (await firstChargingSlot(rid)) + 1;
    await stage(rid, "evt_part_0001", "CHARGER_FAILURE", {}, slot, "INFEASIBLE");

    expect(await resolveOutdatedSession(app.deps, rid)).toBe("OPERATOR_RESOLUTION");
    await resolveOutdatedSessions(app.deps);
    await resolveOutdatedSessions(app.deps);
    expect(await reservationState(rid)).toEqual({ payment: "AUTHORIZED", service: "SCHEDULED" });
    expect(callsOf("captureAuthorization")).toBe(0);
    expect(callsOf("voidAuthorization")).toBe(0);
    expect(await countEvents(rid, OPERATOR_RESOLUTION_REQUIRED)).toBe(1);
  });
});

describe("recoverable delay and approval: wait, then escalate when due", () => {
  it("a live recovery is never settled, even after its departure", async () => {
    const rid = await scheduled(DRIVER);
    await stage(rid, "evt_live_0001", "CHARGER_FAILURE", {}, await firstChargingSlot(rid), "RUNNING");
    app.clock.now += 24 * 3_600_000;
    expect(await resolveOutdatedSession(app.deps, rid)).toBe("WAITING");
    expect(app.gateway.calls.filter((c) => c === "voidAuthorization" || c === "captureAuthorization")).toHaveLength(0);
  });

  it("a recoverable delay waits until due, then zero delivered is voided (legacy agreement)", async () => {
    const rid = await scheduled(DRIVER, "port_c", "legacy");
    await stage(rid, "evt_delay_0001", "CHARGER_FAILURE", {}, await firstChargingSlot(rid), "FAILED", 1);
    expect(await resolveOutdatedSession(app.deps, rid)).toBe("WAITING");
    app.clock.now = (await getReservation(app.db, rid))!.terms.departMs + RESOLUTION_GRACE_MS;
    expect(await resolveOutdatedSession(app.deps, rid)).toBe("VOIDED");
  });

  it("an unapproved proposal waits, and once it is due an unrecovered zero-delivery session is voided (legacy agreement)", async () => {
    const rid = await scheduled(DRIVER, "port_c", "legacy");
    const impossibleDepart = Date.parse("2026-11-06T04:30:00Z");
    // Staged: the proposal awaits approval while the current plan is invalid under an impossible early departure.
    await stage(rid, "evt_appr_0001", "EARLY_DEPARTURE", { departMs: impossibleDepart }, PLUG_SLOT, "NEEDS_APPROVAL", 1, new Date(app.clock.now + 30 * 60_000));
    expect(await resolveOutdatedSession(app.deps, rid)).toBe("WAITING");
    app.clock.now = impossibleDepart + RESOLUTION_GRACE_MS;
    expect(await resolveOutdatedSession(app.deps, rid)).toBe("VOIDED");
    expect(await versionRowCount(rid)).toBe(0);
  });

  it("a session that a driver has not changed is never settled by the sweep", async () => {
    const rid = await scheduled(DRIVER);
    const other = await scheduled(OTHER_DRIVER, "port_b");
    expect(await resolveOutdatedSession(app.deps, rid)).toBe("NOT_OUTDATED");
    expect(await reservationState(other)).toEqual({ payment: "AUTHORIZED", service: "SCHEDULED" });
  });
});

describe("reconciliation stays in charge of uncertain outcomes", () => {
  it("reconcile after a failed capture keeps the state consistent without a new charge", async () => {
    const rid = await scheduled(DRIVER);
    await stage(rid, "evt_recon_001", "CHARGER_FAILURE", {}, await firstChargingSlot(rid), "INFEASIBLE");
    app.gateway.overrides.voidAuthorization = async () => {
      throw timeout();
    };
    await resolveOutdatedSessions(app.deps);
    // The provider still reports the authorization as CREATED, so reconciliation confirms it rather than inventing a void.
    const after = await reconcileReservation(app.deps, rid, "RECONCILER");
    expect(after.payment_state).toBe("AUTHORIZED");
    expect(callsOf("captureAuthorization")).toBe(0);
  });
});

const eventPayloads = async (rid: string, type: string) =>
  app.db.query<{ payload: Record<string, unknown> }>("select payload from events where reservation_id = $1 and type = $2 order by id", [rid, type]);
const settlementCalls = () => app.gateway.calls.filter((c) => c === "voidAuthorization" || c === "captureAuthorization");

describe("settlement policy OPERATOR_FAILURE_FULL_VOID_V1 (new agreements)", () => {
  it("a new agreement carries the policy in its hashed terms", async () => {
    const rid = await scheduled(DRIVER);
    expect((await getReservation(app.db, rid))!.terms.settlementPolicy).toBe(SETTLEMENT_POLICY_V1);
  });

  it("partial physical delivery from an operator failure is fully voided, with zero charge and the modeled remedy cost recorded once", async () => {
    const rid = await scheduled(DRIVER);
    await stage(rid, "evt_newpart01", "CHARGER_FAILURE", {}, (await firstChargingSlot(rid)) + 1, "INFEASIBLE");

    expect(await resolveOutdatedSession(app.deps, rid)).toBe("VOIDED");
    expect(await reservationState(rid)).toEqual({ payment: "VOIDED", service: "FAILED" });
    expect(callsOf("captureAuthorization")).toBe(0);
    expect(callsOf("voidAuthorization")).toBe(1);
    const remedy = await eventPayloads(rid, "FAILURE_REMEDY_COST_RECORDED");
    expect(remedy).toHaveLength(1);
    expect(remedy[0]!.payload).toMatchObject({ remedyCostCents: SYNTHETIC_ECONOMICS.failedServiceRemedyCents, basis: "MODELED" });
    expect(remedy[0]!.payload.deliveredBatteryMilliWh).toBeGreaterThan(0);
  });

  it("UNKNOWN, EXTERNAL and DRIVER attribution never move money and record no remedy; the operator is flagged with a deadline", async () => {
    for (const [attribution, n] of [
      ["UNKNOWN", 1],
      ["EXTERNAL", 2],
      ["DRIVER", 3],
    ] as const) {
      await resetApp(app);
      const rid = await scheduled(DRIVER);
      await stage(rid, `evt_attr_${attribution}`, "CHARGER_FAILURE", {}, (await firstChargingSlot(rid)) + n - 1, "INFEASIBLE", 1, null, attribution);

      expect(await resolveOutdatedSession(app.deps, rid)).toBe("OPERATOR_RESOLUTION");
      expect(await reservationState(rid)).toEqual({ payment: "AUTHORIZED", service: "SCHEDULED" });
      expect(await countEvents(rid, FAILURE_REMEDY_COST_RECORDED)).toBe(0);
      const flags = await eventPayloads(rid, OPERATOR_RESOLUTION_REQUIRED);
      expect(flags).toHaveLength(1);
      expect(typeof flags[0]!.payload.resolveBy).toBe("string");
    }
    expect(settlementCalls()).toHaveLength(0);
  });

  it("a driver-requested early departure is never voided or captured automatically", async () => {
    const rid = await scheduled(DRIVER);
    const impossibleDepart = Date.parse("2026-11-06T04:30:00Z");
    await stage(rid, "evt_early_0001", "EARLY_DEPARTURE", { departMs: impossibleDepart }, PLUG_SLOT, "INFEASIBLE");

    expect(await resolveOutdatedSession(app.deps, rid)).toBe("OPERATOR_RESOLUTION");
    await resolveOutdatedSessions(app.deps);
    expect(settlementCalls()).toHaveLength(0);
    expect(await reservationState(rid)).toEqual({ payment: "AUTHORIZED", service: "SCHEDULED" });
    const flags = await eventPayloads(rid, OPERATOR_RESOLUTION_REQUIRED);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.payload.basis).toBe("DRIVER_REQUESTED_DEPARTURE");
  });

  it("a pending driver approval blocks any void until it can no longer resolve", async () => {
    const rid = await scheduled(DRIVER);
    const expiresAt = app.clock.now + 30 * 60_000;
    await stage(rid, "evt_pendap_01", "CHARGER_FAILURE", {}, await firstChargingSlot(rid), "NEEDS_APPROVAL", 1, new Date(expiresAt));

    expect(await resolveOutdatedSession(app.deps, rid)).toBe("WAITING");
    app.clock.now = expiresAt - 1;
    expect(await resolveOutdatedSession(app.deps, rid)).toBe("WAITING");
    expect(settlementCalls()).toHaveLength(0);

    app.clock.now = expiresAt + 1;
    expect(await resolveOutdatedSession(app.deps, rid)).toBe("OPERATOR_RESOLUTION");
    expect(settlementCalls()).toHaveLength(0);
  });

  it("an unsimulated agreement past departure is flagged with a stored deadline, becomes overdue once, and never moves money", async () => {
    const rid = await scheduled(DRIVER);
    const departMs = (await getReservation(app.db, rid))!.terms.departMs;
    app.clock.now = departMs + RESOLUTION_GRACE_MS;

    expect(await resolveOutdatedSession(app.deps, rid)).toBe("OPERATOR_RESOLUTION");
    const flags = await eventPayloads(rid, OPERATOR_RESOLUTION_REQUIRED);
    expect(flags[0]!.payload).toMatchObject({ basis: "UNVERIFIED_DELIVERY" });
    const resolveBy = Date.parse(flags[0]!.payload.resolveBy as string);
    expect(resolveBy).toBeGreaterThan(app.clock.now);

    await resolveOutdatedSessions(app.deps);
    expect(await countEvents(rid, "OPERATOR_RESOLUTION_OVERDUE")).toBe(0);
    app.clock.now = resolveBy + 1;
    await resolveOutdatedSessions(app.deps);
    await resolveOutdatedSessions(app.deps);
    expect(await countEvents(rid, "OPERATOR_RESOLUTION_OVERDUE")).toBe(1);
    expect(await countEvents(rid, OPERATOR_RESOLUTION_REQUIRED)).toBe(1);
    expect(settlementCalls()).toHaveLength(0);
  });

  it("an authorization that the provider reports as expired is reconciled and recorded, never reauthorized or charged", async () => {
    const rid = await scheduled(DRIVER);
    const expiresMs = (await getReservation(app.db, rid))!.authorization_expires_at!.getTime();
    app.clock.now = expiresMs + 1;
    const inner = app.gateway.inner;
    app.gateway.overrides.getAuthorization = async (id: string) => ({ ...(await inner.getAuthorization(id)), status: "EXPIRED" });
    app.gateway.calls = [];

    expect(await resolveOutdatedSession(app.deps, rid)).toBe("PROVIDER_EXPIRED");
    expect(await reservationState(rid)).toMatchObject({ payment: "NEEDS_RECONCILIATION" });
    expect(app.gateway.calls.filter((c) => ["authorizeOrder", "captureAuthorization", "voidAuthorization"].includes(c))).toHaveLength(0);
  });

  it("a provider timeout while checking an expired authorization goes to reconciliation, not void or capture", async () => {
    const rid = await scheduled(DRIVER);
    const expiresMs = (await getReservation(app.db, rid))!.authorization_expires_at!.getTime();
    app.clock.now = expiresMs + 1;
    app.gateway.overrides.getAuthorization = async () => {
      throw timeout();
    };
    app.gateway.calls = [];

    expect(await resolveOutdatedSession(app.deps, rid)).toBe("PROVIDER_EXPIRED");
    expect(await reservationState(rid)).toMatchObject({ payment: "NEEDS_RECONCILIATION" });
    expect(settlementCalls()).toHaveLength(0);
  });

  it("webhook replay, sweep re-runs and a restart produce exactly one void, zero captures and one remedy record", async () => {
    const rid = await scheduled(DRIVER);
    const r = (await getReservation(app.db, rid))!;
    await stage(rid, "evt_dupnew_01", "CHARGER_FAILURE", {}, (await firstChargingSlot(rid)) + 1, "INFEASIBLE");
    await resolveOutdatedSessions(app.deps);
    app.gateway.webhookValid = true;
    const headers = { "paypal-transmission-id": "t-dup-new" };
    const body = JSON.stringify({ id: "WH-DUP-NEW-1", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: r.paypal_authorization_id } });
    await handlePayPalWebhook(app.deps, headers, body);
    expect((await handlePayPalWebhook(app.deps, headers, body)).result).toBe("DUPLICATE");
    await resolveOutdatedSessions({ ...app.deps, now: () => app.clock.now + 60_000 });
    await resolveOutdatedSessions(app.deps);

    expect(callsOf("voidAuthorization")).toBe(1);
    expect(callsOf("captureAuthorization")).toBe(0);
    expect(await countEvents(rid, "FAILURE_REMEDY_COST_RECORDED")).toBe(1);
    expect(await reservationState(rid)).toEqual({ payment: "VOIDED", service: "FAILED" });
  });
});

describe("ledger shortfall on a new agreement: automatic void only for a confirmed operator failure", () => {
  async function recordRun(rid: string, deliveredMilliWh: number, faults: Record<string, unknown>): Promise<void> {
    const r = (await getReservation(app.db, rid))!;
    await app.db.query(
      "insert into simulation_runs (id, reservation_id, outcome, delivered_battery_mwh, target_battery_mwh, faults, triggered_by) values ($1,$2,'FAILED',$3,$4,$5,'OPERATOR')",
      [`run_${rid}`, rid, deliveredMilliWh, r.terms.targetBatteryWh * 1000, JSON.stringify(faults)],
    );
  }

  it("a few Wh short with no injected outage (forecast error) flags the operator and moves no money", async () => {
    const rid = await scheduled(DRIVER);
    const r = (await getReservation(app.db, rid))!;
    await recordRun(rid, r.terms.targetBatteryWh * 1000 - 50_000, {});
    app.gateway.calls = [];

    await settleFromExistingRun(app.deps, rid);
    await settleFromExistingRun(app.deps, rid);

    expect(callsOf("voidAuthorization")).toBe(0);
    expect(callsOf("captureAuthorization")).toBe(0);
    expect(await countEvents(rid, OPERATOR_RESOLUTION_REQUIRED)).toBe(1);
    expect((await getReservation(app.db, rid))!.payment_state).toBe("AUTHORIZED");
  });

  it("the same shortfall with an injected charger outage is voided once with zero charge", async () => {
    const rid = await scheduled(DRIVER);
    const r = (await getReservation(app.db, rid))!;
    await recordRun(rid, r.terms.targetBatteryWh * 1000 - 50_000, { outage: { startSlot: 1, endSlot: 2 } });
    app.gateway.calls = [];

    await settleFromExistingRun(app.deps, rid);

    expect(callsOf("voidAuthorization")).toBe(1);
    expect(callsOf("captureAuthorization")).toBe(0);
    expect((await getReservation(app.db, rid))!.payment_state).toBe("VOIDED");
  });

  it("a full delivery is captured", async () => {
    const rid = await scheduled(DRIVER);
    const r = (await getReservation(app.db, rid))!;
    await recordRun(rid, r.terms.targetBatteryWh * 1000, {});
    // The simulator marks the service delivered before settlement; capture requires it.
    await app.db.query("update reservations set service_state = 'DELIVERED' where id = $1", [rid]);
    app.gateway.calls = [];

    await settleFromExistingRun(app.deps, rid);

    expect(callsOf("captureAuthorization")).toBe(1);
    expect(callsOf("voidAuthorization")).toBe(0);
  });
});
