/** Read models for the UI. Provider references are redacted; no secrets or buyer identity are stored or shown. */
import { aiStatusOf, type AiStatus } from "../ai/aiStatus";
import { explainOffer } from "@/domain/explain";
import type { PaymentState, ServiceState } from "@/domain/paymentState";
import type { QuoteSet } from "@/domain/quotes";
import { ServiceError, type AppDeps } from "../deps";
import { effectivePowerOf, getReservation, latestSchedulesOf, type ReservationRow } from "../repo";
import { latestRunsByReservation, pendingApprovalView, type PendingApprovalView } from "./approvalView";
import { OPERATOR_RESOLUTION_REQUIRED } from "./outdatedSessionService";
import { scenarioFor } from "./quoteService";
import { buildRecoveryReceipt, type RecoveryReceipt } from "./recoveryReceipt";

export function redactRef(ref: string | null): string | null {
  if (!ref) return null;
  return ref.length > 8 ? `…${ref.slice(-6)}` : "…";
}

export interface ProofView {
  type: string;
  ref: string | null;
  providerStatus: string;
  amountCents: number | null;
  evidenceSource: "PAYPAL_SANDBOX_API" | "MOCK_PROVIDER";
  observedAt: string;
}

export interface EnergyRecordView {
  slotIndex: number;
  slotStartMs: number;
  commandedW: number;
  deliveredW: number;
  batteryMilliWh: number;
  limitedBy: string;
}

export interface ReservationView {
  id: string;
  providerMode: "PAYPAL_SANDBOX" | "MOCK";
  paymentState: PaymentState;
  serviceState: ServiceState;
  slotsCommitted: boolean;
  portLabel: string;
  /** Merchant of record shown on the receipt (the station operator). */
  merchantName: string;
  timeZone: string;
  plugInMs: number;
  departMs: number;
  targetBatteryWh: number;
  efficiencyBp: number;
  gridStartMs: number;
  powerW: number[];
  termsHash: string;
  economics: {
    listPriceCents: number;
    priceCents: number;
    discountCents: number;
    energyCostCents: number;
    baselineEnergyCostCents: number | null;
    operatorImprovementCents: number;
    tariffLabel: string;
    economicsLabel: string;
    forecastLabel: string;
  };
  explanation: string[];
  proofs: ProofView[];
  simulation: null | {
    outcome: "DELIVERED" | "FAILED";
    deliveredBatteryMilliWh: number;
    targetBatteryMilliWh: number;
    triggeredBy: string;
    createdAt: string;
    /** Synthetic ledger shortfall against the agreed battery target (0 when met). Actual delivery, not the forecast. */
    shortfallBatteryMilliWh: number;
    /** Whether the operator injected a synthetic charger outage into this run. */
    outageInjected: boolean;
    records: EnergyRecordView[];
  };
  events: { type: string; source: string; occurredAt: string }[];
  canSimulate: boolean;
  authorizationExpiresAt: string | null;
  /** Additive: autonomous recovery data; null when no disturbance was recorded. */
  recovery: RecoveryReceipt | null;
  /** Additive: a recovery proposal awaiting this driver's decision; null otherwise. */
  pendingApproval: PendingApprovalView | null;
}

async function quotePayload(deps: AppDeps, quoteSetId: string): Promise<QuoteSet> {
  const rows = await deps.db.query<{ payload: QuoteSet }>("select payload from quote_sets where id = $1", [quoteSetId]);
  return rows[0]!.payload;
}

export async function reservationView(deps: AppDeps, rid: string, viewer: { driverSession: string } | { operator: true }): Promise<ReservationView> {
  const r: ReservationRow | null = await getReservation(deps.db, rid);
  if (!r || ("driverSession" in viewer && r.driver_session !== viewer.driverSession)) throw new ServiceError("NOT_FOUND", "Reservation not found.", 404);
  const quote = await quotePayload(deps, r.quote_set_id);
  const offer = quote.offers.find((o) => o.offerId === r.offer_id)!;
  const proofs = await deps.db.query<{ proof_type: string; provider_ref: string; provider_status: string; amount_cents: number | null; evidence_source: ProofView["evidenceSource"]; observed_at: Date }>(
    "select proof_type, provider_ref, provider_status, amount_cents, evidence_source, observed_at from provider_proofs where reservation_id = $1 order by observed_at",
    [rid],
  );
  const runs = await deps.db.query<{ id: string; outcome: "DELIVERED" | "FAILED"; delivered_battery_mwh: number; target_battery_mwh: number; triggered_by: string; created_at: Date; faults: { outage?: unknown } }>(
    "select * from simulation_runs where reservation_id = $1",
    [rid],
  );
  const run = runs[0];
  const records = run
    ? await deps.db.query<{ slot_index: number; slot_start: Date; commanded_w: number; delivered_w: number; battery_mwh: number; limited_by: string }>(
        "select slot_index, slot_start, commanded_w, delivered_w, battery_mwh, limited_by from energy_records where run_id = $1 order by slot_index",
        [run.id],
      )
    : [];
  const events = await deps.db.query<{ type: string; source: string; occurred_at: Date }>("select type, source, occurred_at from events where reservation_id = $1 order by id", [rid]);
  const port = deps.station.ports.find((p) => p.id === r.port_id);

  return {
    id: r.id,
    providerMode: r.provider_mode,
    paymentState: r.payment_state,
    serviceState: r.service_state,
    slotsCommitted: r.slots_committed,
    portLabel: port?.label ?? r.port_id,
    merchantName: deps.station.name,
    timeZone: deps.station.timeZone,
    plugInMs: r.terms.plugInMs,
    departMs: r.terms.departMs,
    targetBatteryWh: r.terms.targetBatteryWh,
    efficiencyBp: r.terms.efficiencyBp,
    gridStartMs: r.terms.gridStartMs,
    powerW: await effectivePowerOf(deps.db, r),
    termsHash: r.terms_hash,
    economics: {
      listPriceCents: r.terms.listPriceCents,
      priceCents: r.amount_cents,
      discountCents: r.terms.listPriceCents - r.amount_cents,
      energyCostCents: offer.energyCostCents,
      baselineEnergyCostCents: quote.baseline.energyCostCents ?? null,
      operatorImprovementCents: offer.operatorImprovementCents,
      tariffLabel: quote.assumptions.tariff,
      economicsLabel: quote.assumptions.economics,
      forecastLabel: quote.assumptions.forecast,
    },
    explanation: explainOffer(quote, offer),
    proofs: proofs.map((p) => ({
      type: p.proof_type,
      ref: redactRef(p.provider_ref),
      providerStatus: p.provider_status,
      amountCents: p.amount_cents,
      evidenceSource: p.evidence_source,
      observedAt: p.observed_at.toISOString(),
    })),
    simulation: run
      ? {
          outcome: run.outcome,
          deliveredBatteryMilliWh: run.delivered_battery_mwh,
          targetBatteryMilliWh: run.target_battery_mwh,
          shortfallBatteryMilliWh: Math.max(0, run.target_battery_mwh - run.delivered_battery_mwh),
          outageInjected: run.faults?.outage !== undefined,
          triggeredBy: run.triggered_by,
          createdAt: run.created_at.toISOString(),
          records: records.map((x) => ({
            slotIndex: x.slot_index,
            slotStartMs: x.slot_start.getTime(),
            commandedW: x.commanded_w,
            deliveredW: x.delivered_w,
            batteryMilliWh: x.battery_mwh,
            limitedBy: x.limited_by,
          })),
        }
      : null,
    events: events.map((e) => ({ type: e.type, source: e.source, occurredAt: e.occurred_at.toISOString() })),
    canSimulate: !run && r.payment_state === "AUTHORIZED" && r.service_state === "SCHEDULED" && r.slots_committed,
    authorizationExpiresAt: r.authorization_expires_at ? r.authorization_expires_at.toISOString() : null,
    recovery: await buildRecoveryReceipt(deps, r),
    pendingApproval: pendingApprovalView(deps, r, await effectivePowerOf(deps.db, r), (await latestRunsByReservation(deps.db, [rid])).get(rid)),
  };
}

export interface DashboardSession {
  id: string;
  portId: string;
  plugInMs: number;
  departMs: number;
  powerW: number[];
  deliveredW: number[] | null;
  paymentState: PaymentState;
  serviceState: ServiceState;
  slotsCommitted: boolean;
  amountCents: number;
  providerMode: string;
  targetBatteryWh: number;
  /** Immediate-charging plan for the same request (from the stored quote) for baseline comparison. */
  baselinePowerW: number[];
  listPriceCents: number;
  discountCents: number;
  energyCostCents: number;
  baselineEnergyCostCents: number | null;
  operatorImprovementCents: number;
  lastEvent: { type: string; source: string; occurredAt: string } | null;
  updatedAt: string;
  /** Amount of a provider CAPTURED proof, if any; can exist while the local state disagrees. */
  providerCapturedCents: number | null;
  /** Additive: a disturbance left this authorized session for operator resolution (no automatic capture or void). */
  operatorResolutionRequired: boolean;
  /** Stored resolution deadline (ISO) of the open operator flag; null when no flag or the flag predates deadlines. */
  resolutionDeadline: string | null;
  /** True once the stored deadline has passed. Informational only: it never moves money. */
  resolutionOverdue: boolean;
}

export interface OperatorDashboard {
  nightOf: string;
  timeZone: string;
  gridStartMs: number;
  slotCount: number;
  stationCapW: number;
  safetyHeadroomW: number;
  congestionThresholdW: number;
  ports: { id: string; label: string; maxPowerW: number }[];
  forecastBaseLoadW: number[];
  actualBaseLoadW: number[];
  touMcPerKWh: number[];
  tariff: { label: string; bands: { fromHour: number; toHour: number; mcPerKWh: number }[]; congestionSurchargeMcPerKWh: number };
  sessions: DashboardSession[];
  providerMode: string;
  ai: AiStatus;
}

export async function operatorDashboard(deps: AppDeps, nightOf: string): Promise<OperatorDashboard> {
  const scenario = scenarioFor(deps.station, nightOf);
  const rows = await deps.db.query<ReservationRow>("select * from reservations where station_id = $1 and night_of = $2 order by created_at", [deps.station.id, nightOf]);
  const schedules = await latestSchedulesOf(deps.db, deps.station.id, nightOf);
  const delivered = await deps.db.query<{ reservation_id: string; slot_index: number; delivered_w: number }>(
    "select e.reservation_id, e.slot_index, e.delivered_w from energy_records e join reservations r on r.id = e.reservation_id where r.station_id = $1 and r.night_of = $2",
    [deps.station.id, nightOf],
  );
  const deliveredBy = new Map<string, number[]>();
  for (const d of delivered) {
    const arr = deliveredBy.get(d.reservation_id) ?? new Array<number>(scenario.grid.slotCount).fill(0);
    arr[d.slot_index] = d.delivered_w;
    deliveredBy.set(d.reservation_id, arr);
  }
  const quotes = await deps.db.query<{ id: string; payload: QuoteSet }>("select id, payload from quote_sets where id = any($1::text[])", [rows.map((r) => r.quote_set_id)]);
  const quoteById = new Map(quotes.map((q) => [q.id, q.payload]));
  const lastEvents = await deps.db.query<{ reservation_id: string; type: string; source: string; occurred_at: Date }>(
    `select distinct on (e.reservation_id) e.reservation_id, e.type, e.source, e.occurred_at from events e join reservations r on r.id = e.reservation_id
     where r.station_id = $1 and r.night_of = $2 order by e.reservation_id, e.id desc`,
    [deps.station.id, nightOf],
  );
  const lastEventBy = new Map(lastEvents.map((e) => [e.reservation_id, { type: e.type, source: e.source, occurredAt: e.occurred_at.toISOString() }]));
  const captures = await deps.db.query<{ reservation_id: string; amount_cents: number | null }>(
    "select p.reservation_id, p.amount_cents from provider_proofs p join reservations r on r.id = p.reservation_id where r.station_id = $1 and r.night_of = $2 and p.proof_type = 'CAPTURED'",
    [deps.station.id, nightOf],
  );
  const capturedBy = new Map(captures.map((c) => [c.reservation_id, c.amount_cents]));
  // The flag is recorded once per reservation; its first event carries the stored resolution deadline.
  const resolutions = await deps.db.query<{ reservation_id: string; resolve_by: string | null }>(
    `select distinct on (e.reservation_id) e.reservation_id, e.payload->>'resolveBy' as resolve_by from events e join reservations r on r.id = e.reservation_id
     where r.station_id = $1 and r.night_of = $2 and e.type = $3 order by e.reservation_id, e.id`,
    [deps.station.id, nightOf, OPERATOR_RESOLUTION_REQUIRED],
  );
  const resolutionBy = new Map(resolutions.map((x) => [x.reservation_id, x.resolve_by]));
  const nowMs = deps.now();
  const deadlineOf = (rid: string): { resolutionDeadline: string | null; resolutionOverdue: boolean } => {
    const deadline = resolutionBy.get(rid) ?? null;
    const deadlineMs = deadline ? Date.parse(deadline) : Number.NaN;
    return { resolutionDeadline: Number.isNaN(deadlineMs) ? null : new Date(deadlineMs).toISOString(), resolutionOverdue: !Number.isNaN(deadlineMs) && nowMs >= deadlineMs };
  };
  return {
    nightOf,
    timeZone: deps.station.timeZone,
    gridStartMs: scenario.grid.startMs,
    slotCount: scenario.grid.slotCount,
    stationCapW: deps.station.stationCapW,
    safetyHeadroomW: deps.station.safetyHeadroomW,
    congestionThresholdW: Math.floor((deps.station.stationCapW * scenario.tariff.congestionThresholdBp) / 10_000),
    ports: deps.station.ports.map((p) => ({ ...p })),
    forecastBaseLoadW: scenario.forecastBaseLoadW,
    actualBaseLoadW: scenario.actualBaseLoadW,
    touMcPerKWh: scenario.touMc,
    tariff: { label: scenario.tariff.label, bands: scenario.tariff.bands.map((b) => ({ ...b })), congestionSurchargeMcPerKWh: scenario.tariff.congestionSurchargeMcPerKWh },
    sessions: rows.map((r) => {
      const quote = quoteById.get(r.quote_set_id);
      const offer = quote?.offers.find((o) => o.offerId === r.offer_id);
      return {
      id: r.id,
      portId: r.port_id,
      plugInMs: r.terms.plugInMs,
      departMs: r.terms.departMs,
      powerW: schedules.get(r.id) ?? r.terms.powerW,
      deliveredW: deliveredBy.get(r.id) ?? null,
      paymentState: r.payment_state,
      serviceState: r.service_state,
      slotsCommitted: r.slots_committed,
      amountCents: r.amount_cents,
      providerMode: r.provider_mode,
      targetBatteryWh: r.terms.targetBatteryWh,
      baselinePowerW: quote?.baseline.powerW ?? [],
      listPriceCents: r.terms.listPriceCents,
      discountCents: r.terms.listPriceCents - r.amount_cents,
      energyCostCents: offer?.energyCostCents ?? 0,
      baselineEnergyCostCents: quote?.baseline.energyCostCents ?? null,
      operatorImprovementCents: offer?.operatorImprovementCents ?? 0,
      lastEvent: lastEventBy.get(r.id) ?? null,
      updatedAt: r.updated_at.toISOString(),
      providerCapturedCents: capturedBy.has(r.id) ? (capturedBy.get(r.id) ?? r.amount_cents) : null,
      operatorResolutionRequired: resolutionBy.has(r.id),
      ...deadlineOf(r.id),
      };
    }),
    providerMode: deps.gateway.mode,
    ai: aiStatusOf(deps.llm),
  };
}
