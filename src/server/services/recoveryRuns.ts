/**
 * Persistence and read model for recovery runs. Every status change and trace append is a compare-and-set on
 * the run's lease token, so a worker that lost its lease can no longer write.
 */
import type { OfferKind } from "@/domain/quotes";
import { ServiceError, type AppDeps } from "../deps";
import type { Queryable } from "../db/client";
import { getReservation } from "../repo";

export type RunStatus = "RUNNING" | "COMMITTED" | "NEEDS_APPROVAL" | "INFEASIBLE" | "FAILED" | "APPROVED" | "REJECTED" | "EXPIRED";

export interface RunTraceEntry {
  seq: number;
  at: string;
  /** Tool name, or "orchestrator" for lifecycle steps. */
  tool: string;
  actor: "GEMINI" | "DETERMINISTIC";
  /** Sanitized input as the model or orchestrator sent it. */
  input: unknown;
  outcome: "OK" | "REJECTED" | "FAILED" | "INFO";
  detail: string;
}

export interface RecoveryProposal {
  preference: OfferKind;
  powerW: number[];
  energyCostCents: number;
  operatorImprovementCents: number;
  priceCents: number;
  reasons: string[];
}

export interface CandidateRecord {
  id: string | null;
  preference: OfferKind;
  status: "PROPOSED" | "REJECTED";
  consent: "AUTO_COMMIT" | "NEEDS_DRIVER_APPROVAL" | "NOT_ALLOWED" | null;
  /** Plain-English reason when the candidate was rejected or needs approval. */
  reason: string | null;
  chosen: boolean;
  priceCents: number | null;
  energyCostCents: number | null;
  finishAt: string | null;
}

export interface RecoveryOutcome {
  kind: "COMMITTED" | "NEEDS_APPROVAL" | "INFEASIBLE" | "FAILED";
  /** Plain-English result, computed by the backend. */
  reason: string;
  effectiveSlot: number;
  effectiveAt: string;
  candidates: CandidateRecord[];
  /** Schedule version written by this run, when one was committed. */
  versionCommitted: number | null;
}

export interface RecoveryRunView {
  runId: string;
  eventId: string;
  status: RunStatus;
  trace: RunTraceEntry[];
  proposal: RecoveryProposal | null;
  proposalVersion: number | null;
  expiresAt: string | null;
  aiUsed: boolean;
  explanation: { text: string; source: "MODEL" | "DETERMINISTIC" } | null;
  outcome: RecoveryOutcome | null;
}

export interface RunRow {
  id: string;
  disruption_event_id: string;
  status: RunStatus;
  trace: RunTraceEntry[];
  proposal: RecoveryProposal | null;
  proposal_version: number | null;
  expires_at: Date | null;
  lease_until: Date | null;
  attempts: number;
  ai_used: boolean;
  outcome: RecoveryOutcome | null;
  explanation: RecoveryRunView["explanation"];
}

export interface RunPatch {
  proposal?: RecoveryProposal;
  proposalVersion?: number;
  expiresAt?: Date;
  outcome?: RecoveryOutcome;
  explanation?: NonNullable<RecoveryRunView["explanation"]>;
  aiUsed?: boolean;
  appendTrace?: RunTraceEntry[];
}

const RUN_COLUMNS = "id, disruption_event_id, status, trace, proposal, proposal_version, expires_at, lease_until, attempts, ai_used, outcome, explanation";

export async function findRunRow(q: Queryable, eventId: string): Promise<RunRow | null> {
  const rows = await q.query<RunRow>(`select ${RUN_COLUMNS} from recovery_runs where disruption_event_id = $1`, [eventId]);
  return rows[0] ?? null;
}

export async function findRunRowById(q: Queryable, runId: string): Promise<RunRow | null> {
  const rows = await q.query<RunRow>(`select ${RUN_COLUMNS} from recovery_runs where id = $1`, [runId]);
  return rows[0] ?? null;
}

/** A NEEDS_APPROVAL proposal past its expiry reads as EXPIRED even before the sweep records it. */
export function toRunView(row: RunRow, eventId: string, nowMs: number): RecoveryRunView {
  const expired = row.status === "NEEDS_APPROVAL" && row.expires_at !== null && nowMs >= row.expires_at.getTime();
  return {
    runId: row.id,
    eventId,
    status: expired ? "EXPIRED" : row.status,
    trace: row.trace,
    proposal: row.proposal,
    proposalVersion: row.proposal_version,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    aiUsed: row.ai_used,
    explanation: row.explanation,
    outcome: row.outcome,
  };
}

/** Compare-and-set status change. `lease` must match the stored lease (null for runs not held by a worker). */
export async function transitionRun(q: Queryable, runId: string, from: RunStatus, to: RunStatus, lease: Date | null, patch: RunPatch = {}): Promise<boolean> {
  const rows = await q.query<{ id: string }>(
    `update recovery_runs set status = $3, lease_until = null, updated_at = now(),
       proposal = coalesce($4::jsonb, proposal), proposal_version = coalesce($5::integer, proposal_version),
       expires_at = coalesce($6::timestamptz, expires_at), outcome = coalesce($7::jsonb, outcome),
       explanation = coalesce($8::jsonb, explanation), ai_used = coalesce($9::boolean, ai_used),
       trace = trace || coalesce($11::jsonb, '[]'::jsonb)
     where id = $1 and status = $2 and lease_until is not distinct from $10::timestamptz returning id`,
    [
      runId,
      from,
      to,
      patch.proposal ? JSON.stringify(patch.proposal) : null,
      patch.proposalVersion ?? null,
      patch.expiresAt ? patch.expiresAt.toISOString() : null,
      patch.outcome ? JSON.stringify(patch.outcome) : null,
      patch.explanation ? JSON.stringify(patch.explanation) : null,
      patch.aiUsed ?? null,
      lease ? lease.toISOString() : null,
      patch.appendTrace ? JSON.stringify(patch.appendTrace) : null,
    ],
  );
  return rows.length === 1;
}

/** Fenced trace append that also renews the lease. Returns false if the worker no longer holds the lease. */
export async function appendTraceFenced(q: Queryable, runId: string, lease: Date, entries: RunTraceEntry[], nextLease: Date): Promise<boolean> {
  const rows = await q.query<{ id: string }>(
    `update recovery_runs set trace = trace || $3::jsonb, lease_until = $4::timestamptz, updated_at = now()
     where id = $1 and status = 'RUNNING' and lease_until = $2::timestamptz returning id`,
    [runId, lease.toISOString(), JSON.stringify(entries), nextLease.toISOString()],
  );
  return rows.length === 1;
}

/** Trace append once the run is terminal. Safe without a lease: no worker can take over a finished run. */
export async function appendTraceUnfenced(q: Queryable, runId: string, entries: RunTraceEntry[]): Promise<void> {
  await q.query("update recovery_runs set trace = trace || $2::jsonb, updated_at = now() where id = $1", [runId, JSON.stringify(entries)]);
}

/** Fenced save of the decision record before an irreversible step. */
export async function saveOutcomeFenced(q: Queryable, runId: string, lease: Date, outcome: RecoveryOutcome): Promise<boolean> {
  const rows = await q.query<{ id: string }>(
    "update recovery_runs set outcome = $3::jsonb, updated_at = now() where id = $1 and status = 'RUNNING' and lease_until = $2::timestamptz returning id",
    [runId, lease.toISOString(), JSON.stringify(outcome)],
  );
  return rows.length === 1;
}

/** Unfenced update of narrative fields once the status is final. Never changes status. */
export async function patchRun(q: Queryable, runId: string, patch: RunPatch): Promise<void> {
  await q.query(
    `update recovery_runs set outcome = coalesce($2::jsonb, outcome), explanation = coalesce($3::jsonb, explanation),
       ai_used = coalesce($4::boolean, ai_used), updated_at = now() where id = $1`,
    [runId, patch.outcome ? JSON.stringify(patch.outcome) : null, patch.explanation ? JSON.stringify(patch.explanation) : null, patch.aiUsed ?? null],
  );
}

/**
 * Driver or operator read of one run. A driver outside the reservation gets NOT_FOUND, so run ids cannot be probed.
 */
export async function getRecoveryRunView(deps: AppDeps, runId: string, viewer: { driverSession: string } | { operator: true }): Promise<RecoveryRunView> {
  const row = await findRunRowById(deps.db, runId);
  if (!row) throw new ServiceError("NOT_FOUND", "Recovery not found.", 404);
  const rows = await deps.db.query<{ reservation_id: string }>("select reservation_id from disruption_events where event_id = $1", [row.disruption_event_id]);
  const r = rows[0] ? await getReservation(deps.db, rows[0].reservation_id) : null;
  if (!r || ("driverSession" in viewer && r.driver_session !== viewer.driverSession)) throw new ServiceError("NOT_FOUND", "Recovery not found.", 404);
  return toRunView(row, row.disruption_event_id, deps.now());
}
