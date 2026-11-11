/**
 * Recovery on a night where another session is already broken (MOCK payments, PGlite, deterministic recovery).
 * Regression for a finding of the 2026-11-11 release check: after a charger power cut on port B with no feasible
 * recovery, a later early departure on port A was reported "no feasible recovery" with every candidate rejected as
 * VALIDATOR_REJECTED: PORT_POWER_CAP, a violation that belonged to port B's session, not to the candidate. Candidate
 * validation and the commit after driver approval now count only what the candidate itself causes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { approveRecoveryRun, recordDisruption } from "@/server/services/scheduleService";
import { makeApp, request, resetApp, type TestApp } from "./helpers";

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});
beforeEach(async () => {
  await resetApp(app);
  app.deps.llm = null;
  app.deps.awaitRecovery = true;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterAll(async () => {
  await app.db.close();
});

async function book(driver: string, portId: string) {
  const quote = await createQuote(app.deps, driver, request({ portId }));
  const offer = quote.offers[0]!;
  const accepted = await acceptOffer(app.deps, driver, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, driver, accepted.reservationId, state, r.paypal_order_id!);
  return (await getReservation(app.db, accepted.reservationId))!;
}

const runOf = async (eventId: string) =>
  (await app.db.query<{ id: string; status: string }>("select id, status from recovery_runs where disruption_event_id = $1", [eventId]))[0]!;

describe("recovery after another session's infeasible disturbance", () => {
  it("an early departure on port A is still recoverable, with the driver's consent, and commits version 2", async () => {
    const broken = await book("drv_rec_1", "port_b");
    await recordDisruption(app.deps, { eventId: "evt_rec_cut_01", reservationId: broken.id, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 2_400 }, effectiveSlot: 16 });
    expect((await runOf("evt_rec_cut_01")).status).toBe("INFEASIBLE");

    const leaving = await book("drv_rec_2", "port_a");
    expect(`${leaving.payment_state}/${leaving.service_state}`).toBe("AUTHORIZED/SCHEDULED");
    await recordDisruption(app.deps, { eventId: "evt_rec_early_1", reservationId: leaving.id, type: "EARLY_DEPARTURE", params: { departMs: leaving.terms.departMs - 3_600_000 }, effectiveSlot: 0 });
    const run = await runOf("evt_rec_early_1");
    expect(run.status).toBe("NEEDS_APPROVAL"); // the departure moves earlier: never applied without the driver

    const gatewayBefore = app.gateway.calls.length;
    const approved = await approveRecoveryRun(app.deps, run.id, "drv_rec_2");
    expect(approved.status).toBe("COMMITTED");
    // No candidate was rejected for port B's power-cap violation (it is not this session's problem).
    expect(JSON.stringify(approved.outcome)).not.toMatch(/PORT_POWER_CAP/);
    const versions = await app.db.query<{ version: number; source: string }>("select version, source from schedule_versions where reservation_id = $1 order by version", [leaving.id]);
    expect(versions.map((v) => `${v.version}:${v.source}`)).toContain("2:RECOVERY");
    expect(app.gateway.calls.length).toBe(gatewayBefore); // recovery never moves money
  });
});
