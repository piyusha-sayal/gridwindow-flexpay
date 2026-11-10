/**
 * Abandoned-checkout expiry: ORDER_CREATED and BUYER_APPROVED rows are closed locally once their approval deadline has
 * passed, with no provider call, only when no authorization/capture evidence exists, and without ever overwriting a
 * concurrent return that authorized. Offline: MOCK provider on PGlite (or a disposable PostgreSQL).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvalDeadlineMs } from "@/domain/terms";
import type { AppDeps } from "@/server/deps";
import { claimOperation, getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { CHECKOUT_EXPIRED_UNPAID, expireAbandonedCheckout, expireAbandonedCheckouts } from "@/server/services/checkoutExpiryService";
import { resolveOutdatedSessions } from "@/server/services/outdatedSessionService";
import { createQuote } from "@/server/services/quoteService";
import { makeApp, request, resetApp, type TestApp } from "./helpers";

let app: TestApp;
let seq = 0;

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

interface Checkout {
  rid: string;
  orderId: string;
  state: string;
  session: string;
  deadline: number;
}

/** Order created at the provider (ORDER_CREATED); the buyer has not approved. `approved` also moves it to BUYER_APPROVED. */
async function checkout(approved = false): Promise<Checkout> {
  const session = `drv_expiry_${++seq}`;
  const quote = await createQuote(app.deps, session, request({}));
  const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost")!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  if (approved) await app.db.query("update reservations set payment_state = 'BUYER_APPROVED' where id = $1", [r.id]);
  return { rid: r.id, orderId: r.paypal_order_id!, state: new URL(order.returnUrl).searchParams.get("state")!, session, deadline: approvalDeadlineMs(r.terms) };
}

const count = async (sql: string, ...params: unknown[]) => (await app.db.query<{ n: number }>(sql, params))[0]!.n;
const eventCount = (rid: string, type = CHECKOUT_EXPIRED_UNPAID) => count("select count(*)::int as n from events where reservation_id = $1 and type = $2", rid, type);
const proofCount = (rid: string) => count("select count(*)::int as n from provider_proofs where reservation_id = $1", rid);
const operationCount = (rid: string) => count("select count(*)::int as n from payment_operations where reservation_id = $1", rid);
const rowOf = async (rid: string) => (await getReservation(app.db, rid))!;
const resetCalls = () => {
  app.gateway.calls = [];
};

describe("1 expiry transitions", () => {
  it("closes an unapproved order as CANCELLED and an approved-but-unauthorized order as FAILED, service CANCELLED, proofs kept", async () => {
    const created = await checkout();
    const approved = await checkout(true);
    const proofs = [await proofCount(created.rid), await proofCount(approved.rid)];
    app.clock.now = Math.max(created.deadline, approved.deadline);

    const result = await expireAbandonedCheckouts(app.deps);

    expect(result).toEqual({ examined: 2, closed: 2, failed: 0 });
    expect(await rowOf(created.rid)).toMatchObject({ payment_state: "CANCELLED", service_state: "CANCELLED", slots_committed: false, paypal_authorization_id: null, paypal_capture_id: null });
    expect(await rowOf(approved.rid)).toMatchObject({ payment_state: "FAILED", service_state: "CANCELLED", slots_committed: false, paypal_authorization_id: null, paypal_capture_id: null });
    expect([await proofCount(created.rid), await proofCount(approved.rid)]).toEqual(proofs);
  });
});

describe("2 zero gateway calls", () => {
  it("neither the expiry nor the full sweep that follows touches the provider", async () => {
    const a = await checkout(true);
    const b = await checkout();
    app.clock.now = Math.max(a.deadline, b.deadline);
    resetCalls();
    await expireAbandonedCheckouts(app.deps);
    await resolveOutdatedSessions(app.deps);
    expect(app.gateway.calls).toEqual([]);
    expect(await count("select count(*)::int as n from mock_provider_objects where kind in ('authorization', 'capture')")).toBe(0);
  });
});

describe("3 before the deadline", () => {
  it("leaves a valid checkout alone, and the driver can still return and authorize", async () => {
    const a = await checkout();
    app.clock.now = a.deadline - 1;
    expect(await expireAbandonedCheckouts(app.deps)).toEqual({ examined: 0, closed: 0, failed: 0 });
    expect(await expireAbandonedCheckout(app.deps, a.rid)).toBe(false);
    expect((await rowOf(a.rid)).payment_state).toBe("ORDER_CREATED");
    const returned = await handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId);
    expect(returned.payment_state).toBe("AUTHORIZED");
    expect(await eventCount(a.rid)).toBe(0);
  });
});

describe("4 exact deadline boundary", () => {
  it("closes at deadline and not at deadline - 1 ms (same comparison as the return handler)", async () => {
    const a = await checkout(true);
    app.clock.now = a.deadline - 1;
    expect(await expireAbandonedCheckout(app.deps, a.rid)).toBe(false);
    app.clock.now = a.deadline;
    expect(await expireAbandonedCheckout(app.deps, a.rid)).toBe(true);
    expect((await rowOf(a.rid)).payment_state).toBe("FAILED");
  });
});

describe("5 repeated and concurrent sweeps", () => {
  it("a second and third sweep change nothing and add no event", async () => {
    const a = await checkout(true);
    app.clock.now = a.deadline;
    await expireAbandonedCheckouts(app.deps);
    const after = await rowOf(a.rid);
    expect(await expireAbandonedCheckouts(app.deps)).toEqual({ examined: 0, closed: 0, failed: 0 });
    await resolveOutdatedSessions(app.deps);
    expect(await rowOf(a.rid)).toEqual(after);
    expect(await eventCount(a.rid)).toBe(1);
  });

  it("two overlapping sweeps close the row exactly once", async () => {
    const a = await checkout();
    app.clock.now = a.deadline;
    const [x, y] = await Promise.all([expireAbandonedCheckout(app.deps, a.rid), expireAbandonedCheckout(app.deps, a.rid)]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    expect(await eventCount(a.rid)).toBe(1);
  });
});

describe("6 authorization and capture evidence is never closed", () => {
  it("an authorization id, a capture id, or an AUTHORIZE / CAPTURE / VOID operation each keep the row open", async () => {
    const withAuth = await checkout(true);
    const withCapture = await checkout(true);
    const withAuthorizeOp = await checkout(true);
    const withCaptureOp = await checkout(true);
    const withVoidOp = await checkout(true);
    await app.db.query("update reservations set paypal_authorization_id = 'AUTH-TEST' where id = $1", [withAuth.rid]);
    await app.db.query("update reservations set paypal_capture_id = 'CAP-TEST' where id = $1", [withCapture.rid]);
    await claimOperation(app.db, withAuthorizeOp.rid, "AUTHORIZE");
    await claimOperation(app.db, withCaptureOp.rid, "CAPTURE");
    await claimOperation(app.db, withVoidOp.rid, "VOID");
    const all = [withAuth, withCapture, withAuthorizeOp, withCaptureOp, withVoidOp];
    app.clock.now = Math.max(...all.map((c) => c.deadline));

    expect(await expireAbandonedCheckouts(app.deps)).toEqual({ examined: 0, closed: 0, failed: 0 });
    for (const c of all) {
      expect(await expireAbandonedCheckout(app.deps, c.rid)).toBe(false);
      expect((await rowOf(c.rid)).payment_state).toBe("BUYER_APPROVED");
      expect(await eventCount(c.rid)).toBe(0);
    }
  });

  it("an authorized or terminal row is never touched", async () => {
    const a = await checkout();
    await handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId);
    app.clock.now = a.deadline + 1;
    expect(await expireAbandonedCheckout(app.deps, a.rid)).toBe(false);
    expect((await rowOf(a.rid)).payment_state).toBe("AUTHORIZED");
  });
});

describe("7 concurrent return and sweep", () => {
  it("an expiry that runs while the authorize is in flight cannot overwrite it: the row ends AUTHORIZED and nothing is closed", async () => {
    const a = await checkout();
    app.clock.now = a.deadline - 1;
    const realAuthorize = app.mock.authorizeOrder.bind(app.mock);
    let closedDuringAuthorize: boolean | null = null;
    app.gateway.overrides.authorizeOrder = async (id, key) => {
      app.clock.now = a.deadline + 1;
      closedDuringAuthorize = await expireAbandonedCheckout(app.deps, a.rid);
      return realAuthorize(id, key);
    };
    const returned = await handleCheckoutReturn(app.deps, a.session, a.rid, a.state, a.orderId);
    app.gateway.overrides = {};

    expect(closedDuringAuthorize).toBe(false);
    // The authorization stands (recorded by id); the existing late-authorization rule then voids it. Never FAILED/CANCELLED by expiry.
    expect(returned.paypal_authorization_id).not.toBeNull();
    expect(["AUTHORIZED", "VOIDED"]).toContain((await rowOf(a.rid)).payment_state);
    expect(await eventCount(a.rid)).toBe(0);
    expect(app.gateway.calls).not.toContain("captureAuthorization");
  });

  it("a candidate that was authorized between the selection and the lock is skipped by the compare-and-set recheck", async () => {
    const a = await checkout(true);
    app.clock.now = a.deadline;
    await app.db.query("update reservations set payment_state = 'AUTHORIZED', paypal_authorization_id = 'AUTH-RACE' where id = $1", [a.rid]);
    expect(await expireAbandonedCheckout(app.deps, a.rid)).toBe(false);
    expect(await rowOf(a.rid)).toMatchObject({ payment_state: "AUTHORIZED", paypal_authorization_id: "AUTH-RACE" });
    expect(await eventCount(a.rid)).toBe(0);
  });
});

describe("8 provider-mode isolation", () => {
  it("a sandbox runtime ignores MOCK rows, and a MOCK runtime ignores sandbox rows", async () => {
    const sandbox = await checkout(true);
    const mock = await checkout(true);
    await app.db.query("update reservations set provider_mode = 'PAYPAL_SANDBOX' where id = $1", [sandbox.rid]);
    app.clock.now = Math.max(sandbox.deadline, mock.deadline);
    const sandboxRuntime: AppDeps = { ...app.deps, gateway: { mode: "PAYPAL_SANDBOX" } as unknown as AppDeps["gateway"] };

    expect(await expireAbandonedCheckout(sandboxRuntime, mock.rid)).toBe(false);
    expect(await expireAbandonedCheckouts(sandboxRuntime)).toEqual({ examined: 1, closed: 1, failed: 0 });
    expect((await rowOf(sandbox.rid)).payment_state).toBe("FAILED");
    expect((await rowOf(mock.rid)).payment_state).toBe("BUYER_APPROVED");
  });

  it("a MOCK runtime leaves an overdue sandbox row open", async () => {
    const sandbox = await checkout(true);
    await app.db.query("update reservations set provider_mode = 'PAYPAL_SANDBOX' where id = $1", [sandbox.rid]);
    app.clock.now = sandbox.deadline;
    expect(await expireAbandonedCheckouts(app.deps)).toEqual({ examined: 0, closed: 0, failed: 0 });
    expect(await expireAbandonedCheckout(app.deps, sandbox.rid)).toBe(false);
    expect((await rowOf(sandbox.rid)).payment_state).toBe("BUYER_APPROVED");
    expect(await eventCount(sandbox.rid)).toBe(0);
  });
});

describe("9 orphan-authorization rotation", () => {
  const selected = async () => (await resolveOutdatedSessions(app.deps)).examined;

  it("a locally closed order-only row leaves the rotation, as does an order-only FAILED row with no AUTHORIZE operation", async () => {
    const a = await checkout(true);
    const b = await checkout();
    app.clock.now = Math.max(a.deadline, b.deadline);
    await expireAbandonedCheckouts(app.deps);
    resetCalls();
    expect(await selected()).toBe(0);
    expect(app.gateway.calls).toEqual([]);
    expect(await count("select count(*)::int as n from reservations where id = $1 and sweep_checked_at is not null", a.rid)).toBe(0);
  });

  it("a FAILED row that may hold a late authorization stays in the rotation: a stored authorization id, or an AUTHORIZE operation without one", async () => {
    const stored = await checkout(true);
    const lost = await checkout(true);
    await app.db.query("update reservations set payment_state = 'FAILED', service_state = 'CANCELLED', paypal_authorization_id = 'AUTH-ORPHAN' where id = $1", [stored.rid]);
    await claimOperation(app.db, lost.rid, "AUTHORIZE");
    await app.db.query("update reservations set payment_state = 'FAILED', service_state = 'CANCELLED' where id = $1", [lost.rid]);
    expect(await selected()).toBe(2);
  });
});

describe("10 return handler after closure", () => {
  it("a late return is refused without any authorization, for both closed states", async () => {
    const a = await checkout();
    const b = await checkout(true);
    app.clock.now = Math.max(a.deadline, b.deadline);
    await expireAbandonedCheckouts(app.deps);
    resetCalls();

    for (const c of [a, b]) {
      const returned = await handleCheckoutReturn(app.deps, c.session, c.rid, c.state, c.orderId);
      expect(["CANCELLED", "FAILED"]).toContain(returned.payment_state);
      expect(returned.paypal_authorization_id).toBeNull();
    }
    expect(app.gateway.calls).not.toContain("authorizeOrder");
    expect(await operationCount(a.rid)).toBe(1);
  });
});

describe("11 audit event", () => {
  it("is one APP event per closure with the transition, the deadline and zero provider calls; operations are unchanged", async () => {
    const a = await checkout();
    const b = await checkout(true);
    const operations = [await operationCount(a.rid), await operationCount(b.rid)];
    app.clock.now = Math.max(a.deadline, b.deadline);
    await expireAbandonedCheckouts(app.deps);

    for (const [c, from, to] of [
      [a, "ORDER_CREATED", "CANCELLED"],
      [b, "BUYER_APPROVED", "FAILED"],
    ] as const) {
      const events = await app.db.query<{ source: string; payload: Record<string, unknown> }>("select source, payload from events where reservation_id = $1 and type = $2", [c.rid, CHECKOUT_EXPIRED_UNPAID]);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ source: "APP", payload: { from, to, deadline: new Date(c.deadline).toISOString(), providerCalls: 0 } });
    }
    expect([await operationCount(a.rid), await operationCount(b.rid)]).toEqual(operations);
  });
});
