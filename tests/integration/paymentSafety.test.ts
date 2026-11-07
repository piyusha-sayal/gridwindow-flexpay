/**
 * Payment-safety reconciliation (2026-10-31): reproductions for gaps found while re-verifying
 * review findings #1–#10, plus direct checks for findings that had no dedicated test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvalDeadlineMs } from "@/domain/terms";
import { getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { recoverReservation } from "@/server/services/recoveryService";
import { operatorDashboard, reservationView } from "@/server/services/viewService";
import { makeApp, NIGHT, request, resetApp, timeout, type TestApp } from "./helpers";

const DRIVER = "drv_safety";
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

async function acceptedAndApproved() {
  const quote = await createQuote(app.deps, DRIVER, request());
  const offer = quote.offers[0]!;
  const accepted = await acceptOffer(app.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  return { rid: r.id, orderId: r.paypal_order_id!, state, deadline: approvalDeadlineMs({ gridStartMs: quote.grid.startMs, powerW: offer.powerW, plugInMs: quote.request.plugInMs }) };
}

describe("late provider responses", () => {
  it("an authorization confirmed only after the approval deadline is voided, never committed to capacity", async () => {
    const { rid, orderId, state, deadline } = await acceptedAndApproved();
    app.clock.now = deadline - 60_000;
    // The provider applies the authorization, but the response is lost (timeout).
    const real = app.mock.authorizeOrder.bind(app.mock);
    const realGetOrder = app.mock.getOrder.bind(app.mock);
    let authorizeSent = false;
    app.gateway.overrides.authorizeOrder = async (id, key) => {
      await real(id, key);
      authorizeSent = true;
      throw timeout();
    };
    // The provider stays unreachable for lookups once the authorize request was sent.
    app.gateway.overrides.getOrder = async (id) => {
      if (authorizeSent) throw timeout();
      return realGetOrder(id);
    };
    const mid = await handleCheckoutReturn(app.deps, DRIVER, rid, state, orderId);
    expect(mid.payment_state).toBe("NEEDS_RECONCILIATION");
    expect(mid.slots_committed).toBe(false);

    // Reconciliation learns of the authorization after charging should have started.
    app.gateway.overrides = {};
    app.clock.now = deadline + 60_000;
    const { reservation } = await recoverReservation(app.deps, rid, "RECONCILER");
    expect(reservation.payment_state).toBe("VOIDED");
    expect(reservation.slots_committed).toBe(false);
    expect(reservation.service_state).toBe("CANCELLED");
  });
});

describe("provider capture evidence that contradicts a terminal local state", () => {
  it.each(["FAILED", "CANCELLED", "VOIDED"] as const)("local %s + provider captured → evidence recorded, never shown as $0.00, flagged for the operator", async (localState) => {
    const { rid, orderId, state } = await acceptedAndApproved();
    const authorized = await handleCheckoutReturn(app.deps, DRIVER, rid, state, orderId);
    expect(authorized.payment_state).toBe("AUTHORIZED");
    // External capture (e.g. in the provider dashboard) while the local row is terminal.
    await app.mock.captureAuthorization(authorized.paypal_authorization_id!, authorized.amount_cents, rid, "external-capture-key");
    await app.db.query("update reservations set payment_state = $2, slots_committed = false where id = $1", [rid, localState]);

    await recoverReservation(app.deps, rid, "RECONCILER");
    const view = await reservationView(app.deps, rid, { operator: true });
    expect(view.paymentState).toBe(localState); // terminal states are never rewritten automatically
    const capture = view.proofs.find((p) => p.type === "CAPTURED");
    expect(capture?.amountCents).toBe(authorized.amount_cents);
    const events = await app.db.query<{ type: string }>("select type from events where reservation_id = $1", [rid]);
    expect(events.map((e) => e.type)).toContain("PROVIDER_CAPTURE_CONFLICT");

    const dash = await operatorDashboard(app.deps, NIGHT);
    expect(dash.sessions.find((s) => s.id === rid)?.providerCapturedCents).toBe(authorized.amount_cents);
  });
});

describe("#8 proofs never contradict a terminal local state (except kept capture evidence)", () => {
  it("local CAPTURED + provider authorization VOIDED: conflict logged, no VOIDED proof recorded", async () => {
    const { rid, orderId, state } = await acceptedAndApproved();
    const authorized = await handleCheckoutReturn(app.deps, DRIVER, rid, state, orderId);
    await app.mock.voidAuthorization(authorized.paypal_authorization_id!, "external-void-key");
    await app.db.query("update reservations set payment_state = 'CAPTURED', slots_committed = false where id = $1", [rid]);

    await recoverReservation(app.deps, rid, "RECONCILER");
    const proofs = await app.db.query<{ proof_type: string }>("select proof_type from provider_proofs where reservation_id = $1", [rid]);
    expect(proofs.map((p) => p.proof_type)).not.toContain("VOIDED");
    const events = await app.db.query<{ type: string }>("select type from events where reservation_id = $1", [rid]);
    expect(events.map((e) => e.type)).toContain("RECONCILIATION_CONFLICT");
    expect((await getReservation(app.db, rid))!.payment_state).toBe("CAPTURED");
  });
});

describe("#7 a capacity-conflict loser never re-commits, even after capacity frees up", () => {
  it("failed void, capacity released by another driver, revisit and recovery: stays CANCELLED, then VOIDED", async () => {
    const sessions = ["drv_7a", "drv_7b", "drv_7c"];
    const pending = [];
    for (const [i, port] of ["port_a", "port_b", "port_c"].entries()) {
      const quote = await createQuote(app.deps, sessions[i]!, request({ portId: port, targetBatteryKWh: 45 }));
      const offer = quote.offers[0]!;
      const accepted = await acceptOffer(app.deps, sessions[i]!, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
      pending.push({ session: sessions[i]!, rid: accepted.reservationId });
    }
    app.gateway.overrides.voidAuthorization = async () => {
      throw timeout();
    };
    const results = [];
    for (const { session, rid } of pending) {
      const r = (await getReservation(app.db, rid))!;
      const order = await app.mock.approve(r.paypal_order_id!);
      const state = new URL(order.returnUrl).searchParams.get("state")!;
      results.push({ session, state, orderId: r.paypal_order_id!, r: await handleCheckoutReturn(app.deps, session, rid, state, r.paypal_order_id!) });
    }
    const loser = results.find((x) => x.r.service_state === "CANCELLED")!;
    expect(loser).toBeDefined();
    // Another driver's capacity is released, so a re-commit would now succeed.
    for (const w of results.filter((x) => x !== loser)) await app.db.query("update reservations set slots_committed = false where id = $1", [w.r.id]);

    const revisit = await handleCheckoutReturn(app.deps, loser.session, loser.r.id, loser.state, loser.orderId);
    expect(revisit).toMatchObject({ service_state: "CANCELLED", slots_committed: false });
    expect((await recoverReservation(app.deps, loser.r.id, "OPERATOR")).reservation).toMatchObject({ service_state: "CANCELLED", slots_committed: false });
    delete app.gateway.overrides.voidAuthorization;
    expect((await recoverReservation(app.deps, loser.r.id, "OPERATOR")).reservation.payment_state).toBe("VOIDED");
  });
});
