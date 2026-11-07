/**
 * Sprint 12 lifecycle certification against the real backend services and the MOCK provider
 * (production code paths; only the provider is simulated): late buyer approval and partial
 * delivery shortfall. Not a PayPal Sandbox certification.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ERROR_COPY } from "@/components/api";
import { approvalDeadlineMs } from "@/domain/terms";
import { getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { handlePayPalWebhook } from "@/server/services/webhookService";
import { reconcileReservation } from "@/server/services/reconcileService";
import { captureAuthorization, runSimulation } from "@/server/services/settlementService";
import { makeApp, request, resetApp, type TestApp } from "./helpers";

const DRIVER = "drv_cert";
let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});
beforeEach(async () => {
  await resetApp(app);
});
afterAll(async () => {
  await app.db.close();
});

/** Accepted offer whose buyer has approved on the (mock) hosted page but has not returned yet. */
async function approvedNotReturned() {
  const quote = await createQuote(app.deps, DRIVER, request());
  const offer = quote.offers[0]!;
  const { reservationId } = await acceptOffer(app.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  return { rid: reservationId, orderId: r.paypal_order_id!, state: new URL(order.returnUrl).searchParams.get("state")!, deadline: approvalDeadlineMs(r.terms) };
}

async function events(rid: string) {
  return (await app.db.query<{ type: string }>("select type from events where reservation_id = $1 order by id", [rid])).map((e) => e.type);
}

describe("buyer approval deadline", () => {
  it("is the start of the first scheduled charging slot", () => {
    expect(approvalDeadlineMs({ gridStartMs: 1_000, plugInMs: 0, powerW: [0, 0, 7_000, 7_000] })).toBe(1_000 + 2 * 900_000);
    expect(approvalDeadlineMs({ gridStartMs: 1_000, plugInMs: 42, powerW: [0, 0] })).toBe(42);
  });

  it("a return just before the deadline still authorizes", async () => {
    const { rid, orderId, state, deadline } = await approvedNotReturned();
    app.clock.now = deadline - 1;
    const r = await handleCheckoutReturn(app.deps, DRIVER, rid, state, orderId);
    expect(r.payment_state).toBe("AUTHORIZED");
    expect(r.slots_committed).toBe(true);
  });

  it("a return after charging should have started cancels without authorizing or holding capacity", async () => {
    const { rid, orderId, state, deadline } = await approvedNotReturned();
    app.clock.now = deadline;
    await expect(handleCheckoutReturn(app.deps, DRIVER, rid, state, orderId)).rejects.toMatchObject({ code: "APPROVAL_TOO_LATE" });
    const r = (await getReservation(app.db, rid))!;
    expect(r).toMatchObject({ payment_state: "CANCELLED", service_state: "CANCELLED", slots_committed: false });
    expect(app.gateway.calls).not.toContain("authorizeOrder");
    expect(await events(rid)).toContain("APPROVAL_AFTER_DEADLINE");
    // The return route redirects to /drive?error=APPROVAL_TOO_LATE; the driver sees specific copy, not the generic error.
    expect(ERROR_COPY.APPROVAL_TOO_LATE).toMatch(/No payment was taken/);
    // A repeated late return changes nothing and still never authorizes.
    expect((await handleCheckoutReturn(app.deps, DRIVER, rid, state, orderId)).payment_state).toBe("CANCELLED");
    expect(app.gateway.calls).not.toContain("authorizeOrder");
  });

  it("approval learned from provider truth (reconcile → BUYER_APPROVED) is not authorized after the deadline", async () => {
    const { rid, orderId, state, deadline } = await approvedNotReturned();
    await reconcileReservation(app.deps, rid, "RECONCILER");
    expect((await getReservation(app.db, rid))!.payment_state).toBe("BUYER_APPROVED");
    app.clock.now = deadline + 60_000;
    await expect(handleCheckoutReturn(app.deps, DRIVER, rid, state, orderId)).rejects.toMatchObject({ code: "APPROVAL_TOO_LATE" });
    expect((await getReservation(app.db, rid))!).toMatchObject({ payment_state: "FAILED", service_state: "CANCELLED", slots_committed: false });
    expect(app.gateway.calls).not.toContain("authorizeOrder");
  });
});

describe("webhook duplicates with distinct event ids (authenticated MOCK provider, not real PayPal delivery)", () => {
  const headers = { "paypal-transmission-id": "t-cert" };

  it("repeated capture-completed and a late void event after capture leave exactly one capture and CAPTURED", async () => {
    const { rid, orderId, state } = await approvedNotReturned();
    const authorized = await handleCheckoutReturn(app.deps, DRIVER, rid, state, orderId);
    await runSimulation(app.deps, rid, { kind: "OPERATOR" });
    app.gateway.webhookValid = true;
    const resource = { id: authorized.paypal_authorization_id, supplementary_data: { related_ids: { order_id: orderId } } };
    for (const [id, type] of [
      ["WH-CAP-1", "PAYMENT.CAPTURE.COMPLETED"],
      ["WH-CAP-2", "PAYMENT.CAPTURE.COMPLETED"],
      ["WH-VOID-LATE", "PAYMENT.AUTHORIZATION.VOIDED"],
    ] as const) {
      expect((await handlePayPalWebhook(app.deps, headers, JSON.stringify({ id, event_type: type, resource }))).result).toBe("PROCESSED");
    }
    expect((await getReservation(app.db, rid))!.payment_state).toBe("CAPTURED");
    expect(await app.db.query("select id from mock_provider_objects where kind = 'capture'")).toHaveLength(1);
    expect(await app.db.query("select proof_type from provider_proofs where reservation_id = $1 and proof_type in ('CAPTURED', 'VOIDED')", [rid])).toEqual([{ proof_type: "CAPTURED" }]);
    expect(app.gateway.calls.filter((c) => c === "captureAuthorization")).toHaveLength(1);
    expect(app.gateway.calls).not.toContain("voidAuthorization");
  });
});

describe("delivery shortfall", () => {
  it("partial delivery (energy delivered but short of the target) voids and never captures", async () => {
    const { rid, orderId, state } = await approvedNotReturned();
    const authorized = await handleCheckoutReturn(app.deps, DRIVER, rid, state, orderId);
    const lastCharging = authorized.terms.powerW.findLastIndex((w) => w > 0);
    const failed = await runSimulation(app.deps, rid, { kind: "OPERATOR" }, { outage: { fromSlot: lastCharging, toSlot: lastCharging + 1 } });
    const run = (await app.db.query<{ delivered_battery_mwh: string; target_battery_mwh: string; outcome: string }>("select delivered_battery_mwh, target_battery_mwh, outcome from simulation_runs where reservation_id = $1", [rid]))[0]!;
    expect(Number(run.delivered_battery_mwh)).toBeGreaterThan(0);
    expect(Number(run.delivered_battery_mwh)).toBeLessThan(Number(run.target_battery_mwh));
    expect(run.outcome).toBe("FAILED");
    expect(failed).toMatchObject({ service_state: "FAILED", payment_state: "VOIDED", slots_committed: false });
    expect((await captureAuthorization(app.deps, rid)).payment_state).toBe("VOIDED");
    expect(app.gateway.calls).not.toContain("captureAuthorization");
  });
});
