/**
 * Deterministic charge recovery. A recorded disturbance re-plans ONLY this session's energy from its
 * effective slot onward, using the existing allocator presets. Energy before the slot, other sessions'
 * plans, the agreed price and the agreed terms are inputs that never change. Every candidate is
 * re-validated (physics and economics) before it is returned. No AI, no network, no randomness.
 */
import { allocate, committedLoadW, sessionCostMicrocents, slotsWithin, type AllocationContext, type AllocationPolicy } from "./allocator";
import { contribution, microcentsToCentsCeil, validateOfferEconomics, type EconomicsConfig } from "./economics";
import { chargeEndMs, effectiveDepartMs, portCapAt, validateWithEnvelope, type NightEnvelope } from "./disturbance";
import type { TariffModel } from "./forecast";
import { VARIANTS, type OfferKind } from "./quotes";
import { decideConsent, type ConsentDecision } from "./recoveryConsent";
import type { ChargeRequest, SessionPlan, StationConfig } from "./station";
import { simulateSession } from "./simulator";
import { slotStartMs, type SlotGrid } from "./time";
import { batteryMilliWhFromGridWh, requiredGridWh, SLOT_MS, SLOTS_PER_HOUR } from "./units";

export interface PlanningContext {
  station: StationConfig;
  grid: SlotGrid;
  tariff: TariffModel;
  touMc: readonly number[];
  /** Planning forecast of site base load (W), the basis for every capacity check. */
  forecastBaseLoadW: readonly number[];
  /** Realized base load (W), used only to compute energy already delivered. */
  actualBaseLoadW: readonly number[];
  economics: EconomicsConfig;
  envelope: NightEnvelope;
  /** Other sessions' current effective plans. Read-only: recovery never changes them. */
  others: readonly SessionPlan[];
}

/** The session as agreed, plus its current effective plan. Agreed fields come from the immutable terms. */
export interface AgreedSession {
  reservationId: string;
  portId: string;
  plugInMs: number;
  agreedDepartMs: number;
  targetBatteryWh: number;
  efficiencyBp: number;
  /** Agreed price; a price ceiling that recovery can never raise. */
  amountCents: number;
  listPriceCents: number;
  /** Energy cost of the immediate-charging baseline from the stored quote. */
  baselineEnergyCostCents: number;
  /** Agreed (immutable) per-slot plan. */
  agreedPowerW: readonly number[];
  /** Current effective per-slot plan. */
  currentPowerW: readonly number[];
}

export interface ChargingStateSnapshot {
  reservationId: string;
  portId: string;
  plugInMs: number;
  agreedDepartMs: number;
  agreedReadyByMs: number;
  /** Effective departure: the agreed one, or an earlier one after a recorded early departure. */
  departMs: number;
  effectiveSlot: number;
  targetBatteryWh: number;
  efficiencyBp: number;
  deliveredBatteryMilliWh: number;
  /** Battery Wh still needed, rounded up. */
  remainingBatteryWh: number;
  amountCents: number;
  listPriceCents: number;
  baselineEnergyCostCents: number;
}

export interface TraceStep {
  step: string;
  detail: string;
}

export interface RecoveryCandidate {
  preference: OfferKind;
  /** Full-night per-slot plan: energy before the effective slot is copied, not recomputed. */
  powerW: number[];
  gridWh: number;
  batteryMilliWh: number;
  chargeEndMs: number | null;
  energyCostCents: number;
  priceCents: number;
  /** Always 0: recovery never changes the agreed price. */
  priceChangeCents: number;
  operatorImprovementCents: number;
  consent: ConsentDecision;
  /** Identical to the current effective plan. */
  unchanged: boolean;
}

export interface RecoveryRejection {
  preference: OfferKind;
  reason: string;
}

export type RecoveryBinding = "PORT_FAILED" | "PORT_POWER" | "SITE_CAPACITY" | "TIME" | "OPERATOR_ECONOMICS" | "VALIDATION";

export type RecoveryResult =
  | { ok: true; candidates: RecoveryCandidate[]; rejected: RecoveryRejection[]; trace: TraceStep[] }
  | { ok: false; binding: RecoveryBinding; message: string; rejected: RecoveryRejection[]; trace: TraceStep[] };

export function snapshotSession(ctx: PlanningContext, session: AgreedSession, effectiveSlot: number): ChargingStateSnapshot {
  const departMs = effectiveDepartMs(ctx.envelope, session.reservationId, session.agreedDepartMs);
  // Only energy scheduled before the effective slot counts as delivered; the simulator replays it.
  const pastW = session.currentPowerW.map((w, i) => (i < effectiveSlot ? w : 0));
  const sim = simulateSession({
    station: ctx.station,
    grid: ctx.grid,
    powerW: pastW,
    actualBaseLoadW: ctx.actualBaseLoadW,
    otherSessionsW: committedLoadW(ctx.others, ctx.grid.slotCount),
    targetBatteryWh: session.targetBatteryWh,
    efficiencyBp: session.efficiencyBp,
    faults: {},
    siteCapW: ctx.envelope.siteCapW,
  });
  const remainingMilliWh = Math.max(0, sim.targetBatteryMilliWh - sim.deliveredBatteryMilliWh);
  return {
    reservationId: session.reservationId,
    portId: session.portId,
    plugInMs: session.plugInMs,
    agreedDepartMs: session.agreedDepartMs,
    agreedReadyByMs: chargeEndMs(ctx.grid, session.agreedPowerW) ?? session.agreedDepartMs,
    departMs,
    effectiveSlot,
    targetBatteryWh: session.targetBatteryWh,
    efficiencyBp: session.efficiencyBp,
    deliveredBatteryMilliWh: sim.deliveredBatteryMilliWh,
    remainingBatteryWh: Math.ceil(remainingMilliWh / 1000),
    amountCents: session.amountCents,
    listPriceCents: session.listPriceCents,
    baselineEnergyCostCents: session.baselineEnergyCostCents,
  };
}

type Proposal = { kind: OfferKind; forwardOrReason: { powerW: number[] } | { reason: string } };

export function recoverSession(ctx: PlanningContext, session: AgreedSession, snap: ChargingStateSnapshot): RecoveryResult {
  const trace: TraceStep[] = [];
  const port = ctx.station.ports.find((p) => p.id === session.portId);
  if (!port) return { ok: false, binding: "VALIDATION", message: "The session's port is unknown to this station.", rejected: [], trace };
  const slotCount = ctx.grid.slotCount;
  const eff = snap.effectiveSlot;
  const allocCtx: AllocationContext = {
    station: ctx.station,
    grid: ctx.grid,
    tariff: ctx.tariff,
    touMc: ctx.touMc,
    baseLoadW: ctx.forecastBaseLoadW,
    committed: ctx.others,
    siteCapW: ctx.envelope.siteCapW,
  };
  const costCtx: AllocationContext = { ...allocCtx, committed: [] };
  const slotCapW = Array.from({ length: slotCount }, (_, i) => portCapAt(ctx.station, ctx.envelope, port.id, i));
  const req: ChargeRequest = {
    portId: port.id,
    plugInMs: snap.plugInMs,
    departMs: snap.departMs,
    targetBatteryWh: snap.remainingBatteryWh,
    efficiencyBp: snap.efficiencyBp,
    spendCapCents: snap.amountCents,
  };
  trace.push({
    step: "SNAPSHOT",
    detail: `${snap.remainingBatteryWh} Wh still needed after slot ${eff}; departure ${new Date(snap.departMs).toISOString()}`,
  });

  const proposals: Proposal[] =
    snap.remainingBatteryWh === 0
      ? [{ kind: "flex_lowest_cost", forwardOrReason: { powerW: new Array<number>(slotCount).fill(0) } }]
      : VARIANTS.map((variant) => {
          const policy = variant.policy(req, port.maxPowerW, ctx.station.powerStepW);
          if (!policy) return { kind: variant.kind, forwardOrReason: { reason: "WINDOW_TOO_SHORT" } };
          const alloc = allocate(allocCtx, req, withSlotLimits(policy, eff, slotCapW));
          return alloc.ok
            ? { kind: variant.kind, forwardOrReason: { powerW: alloc.powerW } }
            : { kind: variant.kind, forwardOrReason: { reason: `${alloc.reason}: ${alloc.detail}` } };
        });

  const candidates: RecoveryCandidate[] = [];
  const rejected: RecoveryRejection[] = [];
  for (const proposal of proposals) {
    if (!("powerW" in proposal.forwardOrReason)) {
      rejected.push({ preference: proposal.kind, reason: proposal.forwardOrReason.reason });
      trace.push({ step: proposal.kind, detail: `rejected: ${proposal.forwardOrReason.reason}` });
      continue;
    }
    // Keep energy before the effective slot exactly as scheduled; the allocator only fills from it onward.
    const full = [...session.currentPowerW.slice(0, eff), ...proposal.forwardOrReason.powerW.slice(eff)];
    if (candidates.some((c) => c.powerW.every((w, i) => w === full[i]))) {
      rejected.push({ preference: proposal.kind, reason: "DUPLICATE_SCHEDULE" });
      continue;
    }
    const verdict = evaluateCandidate(ctx, session, snap, costCtx, proposal.kind, full);
    if ("reason" in verdict) {
      rejected.push({ preference: proposal.kind, reason: verdict.reason });
      trace.push({ step: proposal.kind, detail: `rejected: ${verdict.reason}` });
    } else {
      candidates.push(verdict.candidate);
      trace.push({ step: proposal.kind, detail: `feasible; consent ${verdict.candidate.consent.decision}` });
    }
  }

  if (candidates.length > 0) return { ok: true, candidates, rejected, trace };
  const failure = classifyFailure(ctx, session, snap, rejected, slotCapW);
  trace.push({ step: "BINDING", detail: failure.binding });
  return { ok: false, binding: failure.binding, message: failure.message, rejected, trace };
}

function withSlotLimits(policy: AllocationPolicy, minSlot: number, slotCapW: readonly number[]): AllocationPolicy {
  return policy.kind === "optimized" ? { ...policy, minSlot, slotCapW } : policy;
}

function evaluateCandidate(
  ctx: PlanningContext,
  session: AgreedSession,
  snap: ChargingStateSnapshot,
  costCtx: AllocationContext,
  kind: OfferKind,
  powerW: number[],
): { candidate: RecoveryCandidate } | { reason: string } {
  const violations = validateWithEnvelope({
    station: ctx.station,
    grid: ctx.grid,
    forecastBaseLoadW: ctx.forecastBaseLoadW,
    envelope: ctx.envelope,
    plans: [...ctx.others, { sessionId: session.reservationId, portId: session.portId, plugInMs: snap.plugInMs, departMs: snap.departMs, powerW }],
    targets: [{ sessionId: session.reservationId, targetBatteryWh: session.targetBatteryWh, efficiencyBp: session.efficiencyBp }],
  });
  if (violations.length > 0) return { reason: `VALIDATOR_REJECTED: ${[...new Set(violations.map((v) => v.code))].join(", ")}` };

  const gridWh = powerW.reduce((sum, w) => sum + w / SLOTS_PER_HOUR, 0);
  const batteryMilliWh = batteryMilliWhFromGridWh(gridWh, session.efficiencyBp);
  const energyCostCents = microcentsToCentsCeil(sessionCostMicrocents(costCtx, powerW, committedLoadW(ctx.others, ctx.grid.slotCount)));
  const economics = validateOfferEconomics(ctx.economics, {
    priceCents: session.amountCents,
    listPriceCents: session.listPriceCents,
    energyCostCents,
    baselineEnergyCostCents: session.baselineEnergyCostCents,
  });
  if (economics.length > 0) return { reason: `OPERATOR_INELIGIBLE: ${economics.join("; ")}` };

  const operatorImprovementCents =
    contribution(ctx.economics, session.amountCents, energyCostCents).contributionCents -
    contribution(ctx.economics, session.listPriceCents, session.baselineEnergyCostCents).contributionCents;
  const finishMs = chargeEndMs(ctx.grid, powerW) ?? snap.plugInMs;
  const consent = decideConsent({
    // Planned energy from the forecast plan. Realized delivery is decided later by the synthetic ledger.
    forecastEnergyMet: batteryMilliWh >= session.targetBatteryWh * 1000,
    agreedAmountCents: session.amountCents,
    proposedAmountCents: session.amountCents,
    agreedDepartMs: session.agreedDepartMs,
    proposedDepartMs: snap.departMs,
    agreedReadyByMs: snap.agreedReadyByMs,
    proposedFinishMs: finishMs,
    withinPluggedWindow: powerW.every((w, i) => w === 0 || (slotStartMs(ctx.grid, i) >= session.plugInMs && slotStartMs(ctx.grid, i) + SLOT_MS <= session.agreedDepartMs)),
    pastUnchanged: session.currentPowerW.slice(0, snap.effectiveSlot).every((w, i) => w === powerW[i]),
    otherSessionsChanged: false,
  });
  return {
    candidate: {
      preference: kind,
      powerW,
      gridWh,
      batteryMilliWh,
      chargeEndMs: chargeEndMs(ctx.grid, powerW),
      energyCostCents,
      priceCents: session.amountCents,
      priceChangeCents: 0,
      operatorImprovementCents,
      consent,
      unchanged: powerW.every((w, i) => w === session.currentPowerW[i]),
    },
  };
}

/** Grid Wh the allocator can place in the given slots under a per-slot port cap and a site cap. */
function deliverableGridWh(ctx: PlanningContext, slots: readonly number[], siteCapW: readonly number[], portCapW: readonly number[]): number {
  const other = committedLoadW(ctx.others, ctx.grid.slotCount);
  const step = ctx.station.powerStepW;
  let wh = 0;
  for (const i of slots) {
    const headroom = (siteCapW[i] ?? ctx.station.stationCapW) - ctx.station.safetyHeadroomW - (ctx.forecastBaseLoadW[i] ?? 0) - (other[i] ?? 0);
    const w = Math.max(0, Math.floor(Math.min(portCapW[i] ?? 0, headroom) / step) * step);
    wh += w / SLOTS_PER_HOUR;
  }
  return wh;
}

/** Names the first constraint that blocks the remaining energy, in the order a driver would act on it. */
function classifyFailure(
  ctx: PlanningContext,
  session: AgreedSession,
  snap: ChargingStateSnapshot,
  rejected: readonly RecoveryRejection[],
  slotCapW: readonly number[],
): { binding: RecoveryBinding; message: string } {
  const eff = snap.effectiveSlot;
  const capacityBlocked = rejected.some((r) => r.reason.startsWith("INSUFFICIENT_CAPACITY") || r.reason.startsWith("OUTSIDE_HORIZON") || r.reason.startsWith("WINDOW_TOO_SHORT"));
  if (!capacityBlocked) {
    if (rejected.length > 0 && rejected.every((r) => r.reason.startsWith("OPERATOR_INELIGIBLE"))) {
      return {
        binding: "OPERATOR_ECONOMICS",
        message: "Every feasible schedule would cost the operator more than its minimum contribution allows, so none can be offered.",
      };
    }
    return { binding: "VALIDATION", message: `No schedule passed the physical checks: ${rejected.map((r) => r.reason).join("; ")}.` };
  }
  const slots = slotsWithin(ctx.grid, snap.plugInMs, snap.departMs).filter((i) => i >= eff);
  const needGridWh = requiredGridWh(snap.remainingBatteryWh, snap.efficiencyBp);
  const port = ctx.station.ports.find((p) => p.id === session.portId);
  const ratedCapW = new Array<number>(ctx.grid.slotCount).fill(port?.maxPowerW ?? 0);
  const siteEnvelope = ctx.envelope.siteCapW;
  const flatSite = new Array<number>(ctx.grid.slotCount).fill(ctx.station.stationCapW);
  const label = port?.label ?? session.portId;

  if (slots.length === 0) return { binding: "TIME", message: timeMessage() };
  if (slots.every((i) => slotCapW[i] === 0)) {
    return {
      binding: "PORT_FAILED",
      message: `Charger ${label} has failed from slot ${eff}, so the remaining ${snap.remainingBatteryWh} Wh cannot be delivered there. The vehicle stays on its port and nothing was moved to another port.`,
    };
  }
  if (deliverableGridWh(ctx, slots, siteEnvelope, ratedCapW) >= needGridWh) {
    return {
      binding: "PORT_POWER",
      message: `Charger ${label} is limited from slot ${eff}. At that limit the remaining energy cannot be delivered before departure.`,
    };
  }
  if (deliverableGridWh(ctx, slots, flatSite, slotCapW) >= needGridWh) {
    return {
      binding: "SITE_CAPACITY",
      message: `Site capacity is reduced from slot ${eff}, and other committed sessions already use the room needed for the remaining energy before departure.`,
    };
  }
  return { binding: "TIME", message: timeMessage() };
}

function timeMessage(): string {
  return "There is not enough time before departure to deliver the remaining energy, even at full power.";
}

/**
 * Independent re-check of one full-night plan. Only its per-slot powers are read: physics, economics and
 * consent are recomputed here, so no stored candidate metadata is trusted.
 */
export function revalidateSchedule(
  ctx: PlanningContext,
  session: AgreedSession,
  snap: ChargingStateSnapshot,
  powerW: number[],
  kind: OfferKind,
): { candidate: RecoveryCandidate } | { reason: string } {
  const costCtx: AllocationContext = {
    station: ctx.station,
    grid: ctx.grid,
    tariff: ctx.tariff,
    touMc: ctx.touMc,
    baseLoadW: ctx.forecastBaseLoadW,
    committed: [],
    siteCapW: ctx.envelope.siteCapW,
  };
  return evaluateCandidate(ctx, session, snap, costCtx, kind, powerW);
}
