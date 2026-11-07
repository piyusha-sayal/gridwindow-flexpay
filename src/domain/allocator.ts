/**
 * Single-session power allocator over a shared 15-minute slot grid.
 * Respects: port occupancy (no double-booking a connector), per-port kW cap,
 * station aggregate cap after forecast base load and safety headroom, plug-in/departure window.
 */
import type { TariffModel } from "./forecast";
import { findPort, occupancyOverlaps, type ChargeRequest, type SessionPlan, type StationConfig } from "./station";
import { localParts, slotStartMs, type SlotGrid } from "./time";
import { batteryMilliWhFromGridWh, requiredGridWh, SLOT_MS, SLOTS_PER_HOUR } from "./units";

export interface AllocationContext {
  station: StationConfig;
  grid: SlotGrid;
  tariff: TariffModel;
  /** Time-of-use price per slot (mc/kWh). */
  touMc: readonly number[];
  /** Forecast base (non-EV) site load per slot (W). */
  baseLoadW: readonly number[];
  /** Already committed sessions on this grid. */
  committed: readonly SessionPlan[];
}

export type AllocationPolicy =
  | { kind: "immediate" }
  | { kind: "static_offpeak"; startLocalHour: number }
  | { kind: "greedy_tariff" }
  | { kind: "optimized"; latestEndMs?: number; maxPowerW?: number };

export type InfeasibleReason =
  | "INVALID_REQUEST"
  | "UNKNOWN_PORT"
  | "PORT_OCCUPIED"
  | "OUTSIDE_HORIZON"
  | "INSUFFICIENT_CAPACITY";

export type AllocationResult =
  | {
      ok: true;
      powerW: number[];
      gridWh: number;
      batteryMilliWh: number;
      costMicrocents: number;
      firstActiveSlot: number;
      lastActiveSlot: number;
    }
  | { ok: false; reason: InfeasibleReason; detail: string };

export function committedLoadW(committed: readonly SessionPlan[], slotCount: number): number[] {
  const load = new Array<number>(slotCount).fill(0);
  for (const plan of committed) {
    for (let i = 0; i < slotCount; i++) load[i]! += plan.powerW[i] ?? 0;
  }
  return load;
}

/** Slots fully inside [fromMs, toMs). */
export function slotsWithin(grid: SlotGrid, fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < grid.slotCount; i++) {
    const start = slotStartMs(grid, i);
    if (start >= fromMs && start + SLOT_MS <= toMs) out.push(i);
  }
  return out;
}

function congestionThresholdW(ctx: AllocationContext): number {
  return Math.floor((ctx.station.stationCapW * ctx.tariff.congestionThresholdBp) / 10_000);
}

/**
 * Cost attributable to a session in microcents (1e-6 cent): TOU energy plus the
 * congestion surcharge on the part of site load this session pushes above the threshold.
 */
export function sessionCostMicrocents(ctx: AllocationContext, powerW: readonly number[], otherLoadW: readonly number[]): number {
  const threshold = congestionThresholdW(ctx);
  let wattMc = 0;
  for (let i = 0; i < ctx.grid.slotCount; i++) {
    const x = powerW[i] ?? 0;
    if (x === 0) continue;
    const other = (ctx.baseLoadW[i] ?? 0) + (otherLoadW[i] ?? 0);
    const over = Math.max(0, other + x - threshold) - Math.max(0, other - threshold);
    wattMc += x * (ctx.touMc[i] ?? 0) + over * ctx.tariff.congestionSurchargeMcPerKWh;
  }
  // W * mc/kWh over a 15-min slot = (W / 4) Wh * mc/kWh = microcents.
  return Math.ceil(wattMc / SLOTS_PER_HOUR);
}

function validateRequest(ctx: AllocationContext, req: ChargeRequest): AllocationResult | null {
  const ints = [req.plugInMs, req.departMs, req.targetBatteryWh, req.efficiencyBp, req.spendCapCents];
  if (!ints.every(Number.isSafeInteger) || req.targetBatteryWh <= 0 || req.departMs <= req.plugInMs || req.efficiencyBp <= 0 || req.efficiencyBp > 10_000) {
    return { ok: false, reason: "INVALID_REQUEST", detail: "request fields out of range" };
  }
  if (!findPort(ctx.station, req.portId)) return { ok: false, reason: "UNKNOWN_PORT", detail: req.portId };
  const clash = ctx.committed.find((c) => c.portId === req.portId && occupancyOverlaps(c, req));
  if (clash) return { ok: false, reason: "PORT_OCCUPIED", detail: `port ${req.portId} is occupied by another parked vehicle` };
  return null;
}

function roundUpToStep(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

export function allocate(ctx: AllocationContext, req: ChargeRequest, policy: AllocationPolicy): AllocationResult {
  const invalid = validateRequest(ctx, req);
  if (invalid) return invalid;
  const { station, grid } = ctx;
  const port = findPort(station, req.portId)!;
  const step = station.powerStepW;
  const endLimit = policy.kind === "optimized" && policy.latestEndMs !== undefined ? Math.min(req.departMs, policy.latestEndMs) : req.departMs;
  let allowed = slotsWithin(grid, req.plugInMs, endLimit);
  if (allowed.length === 0) return { ok: false, reason: "OUTSIDE_HORIZON", detail: "no full slot between plug-in and departure" };
  if (policy.kind === "static_offpeak") {
    const startIdx = allowed.find((i) => localParts(slotStartMs(grid, i), grid.timeZone).hour === policy.startLocalHour);
    allowed = startIdx === undefined ? [] : allowed.filter((i) => i >= startIdx);
  }

  const other = committedLoadW(ctx.committed, grid.slotCount);
  const portCap = Math.min(port.maxPowerW, policy.kind === "optimized" && policy.maxPowerW ? policy.maxPowerW : port.maxPowerW);
  const avail = new Array<number>(grid.slotCount).fill(0);
  for (const i of allowed) {
    const headroom = station.stationCapW - station.safetyHeadroomW - (ctx.baseLoadW[i] ?? 0) - (other[i] ?? 0);
    avail[i] = Math.max(0, Math.floor(Math.min(portCap, headroom) / step) * step);
  }

  const needGridWh = requiredGridWh(req.targetBatteryWh, req.efficiencyBp);
  const powerW = new Array<number>(grid.slotCount).fill(0);
  let remainingWh = needGridWh;

  if (policy.kind === "optimized") {
    remainingWh = fillByMarginalCost(ctx, allowed, avail, other, powerW, needGridWh);
  } else {
    const order =
      policy.kind === "greedy_tariff"
        ? [...allowed].sort((a, b) => (ctx.touMc[a] ?? 0) - (ctx.touMc[b] ?? 0) || a - b)
        : allowed;
    for (const i of order) {
      if (remainingWh <= 0) break;
      const take = Math.min(avail[i] ?? 0, roundUpToStep(remainingWh * SLOTS_PER_HOUR, step));
      powerW[i] = take;
      remainingWh -= take / SLOTS_PER_HOUR;
    }
  }

  if (remainingWh > 0) {
    return { ok: false, reason: "INSUFFICIENT_CAPACITY", detail: `short by ${remainingWh} grid Wh under ${policy.kind}` };
  }
  return summarize(ctx, powerW, other, req.efficiencyBp);
}

/** Greedy on marginal cost per power step: optimal for separable convex per-slot costs. */
function fillByMarginalCost(
  ctx: AllocationContext,
  allowed: readonly number[],
  avail: readonly number[],
  other: readonly number[],
  powerW: number[],
  needGridWh: number,
): number {
  const step = ctx.station.powerStepW;
  const threshold = congestionThresholdW(ctx);
  const surcharge = ctx.tariff.congestionSurchargeMcPerKWh;
  let remainingWh = needGridWh;
  while (remainingWh > 0) {
    let best = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const i of allowed) {
      const x = powerW[i] ?? 0;
      if (x + step > (avail[i] ?? 0)) continue;
      const load = (ctx.baseLoadW[i] ?? 0) + (other[i] ?? 0) + x;
      const over = Math.max(0, load + step - threshold) - Math.max(0, load - threshold);
      const marginal = step * (ctx.touMc[i] ?? 0) + over * surcharge;
      if (marginal < bestCost) {
        bestCost = marginal;
        best = i;
      }
    }
    if (best < 0) break;
    powerW[best] = (powerW[best] ?? 0) + step;
    remainingWh -= step / SLOTS_PER_HOUR;
  }
  return remainingWh;
}

function summarize(ctx: AllocationContext, powerW: number[], other: readonly number[], efficiencyBp: number): AllocationResult {
  const gridWh = powerW.reduce((s, w) => s + w / SLOTS_PER_HOUR, 0);
  const active = powerW.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0);
  return {
    ok: true,
    powerW,
    gridWh,
    batteryMilliWh: batteryMilliWhFromGridWh(gridWh, efficiencyBp),
    costMicrocents: sessionCostMicrocents(ctx, powerW, other),
    firstActiveSlot: active[0] ?? -1,
    lastActiveSlot: active[active.length - 1] ?? -1,
  };
}
