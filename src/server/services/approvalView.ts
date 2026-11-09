/**
 * Read model for a recovery proposal awaiting the driver's decision: the original plan versus the proposed one,
 * finish times, the unchanged price and the proposal's expiry. Read-only; decisions live in scheduleService.
 */
import { chargeEndMs } from "@/domain/disturbance";
import type { OfferKind } from "@/domain/quotes";
import type { AppDeps } from "../deps";
import type { Queryable } from "../db/client";
import type { ReservationRow } from "../repo";
import type { RecoveryProposal, RunStatus } from "./recoveryRuns";
import { scenarioFor } from "./quoteService";

export interface PendingApprovalView {
  runId: string;
  proposalVersion: number;
  expiresAt: string;
  /** Always the agreed amount: a recovery proposal can never change the price. */
  priceCents: number;
  original: { powerW: number[]; finishMs: number | null };
  proposed: { preference: OfferKind; powerW: number[]; finishMs: number | null; reasons: string[] };
}

export interface LatestRunView {
  runId: string;
  status: RunStatus;
}

export interface RunRowLite {
  reservation_id: string;
  id: string;
  status: RunStatus;
  proposal: RecoveryProposal | null;
  proposal_version: number | null;
  expires_at: Date | null;
  attempts: number;
}

/** The most recent run per reservation, for the given reservations. */
export async function latestRunsByReservation(q: Queryable, reservationIds: readonly string[]): Promise<Map<string, RunRowLite>> {
  const rows = await q.query<RunRowLite>(
    `select d.reservation_id, rr.id, rr.status, rr.proposal, rr.proposal_version, rr.expires_at, rr.attempts
     from recovery_runs rr join disruption_events d on d.event_id = rr.disruption_event_id
     where d.reservation_id = any($1::text[]) order by rr.created_at, rr.id`,
    [reservationIds as string[]],
  );
  return new Map(rows.map((row) => [row.reservation_id, row]));
}

/** Null unless the run is still awaiting a decision and has not expired. */
export function pendingApprovalView(deps: AppDeps, r: Pick<ReservationRow, "amount_cents" | "night_of">, currentPowerW: readonly number[], run: RunRowLite | undefined): PendingApprovalView | null {
  if (!run || run.status !== "NEEDS_APPROVAL" || !run.proposal || !run.expires_at) return null;
  if (deps.now() >= run.expires_at.getTime()) return null;
  const grid = scenarioFor(deps.station, r.night_of).grid;
  const proposed = run.proposal;
  return {
    runId: run.id,
    proposalVersion: run.proposal_version ?? 1,
    expiresAt: run.expires_at.toISOString(),
    priceCents: r.amount_cents,
    original: { powerW: [...currentPowerW], finishMs: chargeEndMs(grid, currentPowerW) },
    proposed: {
      preference: proposed.preference,
      powerW: [...proposed.powerW],
      finishMs: chargeEndMs(grid, proposed.powerW),
      reasons: [...proposed.reasons],
    },
  };
}
