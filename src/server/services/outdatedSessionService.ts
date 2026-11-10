/**
 * Resolves authorized sessions that a disturbance made unschedulable, and settles or escalates every other authorized
 * session that the agreed plan no longer covers (no delivery evidence after departure, provider-expired authorization,
 * settlement interrupted after a simulation). Uses only existing settlement primitives: the keyed void workflow, the
 * operator flag, and the reconciler. Every decision is re-derived from stored state, so repeated, concurrent and
 * post-restart sweeps are safe.
 */
import { effectiveDepartMs, validateWithEnvelope } from "@/domain/disturbance";
import {
  authorizationNearExpiry,
  OPERATOR_RESOLUTION_WINDOW_MS,
  resolutionBasis,
  resolutionDue,
  settlementAction,
  type ResolutionBasis,
  type SettlementInput,
} from "@/domain/outdatedSession";
import { settlementPolicyOf } from "@/domain/terms";
import { snapshotSession } from "@/domain/recovery";
import type { AppDeps } from "../deps";
import type { Queryable } from "../db/client";
import { appendEvent, committedPlans, effectivePowerOf, getReservation, planOf, transitionPayment, type ReservationRow } from "../repo";
import { MAX_ATTEMPTS, planningFor } from "./recoveryOrchestrator";
import { recoverReservation } from "./recoveryService";
import { commitCapacityOrVoid } from "./checkoutService";
import { expireAbandonedCheckouts } from "./checkoutExpiryService";
import { reconcileReservation } from "./reconcileService";
import { latestRunsByReservation } from "./approvalView";
import { nightContext } from "./scheduleService";
import { voidAuthorization } from "./settlementService";
import { sessionAttribution } from "@/domain/faultAttribution";
import { reservationDisturbances } from "./scheduleService";

export const OUTDATED_SWEEP_INTERVAL_MS = 5 * 60_000;
export const OUTDATED_VOID_DECIDED = "OUTDATED_VOID_DECIDED";
export const OPERATOR_RESOLUTION_REQUIRED = "OPERATOR_RESOLUTION_REQUIRED";
export const OPERATOR_RESOLUTION_OVERDUE = "OPERATOR_RESOLUTION_OVERDUE";
export const FAILURE_REMEDY_COST_RECORDED = "FAILURE_REMEDY_COST_RECORDED";
export const AUTHORIZATION_EXPIRED_UNCONFIRMED = "AUTHORIZATION_EXPIRED_UNCONFIRMED";

export type OutdatedResolution = "NOT_OUTDATED" | "WAITING" | "VOIDED" | "VOID_PENDING" | "OPERATOR_RESOLUTION" | "SETTLED" | "PROVIDER_EXPIRED";

/** Whether a disturbance has made the agreed-and-current schedule invalid under the disturbed envelope. */
async function isOutdated(deps: AppDeps, r: ReservationRow): Promise<boolean> {
  const { scenario, envelope } = await nightContext(deps.db, deps.station, r.night_of);
  const powerW = await effectivePowerOf(deps.db, r);
  const others = await committedPlans(deps.db, deps.station.id, r.night_of, r.id);
  const own = { ...planOf(r, powerW), departMs: effectiveDepartMs(envelope, r.id, r.terms.departMs) };
  return validateWithEnvelope({
    station: deps.station,
    grid: scenario.grid,
    forecastBaseLoadW: scenario.forecastBaseLoadW,
    envelope,
    plans: [...others, own],
    targets: [{ sessionId: r.id, targetBatteryWh: r.terms.targetBatteryWh, efficiencyBp: r.terms.efficiencyBp }],
  }).some((v) => v.sessionId === r.id);
}

/** Earliest disturbance slot on this reservation: energy scheduled before it was delivered. */
async function earliestEffectiveSlot(deps: AppDeps, rid: string): Promise<number> {
  const rows = await deps.db.query<{ slot: number | null }>("select min(effective_slot)::int as slot from disruption_events where reservation_id = $1", [rid]);
  return rows[0]?.slot ?? 0;
}

async function hasEvent(q: Queryable, rid: string, type: string): Promise<boolean> {
  const rows = await q.query<{ id: string }>("select id from events where reservation_id = $1 and type = $2 limit 1", [rid, type]);
  return rows.length > 0;
}

async function hasSimulationRun(deps: AppDeps, rid: string): Promise<boolean> {
  const rows = await deps.db.query<{ id: string }>("select id from simulation_runs where reservation_id = $1", [rid]);
  return rows.length > 0;
}

/** A driver-requested early departure is never an operator failure, whatever else is recorded. */
async function hasDriverDepartureRequest(deps: AppDeps, rid: string): Promise<boolean> {
  const rows = await deps.db.query<{ id: string }>("select id from disruption_events where reservation_id = $1 and type = 'EARLY_DEPARTURE' limit 1", [rid]);
  return rows.length > 0;
}

/**
 * Records the operator flag once per reservation, with its basis and a stored resolution deadline. Serialized on the
 * reservation, so concurrent sweeps add one event. Flagging never moves money.
 */
async function flagOperatorResolution(deps: AppDeps, rid: string, basis: ResolutionBasis, deliveredMilliWh: number, nowMs: number): Promise<void> {
  await deps.db.tx(async (q) => {
    if (await hasEvent(q, rid, OPERATOR_RESOLUTION_REQUIRED)) return;
    await appendEvent(q, rid, OPERATOR_RESOLUTION_REQUIRED, "APP", {
      basis,
      deliveredBatteryMilliWh: deliveredMilliWh,
      resolveBy: new Date(nowMs + OPERATOR_RESOLUTION_WINDOW_MS).toISOString(),
      reason: "The outcome is not conclusive under the agreed policy, so no money moves automatically. An operator must decide.",
    });
  }, `outdated:${rid}`);
}

/** Once the stored resolution deadline has passed, marks the open flag overdue. Recorded once; never moves money. */
async function markOverdueIfDue(deps: AppDeps, rid: string): Promise<void> {
  const flags = await deps.db.query<{ payload: { resolveBy?: string } }>(
    "select payload from events where reservation_id = $1 and type = $2 order by id limit 1",
    [rid, OPERATOR_RESOLUTION_REQUIRED],
  );
  const resolveBy = flags[0]?.payload.resolveBy;
  if (!resolveBy || deps.now() < Date.parse(resolveBy)) return;
  await deps.db.tx(async (q) => {
    if (await hasEvent(q, rid, OPERATOR_RESOLUTION_OVERDUE)) return;
    await appendEvent(q, rid, OPERATOR_RESOLUTION_OVERDUE, "APP", { resolveBy });
  }, `outdated:${rid}`);
}

/**
 * Marks the service as failed and records the void decision and the modeled operator remedy cost, once. The void itself
 * is the existing keyed workflow, so a retry after a timeout replays the same provider request.
 */
async function decideVoid(deps: AppDeps, rid: string, deliveredMilliWh: number, policy: string): Promise<void> {
  await deps.db.tx(async (q) => {
    const changed = await q.query<{ id: string }>(
      "update reservations set service_state = 'FAILED', updated_at = now() where id = $1 and payment_state = 'AUTHORIZED' and service_state = 'SCHEDULED' returning id",
      [rid],
    );
    if (changed.length === 0) return;
    await appendEvent(q, rid, "SERVICE_FAILED", "APP", { reason: "PLAN_INFEASIBLE" });
    await appendEvent(q, rid, OUTDATED_VOID_DECIDED, "APP", { reason: "PLAN_INFEASIBLE", policy, deliveredBatteryMilliWh: deliveredMilliWh });
    await appendEvent(q, rid, FAILURE_REMEDY_COST_RECORDED, "APP", {
      remedyCostCents: deps.economics.failedServiceRemedyCents,
      basis: "MODELED",
      note: "Modeled operator cost of remedying a failed session. Not a customer fee and not real money.",
      deliveredBatteryMilliWh: deliveredMilliWh,
    });
  }, `outdated:${rid}`);
}

async function resolveDecided(deps: AppDeps, r: ReservationRow): Promise<OutdatedResolution> {
  const after = await voidAuthorization(deps, r.id, "PLAN_INFEASIBLE");
  return after.payment_state === "VOIDED" ? "VOIDED" : "VOID_PENDING";
}

/**
 * A provider-expired (or unconfirmed) authorization is reconciled against the provider and recorded. It is never voided,
 * captured or reauthorized here: unless the provider confirms a live authorization, the local state moves to reconciliation.
 */
async function reconcileExpiredAuthorization(deps: AppDeps, r: ReservationRow): Promise<OutdatedResolution> {
  const after = await reconcileReservation(deps, r.id, "RECONCILER");
  if (after.payment_state !== "AUTHORIZED") return "PROVIDER_EXPIRED";
  if (await transitionPayment(deps.db, r.id, "AUTHORIZED", "NEEDS_RECONCILIATION")) {
    await appendEvent(deps.db, r.id, AUTHORIZATION_EXPIRED_UNCONFIRMED, "APP", { reason: "Authorization expired and the provider did not confirm it live. No void, capture or reauthorization." });
  }
  return "PROVIDER_EXPIRED";
}

/**
 * An agreed session with no simulation evidence after its effective departure (plus grace) is ambiguous: it is flagged
 * for the operator and no money moves.
 */
async function unverifiedDeliveryDue(deps: AppDeps, r: ReservationRow, nowMs: number): Promise<boolean> {
  const { envelope } = await nightContext(deps.db, deps.station, r.night_of);
  const due = resolutionDue({ nowMs, effectiveDepartMs: effectiveDepartMs(envelope, r.id, r.terms.departMs), authorizationExpiresAtMs: null });
  if (!due) return false;
  await flagOperatorResolution(deps, r.id, "UNVERIFIED_DELIVERY", 0, nowMs);
  return true;
}

/** Decides an outdated, scheduled session under its agreement's policy. */
async function decideOutdated(deps: AppDeps, r: ReservationRow): Promise<OutdatedResolution> {
  const { ctx, session } = await planningFor(deps, r);
  const delivered = snapshotSession(ctx, session, await earliestEffectiveSlot(deps, r.id)).deliveredBatteryMilliWh;
  const run = (await latestRunsByReservation(deps.db, [r.id])).get(r.id);
  const nowMs = deps.now();
  const { envelope } = await nightContext(deps.db, deps.station, r.night_of);
  const authExpiresMs = r.authorization_expires_at ? r.authorization_expires_at.getTime() : null;
  const input: SettlementInput = {
    policy: settlementPolicyOf(r.terms),
    runStatus: run?.status ?? null,
    proposalExpired: run?.status === "NEEDS_APPROVAL" && run.expires_at !== null && nowMs >= run.expires_at.getTime(),
    attempts: run?.attempts ?? 0,
    maxAttempts: MAX_ATTEMPTS,
    authorizationNearExpiry: authorizationNearExpiry(nowMs, authExpiresMs),
    driverRequestedDeparture: await hasDriverDepartureRequest(deps, r.id),
    attribution: sessionAttribution((await reservationDisturbances(deps.db, r.id)).map((d) => d.attribution)),
    due: resolutionDue({ nowMs, effectiveDepartMs: effectiveDepartMs(envelope, r.id, r.terms.departMs), authorizationExpiresAtMs: authExpiresMs }),
    deliveredMilliWh: delivered,
  };
  const action = settlementAction(input);
  if (action === "WAIT") return "WAITING";
  if (action === "OPERATOR_RESOLUTION") {
    await flagOperatorResolution(deps, r.id, resolutionBasis(input), delivered, nowMs);
    return "OPERATOR_RESOLUTION";
  }
  await decideVoid(deps, r.id, delivered, input.policy);
  return resolveDecided(deps, (await getReservation(deps.db, r.id))!);
}

async function resolveSettlement(deps: AppDeps, rid: string): Promise<OutdatedResolution> {
  const r = await getReservation(deps.db, rid);
  if (!r || r.payment_state !== "AUTHORIZED") return "NOT_OUTDATED";
  // A void already decided for this session is finished or retried with the same key, never re-decided.
  if (r.service_state === "FAILED" && (await hasEvent(deps.db, rid, OUTDATED_VOID_DECIDED))) return resolveDecided(deps, r);
  // Settlement interrupted after the simulation (or capacity not yet committed): the existing recovery path finishes it.
  if (r.service_state !== "SCHEDULED" || (await hasSimulationRun(deps, rid))) {
    await recoverReservation(deps, rid, "RECONCILER");
    return "SETTLED";
  }
  if (!r.slots_committed) return "NOT_OUTDATED";
  const nowMs = deps.now();
  if (r.authorization_expires_at && nowMs >= r.authorization_expires_at.getTime()) return reconcileExpiredAuthorization(deps, r);
  if (!(await isOutdated(deps, r))) return (await unverifiedDeliveryDue(deps, r, nowMs)) ? "OPERATOR_RESOLUTION" : "NOT_OUTDATED";
  return decideOutdated(deps, r);
}

/** Resolves one reservation. Idempotent: a settled or not-outdated reservation is returned unchanged. */
export async function resolveOutdatedSession(deps: AppDeps, rid: string): Promise<OutdatedResolution> {
  const outcome = await resolveSettlement(deps, rid);
  const r = await getReservation(deps.db, rid);
  if (r?.payment_state === "AUTHORIZED") await markOverdueIfDue(deps, rid);
  return outcome;
}

/**
 * Reconciliation sweep selection. Authorized sessions are settled or escalated. Unresolved reservations with a stored
 * provider reference are reconciled, except expired authorizations, which stay with the expired-authorization path
 * (re-reconciling them would flip them back and forth). Least recently checked rows come first, so a persistent
 * backlog of unresolvable rows rotates instead of starving the rest. A locally FAILED or CANCELLED row with an order or
 * authorization id may carry a live provider authorization (orphan) until this app has voided it. That includes a row
 * whose authorization id was never stored (the authorize response was lost), so those rows stay in the rotation too.
 */
const SWEEP_SELECT = `select id from reservations
  where provider_mode = $3
    and (payment_state = 'AUTHORIZED'
     or (payment_state = 'NEEDS_RECONCILIATION'
         and (paypal_order_id is not null or paypal_authorization_id is not null or paypal_capture_id is not null)
         and (authorization_expires_at is null or authorization_expires_at > $2::timestamptz))
     or (payment_state in ('FAILED', 'CANCELLED') and paypal_capture_id is null
         and (paypal_authorization_id is not null
              or exists (select 1 from payment_operations o where o.reservation_id = reservations.id and o.kind = 'AUTHORIZE'))
         and not exists (select 1 from events e where e.reservation_id = reservations.id and e.type = 'ORPHAN_AUTHORIZATION_VOIDED')))
  order by sweep_checked_at asc nulls first, updated_at, id
  limit $1`;

export interface SweepResult {
  examined: number;
  failed: number;
}

/** Reconciles one unresolved reservation against the provider; commits capacity only where the boot path would. */
async function reconcileUnresolved(deps: AppDeps, rid: string): Promise<void> {
  const after = await reconcileReservation(deps, rid, "RECONCILER");
  if (after.payment_state === "AUTHORIZED" && !after.slots_committed && after.service_state === "AWAITING_PAYMENT") {
    await commitCapacityOrVoid(deps, rid);
  }
}

async function sweepOne(deps: AppDeps, rid: string): Promise<void> {
  const r = await getReservation(deps.db, rid);
  if (r?.payment_state === "NEEDS_RECONCILIATION") await reconcileUnresolved(deps, rid);
  else if (r?.payment_state === "FAILED" || r?.payment_state === "CANCELLED") await recoverReservation(deps, rid, "RECONCILER");
  else await resolveOutdatedSession(deps, rid);
}

/** One failing reservation never blocks the others; the check marker is recorded either way so it rotates. */
async function checkOne(deps: AppDeps, rid: string): Promise<boolean> {
  try {
    await sweepOne(deps, rid);
    return true;
  } catch (err) {
    console.warn("[gridwindow] outdated session resolution failed:", err instanceof Error ? err.name : "UNKNOWN");
    return false;
  } finally {
    await deps.db.query("update reservations set sweep_checked_at = clock_timestamp() where id = $1", [rid]).catch((err: unknown) => {
      console.warn("[gridwindow] sweep check marker failed:", err instanceof Error ? err.name : "UNKNOWN");
    });
  }
}

async function runSweep(deps: AppDeps, limit: number): Promise<SweepResult> {
  await expireAbandonedCheckouts(deps).catch((err: unknown) => console.warn("[gridwindow] checkout expiry sweep failed:", err instanceof Error ? err.name : "UNKNOWN"));
  const rows = await deps.db.query<{ id: string }>(SWEEP_SELECT, [limit, new Date(deps.now()).toISOString(), deps.gateway.mode]);
  let failed = 0;
  for (const { id } of rows) {
    if (!(await checkOne(deps, id))) failed += 1;
  }
  return { examined: rows.length, failed };
}

/** The in-flight sweep of this process. Overlapping triggers (interval, boot, tests) join it instead of re-running. */
let sweepInFlight: Promise<SweepResult> | null = null;

/**
 * Sweep: every authorized session is checked, and unresolved reservations are reconciled; only rows that need action
 * are acted on. Cross-instance safety relies on the state CAS and the settlement operation claims, not on this guard.
 */
export function resolveOutdatedSessions(deps: AppDeps, limit = 50): Promise<SweepResult> {
  if (!sweepInFlight) {
    sweepInFlight = runSweep(deps, limit).finally(() => {
      sweepInFlight = null;
    });
  }
  return sweepInFlight;
}
