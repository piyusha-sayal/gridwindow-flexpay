/**
 * Committed schedules as revisable state. The agreed terms (terms, terms_hash, amount) never change.
 * A disturbance is recorded append-only; a deterministic recovery may append a new schedule version
 * for this session only, after re-validating the whole station-night. Version 1 is the agreed plan.
 */
import { z } from "zod";
import { canonicalJson } from "@/domain/terms";
import { attributionFor, FAULT_ATTRIBUTIONS, isAllowedAttribution, type FaultAttribution } from "@/domain/faultAttribution";
import { buildEnvelope, DISTURBANCE_TYPES, effectiveDepartMs, validateDisturbance, violationsIntroducedBy, type DisturbanceRecord, type DisturbanceType, type NightEnvelope } from "@/domain/disturbance";
import type { AgreedSession } from "@/domain/recovery";
import type { QuoteSet } from "@/domain/quotes";
import type { StationConfig } from "@/domain/station";
import type { NightScenario } from "@/domain/scenario";
import { planOf, committedPlans, appendEvent, effectivePowerOf, getReservation, nightDisturbances, type ReservationRow } from "../repo";
import type { Queryable } from "../db/client";
import { ServiceError, type AppDeps } from "../deps";
import { scenarioFor } from "./quoteService";
import { onDisruptionRecorded } from "./recoveryHook";
import { orchestrateRecovery } from "./recoveryOrchestrator";
import { findRunRowById, toRunView, transitionRun, type RecoveryRunView } from "./recoveryRuns";

export type { RecoveryProposal, RecoveryRunView } from "./recoveryRuns";

export const PROPOSAL_TTL_MS = 30 * 60_000;

const paramSchemas: Record<DisturbanceType, z.ZodType<Record<string, number>>> = {
  CHARGER_POWER_REDUCTION: z.union([z.object({ maxPowerW: z.number().int().positive() }).strict(), z.object({ factorBp: z.number().int().min(1).max(9_999) }).strict()]),
  SITE_CAP_REDUCTION: z.object({ stationCapW: z.number().int().positive() }).strict(),
  EARLY_DEPARTURE: z.object({ departMs: z.number().int().positive() }).strict(),
  CHARGER_FAILURE: z.object({}).strict(),
};

export const disturbanceInputSchema = z
  .object({
    eventId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "eventId must be 8 to 64 letters, digits, '-' or '_'"),
    reservationId: z.string().min(1).max(64),
    type: z.enum(DISTURBANCE_TYPES),
    params: z.record(z.string(), z.unknown()),
    effectiveSlot: z.number().int().min(0).max(1_000),
    /** Optional. Absent means the documented default for the type (see domain/faultAttribution). */
    attribution: z.enum(FAULT_ATTRIBUTIONS).optional(),
  })
  .strict();

export interface DisturbanceEventView {
  eventId: string;
  reservationId: string;
  type: DisturbanceType;
  params: Record<string, number>;
  effectiveSlot: number;
  attribution: FaultAttribution;
  provenance: "SYNTHETIC";
  createdBy: string;
  createdAt: string;
}

export interface ScheduleCommit {
  version: number;
  source: "RECOVERY" | "MANUAL";
}

export interface DisruptionRow {
  event_id: string;
  reservation_id: string;
  type: DisturbanceType;
  params: Record<string, number>;
  effective_slot: number;
  created_by: string;
  created_at: Date;
  attribution: FaultAttribution;
}

/**
 * Attribution lives in the DISRUPTION_RECORDED event payload (no schema change). A disturbance with no recorded
 * attribution, including any recorded before attribution existed, reads as UNKNOWN: the safe, non-moving default.
 */
const DISRUPTION_SELECT = `select d.event_id, d.reservation_id, d.type, d.params, d.effective_slot, d.created_by, d.created_at,
  coalesce(e.payload->>'attribution', 'UNKNOWN') as attribution
  from disruption_events d
  left join events e on e.reservation_id = d.reservation_id and e.type = 'DISRUPTION_RECORDED' and e.payload->>'eventId' = d.event_id`;

/** Every disturbance recorded on a reservation, with its attribution, in recording order. */
export async function reservationDisturbances(q: Queryable, reservationId: string): Promise<DisruptionRow[]> {
  return q.query<DisruptionRow>(`${DISRUPTION_SELECT} where d.reservation_id = $1 order by d.created_at, d.event_id`, [reservationId]);
}

export function toDisturbanceView(row: DisruptionRow): DisturbanceEventView {
  return {
    eventId: row.event_id,
    reservationId: row.reservation_id,
    type: row.type,
    params: row.params,
    effectiveSlot: row.effective_slot,
    attribution: row.attribution,
    provenance: "SYNTHETIC",
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

/** Parses params for one disturbance type; unknown keys are refused. */
export function parseDisturbanceParams(type: DisturbanceType, raw: unknown): Record<string, number> {
  return paramSchemas[type].parse(raw);
}

/** A night's scenario and the disturbance envelope recorded on it, shared by every capacity check. */
export async function nightContext(q: Queryable, station: StationConfig, nightOf: string): Promise<{ scenario: NightScenario; envelope: NightEnvelope; records: DisturbanceRecord[] }> {
  const scenario = scenarioFor(station, nightOf);
  const { records } = await nightDisturbances(q, station.id, nightOf);
  return { scenario, envelope: buildEnvelope(station, scenario.grid, records), records };
}

/** Active = the agreed schedule holds capacity and nothing has been simulated or settled yet. */
export async function isActiveSession(q: Queryable, r: ReservationRow): Promise<boolean> {
  if (r.payment_state !== "AUTHORIZED" || r.service_state !== "SCHEDULED" || !r.slots_committed) return false;
  const runs = await q.query("select 1 from simulation_runs where reservation_id = $1", [r.id]);
  return runs.length === 0;
}

export async function currentVersion(q: Queryable, reservationId: string): Promise<number> {
  const rows = await q.query<{ v: number }>("select coalesce(max(version), 1)::int as v from schedule_versions where reservation_id = $1", [reservationId]);
  return rows[0]!.v;
}

export async function findEvent(q: Queryable, eventId: string): Promise<DisruptionRow | null> {
  const rows = await q.query<DisruptionRow>(`${DISRUPTION_SELECT} where d.event_id = $1`, [eventId]);
  return rows[0] ?? null;
}

/**
 * Records a disturbance. Idempotent by eventId: an identical repeat returns the stored row; a different
 * payload reusing the id is refused. Autonomous recovery starts after the write (see recoveryHook); nothing is recomputed here.
 */
export async function recordDisruption(deps: AppDeps, raw: unknown, createdBy = "OPERATOR"): Promise<{ event: DisturbanceEventView; created: boolean }> {
  const input = disturbanceInputSchema.parse(raw);
  const params = parseDisturbanceParams(input.type, input.params);
  const attribution = attributionFor(input.type, input.attribution);
  if (!isAllowedAttribution(input.type, attribution)) throw new ServiceError("INVALID_ATTRIBUTION", `${attribution} is not a valid attribution for ${input.type}.`, 400);
  const sameAs = (row: DisruptionRow) =>
    row.reservation_id === input.reservationId &&
    row.type === input.type &&
    row.effective_slot === input.effectiveSlot &&
    row.attribution === attribution &&
    canonicalJson(row.params) === canonicalJson(params);

  const existing = await findEvent(deps.db, input.eventId);
  if (existing) {
    if (!sameAs(existing)) throw new ServiceError("EVENT_ID_REUSED", "This event id was already used for a different disturbance.", 409);
    return { event: toDisturbanceView(existing), created: false };
  }
  const r = await getReservation(deps.db, input.reservationId);
  if (!r) throw new ServiceError("NOT_FOUND", "Reservation not found.", 404);
  if (!(await isActiveSession(deps.db, r))) throw new ServiceError("NOT_ACTIVE", "Disturbances apply only to an authorized, scheduled session.", 409);
  const { scenario } = await nightContext(deps.db, deps.station, r.night_of);
  const problem = validateDisturbance(deps.station, scenario.grid, { plugInMs: r.terms.plugInMs, departMs: r.terms.departMs }, {
    reservationId: r.id,
    portId: r.port_id,
    type: input.type,
    effectiveSlot: input.effectiveSlot,
    params,
  });
  if (problem) throw new ServiceError("INVALID_DISTURBANCE", problem, 400);

  const inserted = await deps.db.query<Omit<DisruptionRow, "attribution">>(
    `insert into disruption_events (id, event_id, reservation_id, type, params, effective_slot, created_by)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict (event_id) do nothing
     returning event_id, reservation_id, type, params, effective_slot, created_by, created_at`,
    [deps.newId("dis"), input.eventId, r.id, input.type, JSON.stringify(params), input.effectiveSlot, createdBy],
  ).then((rows) => rows.map((row) => ({ ...row, attribution })));
  if (inserted.length === 0) {
    const raced = (await findEvent(deps.db, input.eventId))!;
    if (!sameAs(raced)) throw new ServiceError("EVENT_ID_REUSED", "This event id was already used for a different disturbance.", 409);
    return { event: toDisturbanceView(raced), created: false };
  }
  await appendEvent(deps.db, r.id, "DISRUPTION_RECORDED", "OPERATOR", { eventId: input.eventId, type: input.type, effectiveSlot: input.effectiveSlot, attribution });
  const event = toDisturbanceView(inserted[0]!);
  try {
    await onDisruptionRecorded(deps, event);
  } catch (err) {
    // The recording succeeded; the orchestrator hook must never turn it into a failed request.
    console.warn("[gridwindow] disruption hook failed:", err instanceof Error ? err.name : "UNKNOWN");
  }
  return { event, created: true };
}

/** Identity of a worker's hold on a recovery run: its attempt number and the lease it last wrote. */
export interface RunFence {
  attempt: number;
  lease: Date;
}

const LEASE_LOST_MESSAGE = "This recovery was taken over by another worker. Nothing was changed.";

/**
 * Inside the commit transaction: the run must still be RUNNING for this attempt, under a lease that has not expired.
 * A worker that lost its lease (taken over, or simply expired) can no longer write a version.
 */
async function assertFenceHeld(q: Queryable, runId: string, fence: RunFence, nowMs: number): Promise<void> {
  const rows = await q.query<{ id: string }>(
    `select id from recovery_runs where id = $1 and status = 'RUNNING' and attempts = $2
       and lease_until = $3::timestamptz and lease_until > $4::timestamptz`,
    [runId, fence.attempt, fence.lease.toISOString(), new Date(nowMs).toISOString()],
  );
  if (rows.length !== 1) throw new ServiceError("LEASE_LOST", LEASE_LOST_MESSAGE, 409);
}

/**
 * Commits a schedule version for one session. Serialized per station-night. The expected version must be
 * current, energy before fromSlot must be unchanged, and the whole night (with the disturbance envelope)
 * must validate. A unique-key collision on the version row is also reported as VERSION_CONFLICT.
 * Orchestrator commits pass `fence`, checked inside the same transaction; manual commits pass none.
 */
export async function commitScheduleVersion(
  deps: AppDeps,
  reservationId: string,
  expectedVersion: number,
  newPlan: readonly number[],
  reason: string,
  runId: string | null,
  fromSlot: number,
  fence?: RunFence,
): Promise<ScheduleCommit> {
  const head = await getReservation(deps.db, reservationId);
  if (!head) throw new ServiceError("NOT_FOUND", "Reservation not found.", 404);
  const source = runId ? "RECOVERY" : "MANUAL";
  try {
    return await deps.db.tx(async (q) => {
      const r = (await getReservation(q, reservationId))!;
      if (fence) {
        if (!runId) throw new ServiceError("LEASE_LOST", LEASE_LOST_MESSAGE, 409);
        await assertFenceHeld(q, runId, fence, deps.now());
      }
      if (!(await isActiveSession(q, r))) throw new ServiceError("NOT_ACTIVE", "This schedule can no longer be changed.", 409);
      const { scenario, envelope } = await nightContext(q, deps.station, r.night_of);
      const version = await currentVersion(q, r.id);
      if (version !== expectedVersion) throw new ServiceError("VERSION_CONFLICT", "The schedule changed while this proposal was pending. Please request a new recovery.", 409);
      const current = await effectivePowerOf(q, r);
      if (!sameSlots(current, newPlan, fromSlot)) throw new ServiceError("PAST_ENERGY_CHANGED", "Energy already scheduled before the effective slot cannot change.", 409);

      const others = await committedPlans(q, deps.station.id, r.night_of, r.id);
      const own = { ...planOf(r, newPlan), departMs: effectiveDepartMs(envelope, r.id, r.terms.departMs) };
      // Same rule as candidate validation: re-checked here under the night lock, counting only what this plan causes.
      const violations = violationsIntroducedBy({
        station: deps.station,
        grid: scenario.grid,
        forecastBaseLoadW: scenario.forecastBaseLoadW,
        envelope,
        committed: others,
        candidate: own,
        targets: [{ sessionId: r.id, targetBatteryWh: r.terms.targetBatteryWh, efficiencyBp: r.terms.efficiencyBp }],
      });
      if (violations.length > 0) {
        const codes = [...new Set(violations.map((v) => v.code))].join(", ");
        throw new ServiceError("PLAN_INVALID", `The proposed schedule breaks station limits (${codes}).`, 409);
      }

      const next = version + 1;
      await q.query(
        "insert into schedule_versions (reservation_id, version, source, power_w, reason, recovery_run_id) values ($1, $2, $3, $4, $5, $6)",
        [r.id, next, source, JSON.stringify(newPlan), reason, runId],
      );
      if (runId) {
        const closed = await q.query<{ id: string }>(
          "update recovery_runs set status = 'COMMITTED', updated_at = now() where id = $1 and status in ('RUNNING', 'APPROVED') returning id",
          [runId],
        );
        if (closed.length !== 1) throw new ServiceError("RUN_NOT_OPEN", "This recovery is no longer open.", 409);
      }
      await appendEvent(q, r.id, "SCHEDULE_VERSION_COMMITTED", "APP", { version: next, source, runId });
      return { version: next, source };
    }, `${deps.station.id}:${head.night_of}`);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new ServiceError("VERSION_CONFLICT", "The schedule changed while this proposal was pending. Please request a new recovery.", 409);
    }
    throw err;
  }
}

function sameSlots(a: readonly number[], b: readonly number[], fromSlot: number): boolean {
  for (let i = 0; i < Math.min(fromSlot, a.length); i++) if (a[i] !== b[i]) return false;
  return true;
}

export function agreedSession(r: ReservationRow, quote: QuoteSet, currentPowerW: readonly number[]): AgreedSession {
  return {
    reservationId: r.id,
    portId: r.port_id,
    plugInMs: r.terms.plugInMs,
    agreedDepartMs: r.terms.departMs,
    targetBatteryWh: r.terms.targetBatteryWh,
    efficiencyBp: r.terms.efficiencyBp,
    amountCents: r.amount_cents,
    listPriceCents: r.terms.listPriceCents,
    baselineEnergyCostCents: quote.baseline.energyCostCents ?? 0,
    agreedPowerW: r.terms.powerW,
    currentPowerW,
  };
}

/**
 * Recovery for one recorded disturbance. The orchestrator owns the run lifecycle: one run per event, lease-fenced
 * steps, a bounded model loop with a deterministic fallback, and validated decisions only.
 */
export function runRecovery(deps: AppDeps, eventId: string): Promise<RecoveryRunView> {
  return orchestrateRecovery(deps, eventId);
}

/** Loads a NEEDS_APPROVAL run owned by the driver session, with its reservation and disturbance. */
async function pendingRunFor(deps: AppDeps, runId: string, driverSession: string) {
  const run = await findRunRowById(deps.db, runId);
  if (!run) throw new ServiceError("NOT_FOUND", "Recovery not found.", 404);
  const event = (await findEvent(deps.db, run.disruption_event_id))!;
  const r = await getReservation(deps.db, event.reservation_id);
  if (!r || r.driver_session !== driverSession) throw new ServiceError("NOT_FOUND", "Recovery not found.", 404);
  if (run.status !== "NEEDS_APPROVAL" || !run.proposal) throw new ServiceError("NOT_PENDING", "This proposal is no longer awaiting approval.", 409);
  return { run, event, r };
}

/** Driver approves the exact proposal version. Expired proposals are closed, never applied. */
export async function approveRecoveryRun(deps: AppDeps, runId: string, driverSession: string): Promise<RecoveryRunView> {
  const { run, event, r } = await pendingRunFor(deps, runId, driverSession);
  if (run.expires_at && deps.now() >= run.expires_at.getTime()) {
    await transitionRun(deps.db, runId, "NEEDS_APPROVAL", "EXPIRED", null);
    throw new ServiceError("PROPOSAL_EXPIRED", "This proposal has expired. Please request a new recovery.", 409);
  }
  // A disturbance recorded after this proposal's event makes the proposal stale: close it, never apply it.
  const superseded = await deps.db.query<{ id: string }>(
    "select d.id from disruption_events d where d.reservation_id = $1 and d.created_at > (select created_at from disruption_events where event_id = $2) limit 1",
    [r.id, event.event_id],
  );
  if (superseded.length > 0) {
    await transitionRun(deps.db, runId, "NEEDS_APPROVAL", "EXPIRED", null);
    throw new ServiceError("STALE_PROPOSAL", "A newer disturbance changed this schedule after this proposal was made. Please request a new recovery.", 409);
  }
  if (!(await transitionRun(deps.db, runId, "NEEDS_APPROVAL", "APPROVED", null))) {
    throw new ServiceError("NOT_PENDING", "This proposal is no longer awaiting approval.", 409);
  }
  try {
    await commitScheduleVersion(deps, r.id, run.proposal_version!, run.proposal!.powerW, `Driver-approved recovery for ${event.type}`, runId, event.effective_slot);
  } catch (err) {
    await transitionRun(deps.db, runId, "APPROVED", "FAILED", null);
    throw err;
  }
  return toRunView((await findRunRowById(deps.db, runId))!, event.event_id, deps.now());
}

/** Driver declines a pending proposal. No schedule changes. */
export async function rejectRecoveryRun(deps: AppDeps, runId: string, driverSession: string): Promise<RecoveryRunView> {
  const { event } = await pendingRunFor(deps, runId, driverSession);
  await transitionRun(deps.db, runId, "NEEDS_APPROVAL", "REJECTED", null);
  return toRunView((await findRunRowById(deps.db, runId))!, event.event_id, deps.now());
}
