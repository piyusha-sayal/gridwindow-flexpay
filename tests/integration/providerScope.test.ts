/**
 * Provider-mode isolation: reservations created under the MOCK provider must never cause a call to (or a write
 * on behalf of) a real PayPal Sandbox gateway, and the reverse. Covers the startup/interval sweeps, the webhook and
 * operator recovery path, settlement and the checkout return.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PaymentGateway, ProviderAuthorization, ProviderCapture, ProviderMode, ProviderOrder } from "@/payments/gateway";
import type { AppDeps } from "@/server/deps";
import { getReservation } from "@/server/repo";
import { acceptOffer, commitCapacityOrVoid, handleCheckoutReturn } from "@/server/services/checkoutService";
import { resolveOutdatedSessions } from "@/server/services/outdatedSessionService";
import { createQuote } from "@/server/services/quoteService";
import { reconcileReservation } from "@/server/services/reconcileService";
import { recoverPendingReservations, recoverReservation } from "@/server/services/recoveryService";
import { captureAuthorization, runSimulation, settleFromExistingRun, voidAuthorization } from "@/server/services/settlementService";
import { makeApp, request, resetApp, type TestApp } from "./helpers";

/** A gateway of the other provider that fails the test on any use. */
class ForbiddenGateway implements PaymentGateway {
  calls: string[] = [];
  constructor(readonly mode: ProviderMode) {}
  private forbid(name: string): never {
    this.calls.push(name);
    throw new Error(`gateway.${name} must not be called for a reservation of another provider`);
  }
  createOrder(): Promise<ProviderOrder> {
    return this.forbid("createOrder");
  }
  getOrder(): Promise<ProviderOrder> {
    return this.forbid("getOrder");
  }
  authorizeOrder(): Promise<ProviderAuthorization> {
    return this.forbid("authorizeOrder");
  }
  getAuthorization(): Promise<ProviderAuthorization> {
    return this.forbid("getAuthorization");
  }
  captureAuthorization(): Promise<ProviderCapture> {
    return this.forbid("captureAuthorization");
  }
  getCapture(): Promise<ProviderCapture> {
    return this.forbid("getCapture");
  }
  voidAuthorization(): Promise<void> {
    return this.forbid("voidAuthorization");
  }
  verifyWebhook(): Promise<boolean> {
    return this.forbid("verifyWebhook");
  }
}

const DRIVER = "drv_scope_1";
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

/** A MOCK-provider reservation that is AUTHORIZED and SCHEDULED with a committed slot. */
async function mockAuthorized(): Promise<string> {
  const quote = await createQuote(app.deps, DRIVER, request());
  const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost")!;
  const accepted = await acceptOffer(app.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, DRIVER, accepted.reservationId, state, r.paypal_order_id!);
  return accepted.reservationId;
}

async function snapshot(): Promise<unknown> {
  const rows = await app.db.query("select id, payment_state, service_state, slots_committed, sweep_checked_at, updated_at from reservations order by id");
  const counts = await app.db.query(
    "select (select count(*) from events)::int e, (select count(*) from provider_proofs)::int p, (select count(*) from payment_operations)::int o, (select count(*) from simulation_runs)::int s",
  );
  return { rows, counts };
}

const withGateway = (gateway: PaymentGateway): AppDeps => ({ ...app.deps, gateway });

/** Puts the reservation into each state the sweeps select on, one at a time. */
async function inSweepSelectableStates(rid: string): Promise<void> {
  await app.db.query("update reservations set payment_state = 'NEEDS_RECONCILIATION', paypal_authorization_id = 'AUTH_X1' where id = $1", [rid]);
}

describe("sandbox runtime over MOCK reservations", () => {
  it("sweeps select no MOCK row and make no provider call or write", async () => {
    const rid = await mockAuthorized();
    const sandbox = new ForbiddenGateway("PAYPAL_SANDBOX");
    const deps = withGateway(sandbox);

    const states: [string, string][] = [
      ["AUTHORIZED", "SCHEDULED"],
      ["AUTHORIZED", "DELIVERED"],
      ["AUTHORIZED", "FAILED"],
      ["NEEDS_RECONCILIATION", "SCHEDULED"],
      ["CANCELLED", "CANCELLED"],
      ["FAILED", "FAILED"],
      ["QUOTE_ACCEPTED", "AWAITING_PAYMENT"],
      ["CAPTURE_PENDING", "DELIVERED"],
    ];
    for (const [pay, svc] of states) {
      await app.db.query("update reservations set payment_state = $2, service_state = $3 where id = $1", [rid, pay, svc]);
      const before = await snapshot();
      expect(await recoverPendingReservations(deps)).toEqual({ attempted: 0, failed: 0 });
      expect(await resolveOutdatedSessions(deps)).toEqual({ examined: 0, failed: 0 });
      expect(await snapshot()).toEqual(before);
    }
    expect(sandbox.calls).toEqual([]);
  });

  it("direct provider-touching entry points refuse a MOCK reservation before any call or write", async () => {
    const rid = await mockAuthorized();
    const sandbox = new ForbiddenGateway("PAYPAL_SANDBOX");
    const deps = withGateway(sandbox);
    const before = await snapshot();
    const refused = { code: "PROVIDER_MODE_MISMATCH", httpStatus: 409 };

    await expect(reconcileReservation(deps, rid, "RECONCILER")).rejects.toMatchObject(refused);
    await expect(recoverReservation(deps, rid, "RECONCILER")).rejects.toMatchObject(refused);
    await expect(voidAuthorization(deps, rid, "TEST")).rejects.toMatchObject(refused);
    await expect(captureAuthorization(deps, rid)).rejects.toMatchObject(refused);
    await expect(settleFromExistingRun(deps, rid)).rejects.toMatchObject(refused);
    await expect(runSimulation(deps, rid, { kind: "OPERATOR" })).rejects.toMatchObject(refused);
    await expect(commitCapacityOrVoid(deps, rid)).rejects.toMatchObject(refused);

    expect(sandbox.calls).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("a checkout return for a MOCK reservation is refused without an authorize call", async () => {
    const quote = await createQuote(app.deps, DRIVER, request());
    const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost")!;
    const accepted = await acceptOffer(app.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
    const r = (await getReservation(app.db, accepted.reservationId))!;
    const order = await app.mock.approve(r.paypal_order_id!);
    const state = new URL(order.returnUrl).searchParams.get("state")!;
    const sandbox = new ForbiddenGateway("PAYPAL_SANDBOX");
    const before = await snapshot();

    await expect(handleCheckoutReturn(withGateway(sandbox), DRIVER, accepted.reservationId, state, r.paypal_order_id!)).rejects.toMatchObject({ code: "PROVIDER_MODE_MISMATCH" });
    expect(sandbox.calls).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("a non-MOCK row is untouched by a MOCK runtime (reverse direction)", async () => {
    const rid = await mockAuthorized();
    await app.db.query("update reservations set provider_mode = 'PAYPAL_SANDBOX' where id = $1", [rid]);
    app.gateway.calls = [];
    const before = await snapshot();

    expect(await recoverPendingReservations(app.deps)).toEqual({ attempted: 0, failed: 0 });
    expect(await resolveOutdatedSessions(app.deps)).toEqual({ examined: 0, failed: 0 });
    await expect(voidAuthorization(app.deps, rid, "TEST")).rejects.toMatchObject({ code: "PROVIDER_MODE_MISMATCH" });
    expect(app.gateway.calls).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("positive control: a row of the running provider is still swept", async () => {
    const rid = await mockAuthorized();
    expect((await resolveOutdatedSessions(app.deps)).examined).toBeGreaterThanOrEqual(1);
    await inSweepSelectableStates(rid);
    expect((await recoverPendingReservations(app.deps)).attempted).toBeGreaterThanOrEqual(1);
  });
});
