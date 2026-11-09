/**
 * Receipt data for autonomous recovery. Additive to the reservation view: it never changes payment fields, and it
 * states that disturbance evidence is simulated and separate from PayPal Sandbox evidence.
 */
import type { DisturbanceType } from "@/domain/disturbance";
import { energyShortfallMilliWh } from "@/domain/deliveredEnergy";
import type { FaultAttribution } from "@/domain/faultAttribution";
import { slotStartMs } from "@/domain/time";
import { batteryMilliWhFromGridWh, SLOTS_PER_HOUR } from "@/domain/units";
import type { AppDeps } from "../deps";
import type { ReservationRow } from "../repo";
import type { CandidateRecord, RecoveryOutcome, RunStatus } from "./recoveryRuns";
import { nightContext, reservationDisturbances } from "./scheduleService";

export const RECOVERY_EVIDENCE_STATEMENT =
  "Disturbances are synthetic inputs recorded by the operator and simulated by the station model. This evidence is separate from PayPal Sandbox payment evidence, which is listed in the payment proofs.";

export interface RecoveryReceiptDisturbance {
  eventId: string;
  type: DisturbanceType;
  effectiveAtMs: number;
  attribution: FaultAttribution;
  provenance: "SYNTHETIC";
  runStatus: RunStatus | null;
}

/**
 * Energy against the agreed battery target. `forecast` is the planned figure of the current plan (never proof of
 * delivery). `actual` and `shortfall` come from the synthetic ledger and are null until a run exists.
 */
export interface RecoveryReceiptEnergy {
  targetBatteryWh: number;
  forecastBatteryWh: number;
  actualBatteryMilliWh: number | null;
  shortfallBatteryMilliWh: number | null;
  provenance: "SYNTHETIC";
}

export interface RecoveryReceiptRun {
  runId: string;
  eventId: string;
  status: RunStatus;
  aiUsed: boolean;
  reason: string;
  candidates: CandidateRecord[];
  /** AUTO_WITHIN_PRE_APPROVED_BOUNDS, or the driver-approved version; null when no version was written. */
  consent: { method: "AUTO_WITHIN_PRE_APPROVED_BOUNDS" } | { method: "DRIVER_APPROVED"; version: number } | null;
}

export interface RecoveryReceiptVersion {
  version: number;
  source: "AGREED" | "RECOVERY" | "MANUAL";
  reason: string;
  /** Slot from which this plan applies; null when not recorded (manual versions). */
  effectiveFromMs: number | null;
  plannedBatteryWh: number;
  /** Battery energy the simulation delivered while this plan was effective; null when not simulated. */
  deliveredBatteryMilliWh: number | null;
}

export interface RecoveryReceipt {
  aiUsed: boolean;
  originalSchedule: { plugInMs: number; departMs: number; targetBatteryWh: number; chargingSlots: number; peakPowerW: number };
  disturbances: RecoveryReceiptDisturbance[];
  runs: RecoveryReceiptRun[];
  versions: RecoveryReceiptVersion[];
  energy: RecoveryReceiptEnergy;
  evidenceStatement: string;
}

interface VersionRow {
  version: number;
  source: "RECOVERY" | "MANUAL";
  reason: string;
  power_w: number[];
  recovery_run_id: string | null;
  effective_slot: number | null;
}

interface RunRowLite {
  id: string;
  disruption_event_id: string;
  status: RunStatus;
  ai_used: boolean;
  outcome: RecoveryOutcome | null;
  proposal: unknown;
}

function plannedBatteryWh(powerW: readonly number[], efficiencyBp: number): number {
  const gridWh = powerW.reduce((sum, w) => sum + w / SLOTS_PER_HOUR, 0);
  return Math.round(batteryMilliWhFromGridWh(gridWh, efficiencyBp) / 1000);
}

/** Forecast of the agreed plan against the ledger's delivered energy; the shortfall is the agreed target minus actual. */
export function energyView(targetBatteryWh: number, forecastBatteryWh: number, deliveredBatteryMilliWh: number | null): RecoveryReceiptEnergy {
  return {
    targetBatteryWh,
    forecastBatteryWh,
    actualBatteryMilliWh: deliveredBatteryMilliWh,
    shortfallBatteryMilliWh: deliveredBatteryMilliWh === null ? null : energyShortfallMilliWh(targetBatteryWh, deliveredBatteryMilliWh),
    provenance: "SYNTHETIC",
  };
}

/** Null when the reservation has no recorded disturbance. */
export async function buildRecoveryReceipt(deps: AppDeps, r: ReservationRow): Promise<RecoveryReceipt | null> {
  const disturbances = await deps.db.query<{ event_id: string; type: DisturbanceType; effective_slot: number; status: RunStatus | null }>(
    `select d.event_id, d.type, d.effective_slot, rr.status from disruption_events d
     left join recovery_runs rr on rr.disruption_event_id = d.event_id where d.reservation_id = $1 order by d.created_at, d.event_id`,
    [r.id],
  );
  if (disturbances.length === 0) return null;
  const { scenario } = await nightContext(deps.db, deps.station, r.night_of);
  const grid = scenario.grid;

  const runs = await deps.db.query<RunRowLite>(
    `select rr.id, rr.disruption_event_id, rr.status, rr.ai_used, rr.outcome, rr.proposal from recovery_runs rr
     join disruption_events d on d.event_id = rr.disruption_event_id where d.reservation_id = $1 order by rr.created_at, rr.id`,
    [r.id],
  );
  const versions = await deps.db.query<VersionRow>(
    `select v.version, v.source, v.reason, v.power_w, v.recovery_run_id, d.effective_slot from schedule_versions v
     left join recovery_runs rr on rr.id = v.recovery_run_id left join disruption_events d on d.event_id = rr.disruption_event_id
     where v.reservation_id = $1 order by v.version`,
    [r.id],
  );
  const energy = await deps.db.query<{ slot_index: number; battery_mwh: number }>("select slot_index, battery_mwh from energy_records where reservation_id = $1", [r.id]);
  const hasSimulation = energy.length > 0;
  const ledger = await deps.db.query<{ delivered_battery_mwh: number }>("select delivered_battery_mwh from simulation_runs where reservation_id = $1", [r.id]);
  const attributions = new Map((await reservationDisturbances(deps.db, r.id)).map((d) => [d.event_id, d.attribution]));

  const plans = [
    { version: 1, source: "AGREED" as const, reason: "Accepted terms", powerW: r.terms.powerW, fromSlot: 0 as number | null },
    ...versions.map((v) => ({ version: v.version, source: v.source, reason: v.reason, powerW: v.power_w, fromSlot: v.effective_slot })),
  ];
  const versionViews: RecoveryReceiptVersion[] = plans.map((plan, i) => {
    const next = plans.slice(i + 1).find((p) => p.fromSlot !== null);
    const from = plan.fromSlot;
    const to = next?.fromSlot ?? grid.slotCount;
    const deliveredMwh =
      hasSimulation && from !== null ? energy.filter((e) => e.slot_index >= from && e.slot_index < to).reduce((sum, e) => sum + e.battery_mwh, 0) : null;
    return {
      version: plan.version,
      source: plan.source,
      reason: plan.reason,
      effectiveFromMs: from === null ? null : slotStartMs(grid, from),
      plannedBatteryWh: plannedBatteryWh(plan.powerW, r.terms.efficiencyBp),
      deliveredBatteryMilliWh: deliveredMwh,
    };
  });

  const runViews: RecoveryReceiptRun[] = runs.map((run) => {
    const eventId = run.disruption_event_id;
    const version = versions.find((v) => v.recovery_run_id === run.id);
    const consent = version ? (run.proposal ? { method: "DRIVER_APPROVED" as const, version: version.version } : { method: "AUTO_WITHIN_PRE_APPROVED_BOUNDS" as const }) : null;
    return {
      runId: run.id,
      eventId,
      status: run.status,
      aiUsed: run.ai_used,
      reason: run.outcome?.reason ?? "",
      candidates: run.outcome?.candidates ?? [],
      consent,
    };
  });

  const own = r.terms.powerW;
  return {
    aiUsed: runViews.some((run) => run.aiUsed),
    originalSchedule: {
      plugInMs: r.terms.plugInMs,
      departMs: r.terms.departMs,
      targetBatteryWh: r.terms.targetBatteryWh,
      chargingSlots: own.filter((w) => w > 0).length,
      peakPowerW: Math.max(0, ...own),
    },
    disturbances: disturbances.map((d) => ({
      eventId: d.event_id,
      type: d.type,
      effectiveAtMs: slotStartMs(grid, d.effective_slot),
      attribution: attributions.get(d.event_id) ?? "UNKNOWN",
      provenance: "SYNTHETIC",
      runStatus: d.status,
    })),
    runs: runViews,
    versions: versionViews,
    energy: energyView(r.terms.targetBatteryWh, versionViews[versionViews.length - 1]!.plannedBatteryWh, ledger[0]?.delivered_battery_mwh ?? null),
    evidenceStatement: RECOVERY_EVIDENCE_STATEMENT,
  };
}
