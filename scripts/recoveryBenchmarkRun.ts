/**
 * Deterministic recovery benchmark over seeded SYNTHETIC nights. Pure: no database, no model, no clock, no randomness.
 *
 * Each scenario applies one recorded disturbance to one agreed flexible session and compares three columns:
 *   STATIC    the agreed schedule is kept unchanged; delivered energy is replayed under the disturbed constraints.
 *   AUTO      the deterministic recovery pipeline (the orchestrator's validated tools, without the model) with
 *             auto-commit only. A change that needs driver approval is NOT applied; the static plan stays.
 *   APPROVAL  the same pipeline where the driver approves the chosen change. Upper bound on what approval unlocks.
 *
 * Denominators are explicit. Every figure is modeled from synthetic inputs; nothing here is a field measurement.
 */
import { committedLoadW, sessionCostMicrocents, slotsWithin, type AllocationContext } from "../src/domain/allocator";
import { scenarioRequests } from "../src/domain/benchmark";
import { buildEnvelope, chargeEndMs, effectiveDepartMs, portCapAt, validateDisturbance, type DisturbanceRecord, type DisturbanceType } from "../src/domain/disturbance";
import { contribution, microcentsToCentsCeil, type EconomicsConfig } from "../src/domain/economics";
import { generateQuote, type QuoteSet } from "../src/domain/quotes";
import { snapshotSession, type AgreedSession, type ChargingStateSnapshot, type PlanningContext } from "../src/domain/recovery";
import { allocationContext, buildNightScenario, FORECAST_LABEL, type NightScenario } from "../src/domain/scenario";
import { simulateSession } from "../src/domain/simulator";
import { type SessionPlan, type StationConfig } from "../src/domain/station";
import { dispatchTool, newRunState, pickDeterministic, type RunCandidate } from "../src/server/services/recoveryTools";
import { batteryMilliWhFromGridWh, SLOTS_PER_HOUR } from "../src/domain/units";

const HOUR_MS = 3_600_000;

export interface Severity {
  type: DisturbanceType;
  label: string;
  /** Where inside the agreed charging window the disturbance takes effect (0 = first charging slot, 1 = last). */
  windowFraction: number;
  params: (agreedDepartMs: number) => Record<string, number>;
}

export const SEVERITIES: readonly Severity[] = [
  { type: "CHARGER_POWER_REDUCTION", label: "limited to 75% of rated power", windowFraction: 0.5, params: () => ({ factorBp: 7_500 }) },
  { type: "CHARGER_POWER_REDUCTION", label: "limited to 50% of rated power", windowFraction: 0.5, params: () => ({ factorBp: 5_000 }) },
  { type: "CHARGER_POWER_REDUCTION", label: "limited to 25% of rated power", windowFraction: 0.5, params: () => ({ factorBp: 2_500 }) },
  { type: "SITE_CAP_REDUCTION", label: "site cap 18 kW", windowFraction: 0.5, params: () => ({ stationCapW: 18_000 }) },
  { type: "SITE_CAP_REDUCTION", label: "site cap 12 kW", windowFraction: 0.5, params: () => ({ stationCapW: 12_000 }) },
  { type: "SITE_CAP_REDUCTION", label: "site cap 6 kW", windowFraction: 0.5, params: () => ({ stationCapW: 6_000 }) },
  { type: "EARLY_DEPARTURE", label: "departs 1 h early", windowFraction: 0.5, params: (d) => ({ departMs: d - HOUR_MS }) },
  { type: "EARLY_DEPARTURE", label: "departs 2 h early", windowFraction: 0.5, params: (d) => ({ departMs: d - 2 * HOUR_MS }) },
  { type: "EARLY_DEPARTURE", label: "departs 3 h early", windowFraction: 0.5, params: (d) => ({ departMs: d - 3 * HOUR_MS }) },
  { type: "CHARGER_FAILURE", label: "fails at 25% of the charging window", windowFraction: 0.25, params: () => ({}) },
  { type: "CHARGER_FAILURE", label: "fails at 50% of the charging window", windowFraction: 0.5, params: () => ({}) },
  { type: "CHARGER_FAILURE", label: "fails at 75% of the charging window", windowFraction: 0.75, params: () => ({}) },
];

/** One recovery column for one scenario. Delivered energy is always replayed by the same realized simulator. */
export interface ColumnOutcome {
  applied: "NONE" | "AUTO" | "APPROVAL";
  pendingApproval: boolean;
  infeasible: boolean;
  binding: string | null;
  deliveredMilliWh: number;
  satisfied: boolean;
  shortfallMilliWh: number;
  laterFinish: boolean;
  /** Energy cost above the agreed plan (cents); 0 when not higher or not applied. */
  costUpCents: number;
  /** Modeled operator contribution change at the agreed price (cents); null when no change was applied. */
  operatorChangeCents: number | null;
  /** Operator contribution minus the immediate baseline's (cents), the accepted economics constraint; null when no change was applied. */
  marginVsBaselineCents: number | null;
}

export interface ApplicableScenario {
  applicable: true;
  seed: number;
  reservationId: string;
  portId: string;
  type: DisturbanceType;
  severity: string;
  effectiveSlot: number;
  /** Static delivery is below the undisturbed agreed plan: the disturbance cost the driver energy. */
  affected: boolean;
  staticColumn: ColumnOutcome;
  auto: ColumnOutcome;
  approval: ColumnOutcome;
}

export interface NotApplicableScenario {
  applicable: false;
  seed: number;
  reservationId: string;
  portId: string;
  type: DisturbanceType;
  severity: string;
  reason: string;
}

export type ScenarioRecord = ApplicableScenario | NotApplicableScenario;

export interface RecoveryBenchmarkRun {
  seeds: readonly number[];
  flexibleSessions: number;
  /** Undisturbed agreed plans that deliver the target under realized base load (control). */
  controlSatisfied: number;
  scenarios: ScenarioRecord[];
}

interface FlexibleSession {
  session: AgreedSession;
  plan: SessionPlan;
}

interface AgreedNight {
  scenario: NightScenario;
  plans: SessionPlan[];
  flexible: FlexibleSession[];
}

function contextFor(station: StationConfig, scenario: NightScenario, others: readonly SessionPlan[], records: readonly DisturbanceRecord[], economics: EconomicsConfig): PlanningContext {
  return {
    station,
    grid: scenario.grid,
    tariff: scenario.tariff,
    touMc: scenario.touMc,
    forecastBaseLoadW: scenario.forecastBaseLoadW,
    actualBaseLoadW: scenario.actualBaseLoadW,
    economics,
    envelope: buildEnvelope(station, scenario.grid, records),
    others,
  };
}

/** Builds the agreed night in arrival order: each session takes the first offer, or the immediate baseline if none. */
export function agreedNight(station: StationConfig, economics: EconomicsConfig, seed: number): AgreedNight {
  const { nightOf, requests } = scenarioRequests(station, seed);
  const scenario = buildNightScenario(station, nightOf, seed);
  const plans: SessionPlan[] = [];
  const pricedQuotes: { quote: QuoteSet; plan: SessionPlan }[] = [];
  requests.forEach((req, index) => {
    const quote = generateQuote({
      ctx: allocationContext(station, scenario, plans),
      economics,
      request: { ...req, spendCapCents: Math.ceil((req.targetBatteryWh * economics.listPriceCentsPerBatteryKWh) / 1000) },
      quoteSetId: `rb_${seed}_${index}`,
      merchantRef: "recovery-benchmark",
      nowMs: 0,
      ttlMs: 1,
      forecastLabel: FORECAST_LABEL,
    });
    const powerW = quote.offers[0]?.powerW ?? quote.baseline.powerW;
    if (!powerW) return;
    const plan: SessionPlan = { sessionId: `res_${seed}_${req.portId}`, portId: req.portId, plugInMs: req.plugInMs, departMs: req.departMs, powerW };
    plans.push(plan);
    pricedQuotes.push({ quote, plan });
  });

  const flexible: FlexibleSession[] = [];
  for (const { quote, plan } of pricedQuotes) {
    const offer = quote.offers[0];
    if (!offer) continue;
    const session: AgreedSession = {
      reservationId: plan.sessionId,
      portId: plan.portId,
      plugInMs: plan.plugInMs,
      agreedDepartMs: plan.departMs,
      targetBatteryWh: quote.request.targetBatteryWh,
      efficiencyBp: quote.request.efficiencyBp,
      amountCents: offer.priceCents,
      listPriceCents: offer.listPriceCents,
      baselineEnergyCostCents: quote.baseline.energyCostCents ?? 0,
      agreedPowerW: offer.powerW,
      currentPowerW: offer.powerW,
    };
    flexible.push({ session, plan });
  }
  return { scenario, plans, flexible };
}

/** Energy the battery receives under the disturbed constraints: port caps, departure cut-off, realized base load and site cap. */
function deliveredUnder(ctx: PlanningContext, session: AgreedSession, powerW: readonly number[], departMs: number): number {
  const allowed = new Set(slotsWithin(ctx.grid, session.plugInMs, departMs));
  const clipped = powerW.map((w, i) => (allowed.has(i) ? Math.min(w, portCapAt(ctx.station, ctx.envelope, session.portId, i)) : 0));
  return simulateSession({
    station: ctx.station,
    grid: ctx.grid,
    powerW: clipped,
    actualBaseLoadW: ctx.actualBaseLoadW,
    otherSessionsW: committedLoadW(ctx.others, ctx.grid.slotCount),
    targetBatteryWh: session.targetBatteryWh,
    efficiencyBp: session.efficiencyBp,
    faults: {},
    siteCapW: ctx.envelope.siteCapW,
  }).deliveredBatteryMilliWh;
}

function energyCostCents(ctx: PlanningContext, powerW: readonly number[]): number {
  const costCtx: AllocationContext = {
    station: ctx.station,
    grid: ctx.grid,
    tariff: ctx.tariff,
    touMc: ctx.touMc,
    baseLoadW: ctx.forecastBaseLoadW,
    committed: [],
    siteCapW: ctx.envelope.siteCapW,
  };
  return microcentsToCentsCeil(sessionCostMicrocents(costCtx, powerW, committedLoadW(ctx.others, ctx.grid.slotCount)));
}

/** Pre-validated pipeline decision: the chosen candidate, or the constraint that blocked every schedule. */
type Decision = { kind: "CHOSEN"; candidate: RunCandidate } | { kind: "INFEASIBLE"; binding: string };

/** Runs the orchestrator's deterministic steps (no model, no persistence) and returns its decision. */
function decide(ctx: PlanningContext, session: AgreedSession, snap: ChargingStateSnapshot, type: DisturbanceType): Decision {
  const state = newRunState({ ctx, session, snap, version: 1, eventType: type });
  const listed = dispatchTool(state, "requestRecoveryCandidates", {});
  if (!state.candidates) {
    const binding = listed.ok && listed.data && typeof listed.data === "object" && "binding" in listed.data ? String(listed.data.binding) : "NONE";
    return { kind: "INFEASIBLE", binding };
  }
  for (const c of state.candidates) dispatchTool(state, "validateRecoveryPlan", { candidateId: c.id });
  const id = pickDeterministic(state);
  if (!id) return { kind: "INFEASIBLE", binding: "VALIDATION" };
  dispatchTool(state, "proposeRecovery", { candidateId: id });
  return { kind: "CHOSEN", candidate: state.candidates.find((c) => c.id === id)! };
}

function staticColumn(ctx: PlanningContext, session: AgreedSession, delivered: number): ColumnOutcome {
  return {
    applied: "NONE",
    pendingApproval: false,
    infeasible: false,
    binding: null,
    deliveredMilliWh: delivered,
    satisfied: delivered >= session.targetBatteryWh * 1000,
    shortfallMilliWh: Math.max(0, session.targetBatteryWh * 1000 - delivered),
    laterFinish: false,
    costUpCents: 0,
    operatorChangeCents: null,
    marginVsBaselineCents: null,
  };
}

/** One column: `allowApproval` decides whether a driver-approval change is applied or only awaited. */
function column(input: {
  ctx: PlanningContext;
  session: AgreedSession;
  snap: ChargingStateSnapshot;
  decision: Decision;
  allowApproval: boolean;
  staticDelivered: number;
  agreedCostCents: number;
}): ColumnOutcome {
  const { ctx, session, snap, decision } = input;
  if (decision.kind === "INFEASIBLE") return { ...staticColumn(ctx, session, input.staticDelivered), infeasible: true, binding: decision.binding };
  const c = decision.candidate;
  const unchanged = c.powerW.every((w, i) => w === session.currentPowerW[i]);
  const approvalNeeded = c.consent !== "AUTO_COMMIT";
  if (approvalNeeded && !input.allowApproval) return { ...staticColumn(ctx, session, input.staticDelivered), pendingApproval: true };
  if (unchanged) return staticColumn(ctx, session, input.staticDelivered);

  const delivered = deliveredUnder(ctx, session, c.powerW, snap.departMs);
  const cost = energyCostCents(ctx, c.powerW);
  const finish = chargeEndMs(ctx.grid, c.powerW);
  const operatorChangeCents = contribution(ctx.economics, session.amountCents, cost).contributionCents - contribution(ctx.economics, session.amountCents, input.agreedCostCents).contributionCents;
  const marginVsBaselineCents = contribution(ctx.economics, session.amountCents, cost).contributionCents - contribution(ctx.economics, session.listPriceCents, session.baselineEnergyCostCents).contributionCents;
  return {
    applied: approvalNeeded ? "APPROVAL" : "AUTO",
    pendingApproval: false,
    infeasible: false,
    binding: null,
    deliveredMilliWh: delivered,
    satisfied: delivered >= session.targetBatteryWh * 1000,
    shortfallMilliWh: Math.max(0, session.targetBatteryWh * 1000 - delivered),
    laterFinish: finish !== null && finish > snap.agreedReadyByMs,
    costUpCents: Math.max(0, cost - input.agreedCostCents),
    operatorChangeCents,
    marginVsBaselineCents,
  };
}

/** Inputs for one applicable disturbed scenario, shared by the benchmark columns and the per-scenario replay. */
interface ScenarioSetup {
  applicable: true;
  base: { seed: number; reservationId: string; portId: string; type: DisturbanceType; severity: string; effectiveSlot: number };
  ctx: PlanningContext;
  session: AgreedSession;
  snap: ChargingStateSnapshot;
  decision: Decision;
  staticDelivered: number;
  affected: boolean;
  agreedCostCents: number;
}

/** `recoveryEconomics` prices the recovery; the agreed night was priced with the economics that built it. */
function setupScenario(station: StationConfig, night: AgreedNight, item: FlexibleSession, sev: Severity, seed: number, recoveryEconomics: EconomicsConfig): ScenarioSetup | NotApplicableScenario {
  const { session, plan } = item;
  const grid = night.scenario.grid;
  const others = night.plans.filter((p) => p.sessionId !== session.reservationId);
  const firstCharge = session.agreedPowerW.findIndex((w) => w > 0);
  const lastCharge = session.agreedPowerW.reduce((last, w, i) => (w > 0 ? i : last), firstCharge);
  const effectiveSlot = firstCharge + Math.round(sev.windowFraction * (lastCharge - firstCharge));
  const base = { seed, reservationId: session.reservationId, portId: plan.portId, type: sev.type, severity: sev.label, effectiveSlot };
  const record: DisturbanceRecord = { reservationId: session.reservationId, portId: plan.portId, type: sev.type, effectiveSlot, params: sev.params(session.agreedDepartMs) };
  const problem = validateDisturbance(station, grid, { plugInMs: session.plugInMs, departMs: session.agreedDepartMs }, record);
  if (problem) return { applicable: false, ...base, reason: problem };

  const undisturbed = contextFor(station, night.scenario, others, [], recoveryEconomics);
  const ctx = contextFor(station, night.scenario, others, [record], recoveryEconomics);
  const agreedCostCents = energyCostCents(ctx, session.agreedPowerW);
  const departMs = effectiveDepartMs(ctx.envelope, session.reservationId, session.agreedDepartMs);
  const agreedDelivered = deliveredUnder(undisturbed, session, session.agreedPowerW, session.agreedDepartMs);
  const staticDelivered = deliveredUnder(ctx, session, session.currentPowerW, departMs);
  const snap = snapshotSession(ctx, session, effectiveSlot);
  const decision = decide(ctx, session, snap, sev.type);
  return { applicable: true, base, ctx, session, snap, decision, staticDelivered, affected: staticDelivered < agreedDelivered, agreedCostCents };
}

function evaluateScenario(station: StationConfig, economics: EconomicsConfig, night: AgreedNight, item: FlexibleSession, sev: Severity, seed: number): ScenarioRecord {
  const setup = setupScenario(station, night, item, sev, seed, economics);
  if (!setup.applicable) return setup;
  const { ctx, session, snap, decision, staticDelivered, agreedCostCents } = setup;
  const pick = (allowApproval: boolean) => column({ ctx, session, snap, decision, allowApproval, staticDelivered, agreedCostCents });

  return {
    applicable: true,
    ...setup.base,
    affected: setup.affected,
    staticColumn: staticColumn(ctx, session, staticDelivered),
    auto: pick(false),
    approval: pick(true),
  };
}

/** One slot of a replayed scenario: the forecast the planner used next to the realized room the replay delivers into. */
export interface ReplaySlot {
  slot: number;
  forecastBaseW: number;
  actualBaseW: number;
  otherSessionsW: number;
  siteCapW: number;
  /** Room the planner used: site cap minus safety headroom, forecast base and other sessions. */
  forecastRoomW: number;
  /** Room the realized replay delivers into: site cap minus realized base and other sessions. */
  realizedRoomW: number;
  agreedW: number;
  staticW: number;
  /** The chosen recovery plan (the static plan when nothing is chosen). */
  recoveredW: number;
}

function lastIndexWithPower(powerW: readonly number[]): number {
  return powerW.reduce((last, w, i) => (w > 0 ? i : last), -1);
}

/**
 * Slot-by-slot view of one seeded scenario. Explains a benchmark row; the benchmark itself does not read it.
 * Returns null when the reservation or disturbance does not exist or the disturbance is not applicable.
 */
export function replayScenario(
  station: StationConfig,
  economics: EconomicsConfig,
  seed: number,
  reservationId: string,
  type: DisturbanceType,
  severity: string,
  recoveryEconomics: EconomicsConfig = economics,
): ReplayResult | null {
  const night = agreedNight(station, economics, seed);
  const item = night.flexible.find((f) => f.session.reservationId === reservationId);
  const sev = SEVERITIES.find((x) => x.type === type && x.label === severity);
  if (!item || !sev) return null;
  const setup = setupScenario(station, night, item, sev, seed, recoveryEconomics);
  if (!setup.applicable) return null;
  const { ctx, session, snap, decision } = setup;
  const recovered = decision.kind === "CHOSEN" ? decision.candidate.powerW : session.currentPowerW;
  const other = committedLoadW(ctx.others, ctx.grid.slotCount);
  const lastPowered = Math.max(lastIndexWithPower(session.agreedPowerW), lastIndexWithPower(recovered));
  const slots: ReplaySlot[] = [];
  for (let i = Math.max(0, snap.effectiveSlot - 2); i <= Math.min(ctx.grid.slotCount - 1, lastPowered + 1); i++) {
    const siteCapW = ctx.envelope.siteCapW[i] ?? ctx.station.stationCapW;
    const forecastBaseW = ctx.forecastBaseLoadW[i] ?? 0;
    const actualBaseW = ctx.actualBaseLoadW[i] ?? 0;
    const otherSessionsW = other[i] ?? 0;
    slots.push({
      slot: i,
      forecastBaseW,
      actualBaseW,
      otherSessionsW,
      siteCapW,
      forecastRoomW: siteCapW - ctx.station.safetyHeadroomW - forecastBaseW - otherSessionsW,
      realizedRoomW: siteCapW - actualBaseW - otherSessionsW,
      agreedW: session.agreedPowerW[i] ?? 0,
      staticW: session.currentPowerW[i] ?? 0,
      recoveredW: recovered[i] ?? 0,
    });
  }
  const recoveredGridWh = recovered.reduce((sum, w) => sum + w / SLOTS_PER_HOUR, 0);
  return {
    effectiveSlot: snap.effectiveSlot,
    decision,
    staticDelivered: setup.staticDelivered,
    slots,
    recovered: {
      powerW: recovered,
      forecastBatteryMilliWh: batteryMilliWhFromGridWh(recoveredGridWh, session.efficiencyBp),
      realizedDeliveredMilliWh: deliveredUnder(ctx, session, recovered, snap.departMs),
      targetMilliWh: session.targetBatteryWh * 1000,
    },
  };
}

/** A replayed scenario. `recovered` is the chosen plan (the static plan when nothing is chosen). */
export interface ReplayResult {
  effectiveSlot: number;
  decision: Decision;
  staticDelivered: number;
  slots: ReplaySlot[];
  recovered: {
    powerW: readonly number[];
    /** Battery energy the forecast plan promises (planning figure, not delivery). */
    forecastBatteryMilliWh: number;
    /** Battery energy the realized ledger replay delivers for this plan. */
    realizedDeliveredMilliWh: number;
    targetMilliWh: number;
  };
}

/** Runs every (seed, flexible session, severity) scenario. Order is fixed by the loops, so output is reproducible. */
export function runRecoveryBenchmark(station: StationConfig, economics: EconomicsConfig, seeds: readonly number[]): RecoveryBenchmarkRun {
  const scenarios: ScenarioRecord[] = [];
  let flexibleSessions = 0;
  let controlSatisfied = 0;
  for (const seed of seeds) {
    const night = agreedNight(station, economics, seed);
    flexibleSessions += night.flexible.length;
    for (const item of night.flexible) {
      const undisturbed = contextFor(station, night.scenario, night.plans.filter((p) => p.sessionId !== item.session.reservationId), [], economics);
      if (deliveredUnder(undisturbed, item.session, item.session.agreedPowerW, item.session.agreedDepartMs) >= item.session.targetBatteryWh * 1000) controlSatisfied++;
      for (const sev of SEVERITIES) scenarios.push(evaluateScenario(station, economics, night, item, sev, seed));
    }
  }
  return { seeds: [...seeds], flexibleSessions, controlSatisfied, scenarios };
}
