/**
 * Session-scoped reservation list for the Rewards & Payments page. Rows are selected by the visitor's
 * driver session only; each row is read through reservationView so provider-truth fields match the
 * reservation page. Totals are modeled figures from stored offers, never provider money movement.
 */
import type { PaymentState, ServiceState } from "@/domain/paymentState";
import type { AppDeps } from "../deps";
import { reservationView, type ProofView, type ReservationView } from "./viewService";

export const SESSION_RESERVATION_LIMIT = 50;

export interface SessionReservation {
  id: string;
  createdAt: string;
  portLabel: string;
  timeZone: string;
  offer: {
    targetBatteryWh: number;
    plugInMs: number;
    departMs: number;
    listPriceCents: number;
    agreedPriceCents: number;
    /** Modeled saving: list price minus the agreed price (not a cash payout). */
    modeledSavingCents: number;
  };
  paymentState: PaymentState;
  serviceState: ServiceState;
  authorizationExpiresAt: string | null;
  simulationOutcome: "DELIVERED" | "FAILED" | null;
  proofs: ProofView[];
  events: ReservationView["events"];
}

export interface SessionSummary {
  modeledSavingCents: number;
  agreedPriceCents: number;
  activeCommitments: number;
  captured: number;
  voided: number;
  pending: number;
}

/** Voided and cancelled commitments do not count toward modeled savings or agreed prices. */
const EXCLUDED_FROM_TOTALS: ReadonlySet<PaymentState> = new Set(["VOIDED", "CANCELLED"]);

function toSessionReservation(view: ReservationView, createdAt: Date): SessionReservation {
  return {
    id: view.id,
    createdAt: createdAt.toISOString(),
    portLabel: view.portLabel,
    timeZone: view.timeZone,
    offer: {
      targetBatteryWh: view.targetBatteryWh,
      plugInMs: view.plugInMs,
      departMs: view.departMs,
      listPriceCents: view.economics.listPriceCents,
      agreedPriceCents: view.economics.priceCents,
      modeledSavingCents: view.economics.discountCents,
    },
    paymentState: view.paymentState,
    serviceState: view.serviceState,
    authorizationExpiresAt: view.authorizationExpiresAt,
    simulationOutcome: view.simulation?.outcome ?? null,
    proofs: view.proofs,
    events: view.events,
  };
}

/** Newest first, capped. Only rows whose driver_session equals the given session are read. */
export async function listSessionReservations(deps: AppDeps, driverSession: string): Promise<SessionReservation[]> {
  const rows = await deps.db.query<{ id: string; created_at: Date }>(
    "select id, created_at from reservations where driver_session = $1 order by created_at desc, id desc limit $2",
    [driverSession, SESSION_RESERVATION_LIMIT],
  );
  const result: SessionReservation[] = [];
  for (const row of rows) {
    const view = await reservationView(deps, row.id, { driverSession });
    result.push(toSessionReservation(view, row.created_at));
  }
  return result;
}

export function summarizeSession(items: Pick<SessionReservation, "paymentState" | "offer">[]): SessionSummary {
  const totals = items.filter((item) => !EXCLUDED_FROM_TOTALS.has(item.paymentState));
  return {
    modeledSavingCents: totals.reduce((sum, item) => sum + item.offer.modeledSavingCents, 0),
    agreedPriceCents: totals.reduce((sum, item) => sum + item.offer.agreedPriceCents, 0),
    activeCommitments: items.filter((item) => item.paymentState === "AUTHORIZED").length,
    captured: items.filter((item) => item.paymentState === "CAPTURED").length,
    voided: items.filter((item) => item.paymentState === "VOIDED").length,
    pending: items.filter((item) => item.paymentState === "CAPTURE_PENDING").length,
  };
}
