/** Read model for committed schedules and recorded disturbances. Provider references and buyer identity are never included. */
import { SLOT_MS } from "@/domain/units";
import { effectiveDepartMs, type DisturbanceType } from "@/domain/disturbance";
import type { FaultAttribution } from "@/domain/faultAttribution";
import type { PaymentState, ServiceState } from "@/domain/paymentState";
import type { AppDeps } from "../deps";
import type { Queryable } from "../db/client";
import { nightContext } from "./scheduleService";
import { latestRunsByReservation, pendingApprovalView, type LatestRunView, type PendingApprovalView } from "./approvalView";
import type { RecoveryOutcome } from "./recoveryRuns";

export interface ScheduleVersionView {
  version: number;
  /** AGREED is the implicit version 1 (the accepted terms). */
  source: "AGREED" | "RECOVERY" | "MANUAL";
  createdAt: string;
  reason: string;
  powerW: number[];
}

export interface ScheduleSessionView {
  reservationId: string;
  portId: string;
  portLabel: string;
  plugInMs: number;
  /** Agreed departure from the immutable terms. */
  departMs: number;
  /** Departure after any recorded early departure (equal to departMs when none). */
  effectiveDepartMs: number;
  paymentState: PaymentState;
  serviceState: ServiceState;
  currentVersion: number;
  versions: ScheduleVersionView[];
  originalPowerW: number[];
  /** Additive: the most recent recovery run for this session, or null when none has run. */
  latestRun: LatestRunView | null;
  /** Additive: the proposal awaiting the driver's decision, or null. */
  pendingApproval: PendingApprovalView | null;
}

export interface ScheduleDisruptionView {
  eventId: string;
  reservationId: string;
  type: DisturbanceType;
  params: Record<string, number>;
  effectiveSlot: number;
  /** Recorded fault attribution; UNKNOWN when none was recorded. */
  attribution: FaultAttribution;
  createdAt: string;
  /** Status of the recovery run for this disturbance, or null if none has run yet. */
  runStatus: string | null;
  /** Plain-English result of that run (why it was committed, needs approval, or is infeasible), or null. */
  runReason: string | null;
}

export interface ScheduleView {
  nightOf: string;
  timeZone: string;
  gridStartMs: number;
  slotMs: number;
  stationCapW: number;
  ports: { id: string; label: string; maxPowerW: number; tier: string }[];
  sessions: ScheduleSessionView[];
  disruptions: ScheduleDisruptionView[];
}

interface ReservationRowLite {
  id: string;
  port_id: string;
  created_at: Date;
  payment_state: PaymentState;
  service_state: ServiceState;
  amount_cents: number;
  night_of: string;
  terms: { plugInMs: number; departMs: number; powerW: number[] };
}

interface VersionRow {
  reservation_id: string;
  version: number;
  source: "RECOVERY" | "MANUAL";
  reason: string;
  power_w: number[];
  created_at: Date;
}

async function buildView(deps: AppDeps, nightOf: string, driverSession: string | null): Promise<ScheduleView> {
  const q: Queryable = deps.db;
  const { scenario, envelope } = await nightContext(q, deps.station, nightOf);
  const reservations = await q.query<ReservationRowLite>(
    `select id, port_id, created_at, payment_state, service_state, amount_cents, night_of, terms from reservations
     where station_id = $1 and night_of = $2 and ($3::text is null or driver_session = $3) order by created_at, id`,
    [deps.station.id, nightOf, driverSession],
  );
  const ids = reservations.map((r) => r.id);
  const versions = await q.query<VersionRow>(
    "select reservation_id, version, source, reason, power_w, created_at from schedule_versions where reservation_id = any($1::text[]) order by reservation_id, version",
    [ids],
  );
  const latestRuns = await latestRunsByReservation(q, ids);
  const disruptions = await q.query<{ event_id: string; reservation_id: string; type: DisturbanceType; params: Record<string, number>; effective_slot: number; created_at: Date; status: string | null; outcome: RecoveryOutcome | null; attribution: FaultAttribution }>(
    `select d.event_id, d.reservation_id, d.type, d.params, d.effective_slot, d.created_at, rr.status, rr.outcome,
       coalesce(e.payload->>'attribution', 'UNKNOWN') as attribution
     from disruption_events d join reservations r on r.id = d.reservation_id
     left join recovery_runs rr on rr.disruption_event_id = d.event_id
     left join events e on e.reservation_id = d.reservation_id and e.type = 'DISRUPTION_RECORDED' and e.payload->>'eventId' = d.event_id
     where r.station_id = $1 and r.night_of = $2 and ($3::text is null or r.driver_session = $3) order by d.created_at, d.event_id`,
    [deps.station.id, nightOf, driverSession],
  );

  return {
    nightOf,
    timeZone: deps.station.timeZone,
    gridStartMs: scenario.grid.startMs,
    slotMs: SLOT_MS,
    stationCapW: deps.station.stationCapW,
    ports: deps.station.ports.map((p) => ({ id: p.id, label: p.label, maxPowerW: p.maxPowerW, tier: p.tier })),
    sessions: reservations.map((r) => {
      const own = versions.filter((v) => v.reservation_id === r.id);
      const latest = own[own.length - 1];
      const port = deps.station.ports.find((p) => p.id === r.port_id);
      const versionViews: ScheduleVersionView[] = [
        { version: 1, source: "AGREED", createdAt: r.created_at.toISOString(), reason: "Accepted terms", powerW: r.terms.powerW },
        ...own.map((v) => ({ version: v.version, source: v.source, createdAt: v.created_at.toISOString(), reason: v.reason, powerW: v.power_w })),
      ];
      const run = latestRuns.get(r.id);
      const powerW = latest?.power_w ?? r.terms.powerW;
      return {
        reservationId: r.id,
        portId: r.port_id,
        portLabel: port?.label ?? r.port_id,
        plugInMs: r.terms.plugInMs,
        departMs: r.terms.departMs,
        effectiveDepartMs: effectiveDepartMs(envelope, r.id, r.terms.departMs),
        paymentState: r.payment_state,
        serviceState: r.service_state,
        currentVersion: latest?.version ?? 1,
        versions: versionViews,
        originalPowerW: r.terms.powerW,
        latestRun: run ? { runId: run.id, status: run.status } : null,
        pendingApproval: pendingApprovalView(deps, r, powerW, run),
      };
    }),
    disruptions: disruptions.map((d) => ({
      eventId: d.event_id,
      reservationId: d.reservation_id,
      type: d.type,
      params: d.params,
      effectiveSlot: d.effective_slot,
      attribution: d.attribution,
      createdAt: d.created_at.toISOString(),
      runStatus: d.status,
      runReason: d.outcome?.reason ?? null,
    })),
  };
}

/** Operator view: every session and disturbance on the night. */
export function scheduleView(deps: AppDeps, nightOf: string): Promise<ScheduleView> {
  return buildView(deps, nightOf, null);
}

/** Driver view: only the sessions and disturbances of one driver session. */
export function driverScheduleView(deps: AppDeps, nightOf: string, driverSession: string): Promise<ScheduleView> {
  return buildView(deps, nightOf, driverSession);
}
