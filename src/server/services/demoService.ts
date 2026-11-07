/**
 * Development-only demo tooling (MOCK provider + DEMO_TOOLS=true + operator session, enforced
 * by the route). Seeding drives the real quote → accept → mock approval → authorize code path;
 * nothing is inserted directly.
 */
import { isMockGateway } from "@/payments/mockGateway";
import { ServiceError, type AppDeps } from "../deps";
import type { AppEnv } from "../env";
import { getReservation } from "../repo";
import { acceptOffer, handleCheckoutReturn } from "./checkoutService";
import { createQuote, driverDefaultWindow, toChargeRequest, type QuoteRequestInput } from "./quoteService";

const DEMO_DRIVER = "drv_demo_background";

/**
 * Demo tools exist only in an explicit dev/demo configuration: opt-in flag, MOCK payments and the
 * embedded throwaway database. A configured DATABASE_URL (a real PostgreSQL server) always disables them.
 */
export function demoToolsAllowed(env: Pick<AppEnv, "DEMO_TOOLS" | "PAYMENT_MODE" | "DATABASE_URL">): boolean {
  return env.DEMO_TOOLS === "true" && env.PAYMENT_MODE === "mock" && !env.DATABASE_URL;
}

/** Background drivers occupying ports B and C so the operator view shows a realistic night. */
const BACKGROUND: Omit<QuoteRequestInput, "nightOf">[] = [
  { portId: "port_b", plugInLocal: "18:30", departLocal: "06:30", targetBatteryKWh: 42, spendCapCents: 3_000 },
  { portId: "port_c", plugInLocal: "20:15", departLocal: "08:00", targetBatteryKWh: 26, spendCapCents: 2_000 },
];

export async function resetDemoData(deps: AppDeps): Promise<void> {
  if (!isMockGateway(deps.gateway)) throw new ServiceError("MOCK_ONLY", "Demo reset is only available in MOCK mode.", 409);
  // TRUNCATE bypasses the append-only row triggers by design; this is a dev-only wipe of a throwaway database.
  await deps.db.query(
    "truncate events, energy_records, simulation_runs, webhook_inbox, provider_proofs, payment_operations, reservations, quote_sets, mock_provider_objects restart identity cascade",
  );
}

export async function seedDemoNight(deps: AppDeps, nightOf: string): Promise<string[]> {
  const gateway = deps.gateway;
  if (!isMockGateway(gateway)) throw new ServiceError("MOCK_ONLY", "Demo seeding is only available in MOCK mode.", 409);
  const ids: string[] = [];
  for (const input of BACKGROUND) {
    // Later in the evening a background car plugs in at the next bookable time, never in the past.
    const passed = toChargeRequest(deps.station, { ...input, nightOf }).plugInMs < deps.now();
    const plugInLocal = passed ? driverDefaultWindow(deps.station, deps.now()).plugInLocal : input.plugInLocal;
    const quote = await createQuote(deps, DEMO_DRIVER, { ...input, nightOf, plugInLocal });
    const offer = quote.offers[0];
    if (!offer) continue; // Truthfully skip when no win-win offer exists for that night.
    const accepted = await acceptOffer(deps, DEMO_DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
    const r = await getReservation(deps.db, accepted.reservationId);
    if (!r?.paypal_order_id) continue;
    const order = await gateway.approve(r.paypal_order_id);
    const state = new URL(order.returnUrl).searchParams.get("state") ?? "";
    await handleCheckoutReturn(deps, DEMO_DRIVER, r.id, state, r.paypal_order_id);
    ids.push(r.id);
  }
  return ids;
}
