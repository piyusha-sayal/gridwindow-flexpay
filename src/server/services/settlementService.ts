/**
 * Synthetic delivery → exactly one settlement: capture on verified delivery, void on failure.
 * Capture-after-void is prevented by state CAS + a unique settlement-operation index.
 */
import { simulateSession, type SimulationFaults } from "@/domain/simulator";
import { ProviderError } from "@/payments/gateway";
import { ServiceError, type AppDeps } from "../deps";
import {
  appendEvent,
  claimOperation,
  committedPlans,
  finishOperation,
  getReservation,
  leaseOperation,
  patchReservation,
  providerSource,
  recordProof,
  SettlementConflictError,
  transitionPayment,
  type ReservationRow,
} from "../repo";
import { scenarioFor } from "./quoteService";
import { reconcileReservation, truthFromCapture } from "./reconcileService";

export const HONOR_PERIOD_MS = 3 * 86_400_000;

export type SimulationActor = { kind: "DRIVER"; session: string } | { kind: "OPERATOR" };

export async function runSimulation(deps: AppDeps, rid: string, actor: SimulationActor, faults: SimulationFaults = {}): Promise<ReservationRow> {
  const r = await getReservation(deps.db, rid);
  if (!r || (actor.kind === "DRIVER" && r.driver_session !== actor.session)) throw new ServiceError("NOT_FOUND", "Reservation not found.", 404);
  if (actor.kind === "DRIVER" && faults.outage) throw new ServiceError("FORBIDDEN", "Only the operator can inject faults.", 403);
  const existingRun = await deps.db.query("select id from simulation_runs where reservation_id = $1", [rid]);
  // One run per reservation; a repeat call only finishes a settlement that was interrupted.
  if (existingRun.length > 0) return settleFromExistingRun(deps, rid);
  if (r.payment_state !== "AUTHORIZED" || r.service_state !== "SCHEDULED" || !r.slots_committed) {
    throw new ServiceError("NOT_READY", "Charging can only be simulated for an authorized, scheduled reservation.", 409);
  }
  if (r.authorization_expires_at && deps.now() >= r.authorization_expires_at.getTime()) {
    await transitionPayment(deps.db, rid, "AUTHORIZED", "NEEDS_RECONCILIATION");
    await appendEvent(deps.db, rid, "AUTHORIZATION_EXPIRED", "APP", {});
    throw new ServiceError("AUTHORIZATION_EXPIRED", "The authorization has expired; routed to reconciliation.", 409);
  }

  const scenario = scenarioFor(deps.station, r.night_of);
  const others = await committedPlans(deps.db, r.station_id, r.night_of, r.id);
  const otherW = Array.from({ length: scenario.grid.slotCount }, (_, i) => others.reduce((sum, p) => sum + (p.powerW[i] ?? 0), 0));
  const result = simulateSession({
    station: deps.station,
    grid: scenario.grid,
    powerW: r.terms.powerW,
    actualBaseLoadW: scenario.actualBaseLoadW,
    otherSessionsW: otherW,
    targetBatteryWh: r.terms.targetBatteryWh,
    efficiencyBp: r.terms.efficiencyBp,
    faults,
  });

  const runId = deps.newId("run");
  const inserted = await deps.db.tx(async (q) => {
    const rows = await q.query(
      `insert into simulation_runs (id, reservation_id, outcome, delivered_battery_mwh, target_battery_mwh, faults, triggered_by)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (reservation_id) do nothing returning id`,
      [runId, rid, result.outcome, result.deliveredBatteryMilliWh, result.targetBatteryMilliWh, JSON.stringify(faults), actor.kind],
    );
    if (rows.length === 0) return false;
    for (const rec of result.records) {
      await q.query(
        `insert into energy_records (run_id, reservation_id, slot_index, slot_start, commanded_w, delivered_w, grid_wh, battery_mwh, limited_by, source)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'SYNTHETIC')`,
        [runId, rid, rec.slotIndex, new Date(rec.slotStartMs).toISOString(), rec.commandedW, rec.deliveredW, rec.gridWh, rec.batteryMilliWh, rec.limitedBy],
      );
    }
    await patchReservation(q, rid, { service_state: result.outcome === "DELIVERED" ? "DELIVERED" : "FAILED" });
    await appendEvent(q, rid, result.outcome === "DELIVERED" ? "SERVICE_DELIVERED" : "SERVICE_FAILED", "SYNTHETIC_SIMULATOR", {
      runId,
      deliveredBatteryMilliWh: result.deliveredBatteryMilliWh,
      targetBatteryMilliWh: result.targetBatteryMilliWh,
      shortfallBatteryMilliWh: result.shortfallBatteryMilliWh,
      faults,
    });
    return true;
  });
  if (!inserted) return (await getReservation(deps.db, rid))!;

  if (r.authorized_at && deps.now() - r.authorized_at.getTime() > HONOR_PERIOD_MS) {
    await appendEvent(deps.db, rid, "HONOR_PERIOD_ELAPSED", "APP", { note: "Capture after the 3-day honor period may be declined by the provider." });
  }
  return result.outcome === "DELIVERED" ? captureAuthorization(deps, rid) : voidAuthorization(deps, rid, "SERVICE_FAILED");
}

/** Completes capture/void for a reservation whose synthetic run is recorded but not yet settled. */
export async function settleFromExistingRun(deps: AppDeps, rid: string): Promise<ReservationRow> {
  const r = (await getReservation(deps.db, rid))!;
  if (r.payment_state !== "AUTHORIZED") return r;
  const runs = await deps.db.query<{ outcome: "DELIVERED" | "FAILED" }>("select outcome from simulation_runs where reservation_id = $1", [rid]);
  const run = runs[0];
  if (!run) return r;
  return run.outcome === "DELIVERED" ? captureAuthorization(deps, rid) : voidAuthorization(deps, rid, "SERVICE_FAILED");
}

async function handleSettlementError(deps: AppDeps, rid: string, key: string, err: unknown, event: string): Promise<ReservationRow> {
  // Only an explicit provider rejection is definitive; anything else may have been applied and is replayed with the same key.
  const ambiguous = !(err instanceof ProviderError) || err.ambiguous;
  await finishOperation(deps.db, key, ambiguous ? "AMBIGUOUS" : "FAILED", null, err instanceof ProviderError ? (err.issue ?? err.kind) : "UNKNOWN");
  await transitionPayment(deps.db, rid, "AUTHORIZED", "NEEDS_RECONCILIATION");
  await appendEvent(deps.db, rid, event, "APP", { ambiguous, issue: err instanceof ProviderError ? (err.issue ?? null) : null });
  return reconcileReservation(deps, rid, "RECONCILER");
}

/**
 * Claims and leases the single settlement operation. Returns null when this worker must not call
 * the provider: the other settlement kind exists, another worker holds the lease, or an earlier
 * attempt was definitively rejected (a same-key replay would only repeat the rejection).
 */
async function leaseSettlement(deps: AppDeps, r: ReservationRow, kind: "CAPTURE" | "VOID"): Promise<string | null> {
  let claim;
  try {
    claim = await claimOperation(deps.db, r.id, kind, { termsHash: r.terms_hash, amountCents: r.amount_cents });
  } catch (err) {
    if (err instanceof SettlementConflictError) {
      await appendEvent(deps.db, r.id, kind === "CAPTURE" ? "CAPTURE_REFUSED_AFTER_VOID" : "VOID_REFUSED_AFTER_CAPTURE", "APP", {});
      return null;
    }
    throw err;
  }
  if (claim.op.status === "FAILED") {
    await appendEvent(deps.db, r.id, "MANUAL_REVIEW_REQUIRED", "APP", { reason: `${kind} was rejected by the provider; not retried automatically` });
    return null;
  }
  const leased = await leaseOperation(deps.db, claim.op.idempotency_key, deps.now());
  return leased ? leased.idempotency_key : null;
}

/**
 * Captures the authorized amount once, after verified synthetic delivery. The capture is re-read
 * from the provider; only COMPLETED with the expected authorization, amount and currency is CAPTURED.
 */
export async function captureAuthorization(deps: AppDeps, rid: string): Promise<ReservationRow> {
  const r = (await getReservation(deps.db, rid))!;
  if (r.payment_state !== "AUTHORIZED" || r.service_state !== "DELIVERED" || !r.paypal_authorization_id) return r;
  if (r.authorization_expires_at && deps.now() >= r.authorization_expires_at.getTime()) {
    // Capture eligibility lapsed: a new charge needs renewed buyer consent, never an automatic retry.
    await transitionPayment(deps.db, rid, "AUTHORIZED", "NEEDS_RECONCILIATION");
    await appendEvent(deps.db, rid, "AUTHORIZATION_EXPIRED", "APP", { at: "capture" });
    return (await getReservation(deps.db, rid))!;
  }
  const key = await leaseSettlement(deps, r, "CAPTURE");
  if (!key) return r;
  try {
    const created = await deps.gateway.captureAuthorization(r.paypal_authorization_id, r.amount_cents, r.id, key);
    // PayPal truth wins: re-read the capture from the provider before deciding the local state.
    const capture = await deps.gateway.getCapture(created.captureId);
    await finishOperation(deps.db, key, "SUCCEEDED", capture.captureId);
    const truth = truthFromCapture(r, capture);
    if (await transitionPayment(deps.db, rid, "AUTHORIZED", truth.state, truth.patch)) {
      if (truth.proof) await recordProof(deps.db, rid, truth.proof.type, deps.gateway.mode, truth.proof.ref, truth.proof.status, truth.proof.amountCents);
      await appendEvent(deps.db, rid, truth.state === "CAPTURED" ? "CAPTURED" : "CAPTURE_NOT_COMPLETED", providerSource(deps.gateway.mode), {
        captureId: capture.captureId,
        status: capture.status,
        localState: truth.state,
      });
    }
  } catch (err) {
    return handleSettlementError(deps, rid, key, err, "CAPTURE_FAILED");
  }
  return (await getReservation(deps.db, rid))!;
}

/** Voids the authorization once (service failure or capacity conflict). Never a refund. */
export async function voidAuthorization(deps: AppDeps, rid: string, reason: string): Promise<ReservationRow> {
  const r = (await getReservation(deps.db, rid))!;
  if (r.payment_state !== "AUTHORIZED" || !r.paypal_authorization_id) return r;
  const key = await leaseSettlement(deps, r, "VOID");
  if (!key) return r;
  try {
    await deps.gateway.voidAuthorization(r.paypal_authorization_id, key);
    const auth = await deps.gateway.getAuthorization(r.paypal_authorization_id);
    await finishOperation(deps.db, key, "SUCCEEDED", auth.authorizationId);
    if (auth.status === "VOIDED") {
      await recordProof(deps.db, rid, "VOIDED", deps.gateway.mode, auth.authorizationId, auth.status, auth.amountCents);
      await transitionPayment(deps.db, rid, "AUTHORIZED", "VOIDED", { slots_committed: false });
      await appendEvent(deps.db, rid, "VOIDED", providerSource(deps.gateway.mode), { reason, status: auth.status });
    } else {
      await transitionPayment(deps.db, rid, "AUTHORIZED", "NEEDS_RECONCILIATION");
      await appendEvent(deps.db, rid, "VOID_NOT_CONFIRMED", providerSource(deps.gateway.mode), { status: auth.status });
    }
  } catch (err) {
    return handleSettlementError(deps, rid, key, err, "VOID_FAILED");
  }
  return (await getReservation(deps.db, rid))!;
}
