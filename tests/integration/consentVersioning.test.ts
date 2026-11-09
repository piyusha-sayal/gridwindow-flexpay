/** Driver consent to a recovery proposal: versioned, exact, never extends terms, and visible only to its owner. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ServiceError } from "@/server/deps";
import { getReservation, effectivePowerOf } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { approveRecoveryRun, recordDisruption, rejectRecoveryRun, runRecovery } from "@/server/services/scheduleService";
import { scheduleView, driverScheduleView } from "@/server/services/scheduleView";
import { reservationView } from "@/server/services/viewService";
import { makeApp, NIGHT, request, resetApp, type TestApp } from "./helpers";
import { DEMO_STATION } from "@/domain/station";
import { SLOT_MS } from "@/domain/units";
import { scenarioFor } from "@/server/services/quoteService";

const DRIVER = "drv_consent_1";
const OTHER_DRIVER = "drv_consent_2";
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
const EARLY_DEPART_MS = Date.parse("2026-11-06T12:00:00Z");

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

/** Early departure on `rid` produces a proposal that needs the driver's approval. Returns the run id. */
async function proposalFor(rid: string, eventId: string): Promise<string> {
  const { event } = await recordDisruption(app.deps, { eventId, reservationId: rid, type: "EARLY_DEPARTURE", params: { departMs: EARLY_DEPART_MS }, effectiveSlot: PLUG_SLOT });
  const run = await runRecovery(app.deps, event.eventId);
  expect(run.status).toBe("NEEDS_APPROVAL");
  return run.runId;
}

const versionRows = (rid: string) => app.db.query<{ version: number }>("select version from schedule_versions where reservation_id = $1 order by version", [rid]);

describe("driver approval is exact and versioned", () => {
  it("approval writes only the proposed version: price, terms and deadline are unchanged, other drivers are untouched", async () => {
    const rid = await scheduled(DRIVER);
    const otherRid = await scheduled(OTHER_DRIVER, "port_b");
    const before = await getReservation(app.db, rid);
    const otherPowerBefore = await effectivePowerOf(app.db, (await getReservation(app.db, otherRid))!);
    const runId = await proposalFor(rid, "evt_consent_0001");

    await approveRecoveryRun(app.deps, runId, DRIVER);

    const after = await getReservation(app.db, rid);
    expect(after!.amount_cents).toBe(before!.amount_cents);
    expect(after!.terms).toEqual(before!.terms);
    expect(after!.authorization_expires_at?.getTime()).toBe(before!.authorization_expires_at?.getTime());
    expect(await versionRows(rid)).toHaveLength(1);
    expect(await versionRows(otherRid)).toEqual([]);
    expect(await effectivePowerOf(app.db, (await getReservation(app.db, otherRid))!)).toEqual(otherPowerBefore);
  });

  it("approving a proposal after a newer schedule version exists surfaces VERSION_CONFLICT and writes nothing more", async () => {
    const rid = await scheduled(DRIVER);
    const runId = await proposalFor(rid, "evt_consent_0002");
    // A version appears after the proposal was made (e.g. a manual commit elsewhere).
    await app.db.query("insert into schedule_versions (reservation_id, version, source, power_w, reason) values ($1, 2, 'MANUAL', $2, 'TEST')", [
      rid,
      JSON.stringify((await getReservation(app.db, rid))!.terms.powerW),
    ]);
    await expect(approveRecoveryRun(app.deps, runId, DRIVER)).rejects.toMatchObject({ code: "VERSION_CONFLICT" } satisfies Partial<ServiceError>);
    expect(await versionRows(rid)).toEqual([{ version: 2 }]);
    const stored = await app.db.query<{ status: string }>("select status from recovery_runs where id = $1", [runId]);
    expect(stored[0]!.status).toBe("FAILED");
  });

  it("approving a proposal superseded by a later disturbance on the same reservation is refused with STALE_PROPOSAL", async () => {
    const rid = await scheduled(DRIVER);
    const runId = await proposalFor(rid, "evt_consent_0003");
    await recordDisruption(app.deps, { eventId: "evt_consent_0004", reservationId: rid, type: "CHARGER_FAILURE", params: {}, effectiveSlot: 60 });
    await expect(approveRecoveryRun(app.deps, runId, DRIVER)).rejects.toMatchObject({ code: "STALE_PROPOSAL" } satisfies Partial<ServiceError>);
    expect(await versionRows(rid)).toEqual([]);
    expect((await app.db.query<{ status: string }>("select status from recovery_runs where id = $1", [runId]))[0]!.status).toBe("EXPIRED");
  });

  it("a double submit approves once; the second attempt is NOT_PENDING and writes nothing", async () => {
    const rid = await scheduled(DRIVER);
    const runId = await proposalFor(rid, "evt_consent_0005");
    await approveRecoveryRun(app.deps, runId, DRIVER);
    await expect(approveRecoveryRun(app.deps, runId, DRIVER)).rejects.toMatchObject({ code: "NOT_PENDING" } satisfies Partial<ServiceError>);
    expect(await versionRows(rid)).toHaveLength(1);
  });

  it("a rejected proposal never changes the schedule, and cannot be approved afterwards", async () => {
    const rid = await scheduled(DRIVER);
    const runId = await proposalFor(rid, "evt_consent_0006");
    await rejectRecoveryRun(app.deps, runId, DRIVER);
    await expect(approveRecoveryRun(app.deps, runId, DRIVER)).rejects.toMatchObject({ code: "NOT_PENDING" } satisfies Partial<ServiceError>);
    expect(await versionRows(rid)).toEqual([]);
  });
});

describe("pending approval is visible to its owner and to operators, never to strangers", () => {
  it("the driver reservation view carries the proposal diff, price and expiry, and clears once decided", async () => {
    const rid = await scheduled(DRIVER);
    const runId = await proposalFor(rid, "evt_consent_0007");
    const view = await reservationView(app.deps, rid, { driverSession: DRIVER });
    expect(view.pendingApproval).toMatchObject({
      runId,
      proposalVersion: 1,
      priceCents: view.economics.priceCents,
      proposed: { powerW: expect.any(Array), finishMs: expect.any(Number) },
      original: { powerW: view.powerW },
    });
    expect(view.pendingApproval!.expiresAt).not.toBeNull();
    const stored = await app.db.query<{ proposal: { powerW: number[] } }>("select proposal from recovery_runs where id = $1", [runId]);
    expect(view.pendingApproval!.proposed.powerW).toEqual(stored[0]!.proposal.powerW);

    await rejectRecoveryRun(app.deps, runId, DRIVER);
    expect((await reservationView(app.deps, rid, { driverSession: DRIVER })).pendingApproval).toBeNull();
  });

  it("a stranger cannot read the reservation, so the proposal is not exposed", async () => {
    const rid = await scheduled(DRIVER);
    await proposalFor(rid, "evt_consent_0008");
    await expect(reservationView(app.deps, rid, { driverSession: OTHER_DRIVER })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the operator schedule view lists the pending approval and the latest run per session; the driver view is scoped", async () => {
    const rid = await scheduled(DRIVER);
    const otherRid = await scheduled(OTHER_DRIVER, "port_b");
    const runId = await proposalFor(rid, "evt_consent_0009");

    const operator = await scheduleView(app.deps, NIGHT);
    const mine = operator.sessions.find((s) => s.reservationId === rid)!;
    expect(mine.latestRun).toMatchObject({ runId, status: "NEEDS_APPROVAL" });
    expect(mine.pendingApproval).toMatchObject({ runId, proposalVersion: 1 });
    expect(operator.sessions.find((s) => s.reservationId === otherRid)!.pendingApproval).toBeNull();

    const driver = await driverScheduleView(app.deps, NIGHT, OTHER_DRIVER);
    expect(driver.sessions.map((s) => s.reservationId)).toEqual([otherRid]);
    expect(driver.disruptions).toEqual([]);
  });
});
