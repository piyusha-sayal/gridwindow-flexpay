import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { acceptOffer } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { listSessionReservations, summarizeSession, type SessionReservation } from "@/server/services/sessionService";
import { makeApp, request, resetApp, type TestApp } from "./helpers";

const SESSION_A = "drv_session_a";
const SESSION_B = "drv_session_b";
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

/** Accepts the first offer for the session and returns the new reservation id. */
async function acceptFor(session: string): Promise<string> {
  const quote = await createQuote(app.deps, session, request());
  const offer = quote.offers[0]!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  return accepted.reservationId;
}

describe("session-scoped reservation list", () => {
  it("returns nothing for a session without reservations", async () => {
    expect(await listSessionReservations(app.deps, SESSION_A)).toEqual([]);
  });

  it("never returns another session's rows and lists newest first", async () => {
    const a1 = await acceptFor(SESSION_A);
    const b1 = await acceptFor(SESSION_B);
    const a2 = await acceptFor(SESSION_A);

    const listA = await listSessionReservations(app.deps, SESSION_A);
    const listB = await listSessionReservations(app.deps, SESSION_B);

    expect(listA.map((r) => r.id)).toEqual([a2, a1]);
    expect(listB.map((r) => r.id)).toEqual([b1]);
    expect(listA.some((r) => r.id === b1)).toBe(false);
  });

  it("exposes offer economics, states and timeline from the reservation view", async () => {
    const id = await acceptFor(SESSION_A);
    const [row] = await listSessionReservations(app.deps, SESSION_A);

    expect(row).toMatchObject({ id, paymentState: "ORDER_CREATED", serviceState: "AWAITING_PAYMENT", simulationOutcome: null });
    expect(row!.offer.modeledSavingCents).toBe(row!.offer.listPriceCents - row!.offer.agreedPriceCents);
    expect(row!.offer.modeledSavingCents).toBeGreaterThan(0);
    expect(row!.events.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(row!.createdAt))).toBe(false);
  });
});

function row(paymentState: SessionReservation["paymentState"], list: number, agreed: number): Pick<SessionReservation, "paymentState" | "offer"> {
  return { paymentState, offer: { targetBatteryWh: 30_000, plugInMs: 0, departMs: 0, listPriceCents: list, agreedPriceCents: agreed, modeledSavingCents: list - agreed } };
}

describe("summarizeSession", () => {
  it("excludes voided and cancelled commitments from totals and counts payment states", () => {
    const summary = summarizeSession([
      row("AUTHORIZED", 1600, 1200),
      row("CAPTURED", 1000, 800),
      row("VOIDED", 5000, 4000),
      row("CANCELLED", 5000, 4000),
      row("CAPTURE_PENDING", 500, 400),
    ]);
    expect(summary).toEqual({ modeledSavingCents: 400 + 200 + 100, agreedPriceCents: 1200 + 800 + 400, activeCommitments: 1, captured: 1, voided: 1, pending: 1 });
  });

  it("returns zeros for an empty session", () => {
    expect(summarizeSession([])).toEqual({ modeledSavingCents: 0, agreedPriceCents: 0, activeCommitments: 0, captured: 0, voided: 0, pending: 0 });
  });
});
