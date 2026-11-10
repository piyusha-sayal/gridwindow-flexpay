/**
 * Pure mapping from the persisted schedule read model to what the operator schedule shows.
 * Display only: nothing here decides a plan, a price or a capacity. Every value comes from the server view.
 */
import { SLOT_MS } from "@/domain/units";
import type { ScheduleDisruptionView, ScheduleSessionView, ScheduleView } from "@/server/services/scheduleView";

/** PROPOSAL bursts are a pending recovery proposal read from its persisted run; they are not a committed version. */
export type ScheduleLane = "CURRENT" | "ORIGINAL" | "PROPOSAL";

export interface PowerBurst {
  id: string;
  sessionId: string;
  portId: string;
  lane: ScheduleLane;
  /** True when this burst belongs to a recovered (not original) version of the plan. */
  recovered: boolean;
  startMs: number;
  endMs: number;
  peakKw: number;
  kWh: number;
  /** Energy delivered after the effective departure. Should never be true for a committed plan. */
  pastDeparture: boolean;
}

export interface SessionSummary {
  sessionId: string;
  portId: string;
  portLabel: string;
  plugInMs: number;
  departMs: number;
  effectiveDepartMs: number;
  departureShortened: boolean;
  currentVersion: number;
  recovered: boolean;
  originalKwh: number;
  currentKwh: number;
  peakKw: number;
  serviceState: ScheduleSessionView["serviceState"];
  paymentState: ScheduleSessionView["paymentState"];
}

export interface CapacityBucket {
  slot: number;
  startMs: number;
  drawKw: number;
  capKw: number;
  over: boolean;
}

/** A recovery proposal that is awaiting driver approval, read from its persisted run. */
export interface ProposalInput {
  runId: string;
  reservationId: string;
  portId: string;
  powerW: readonly number[];
  effectiveDepartMs: number;
}

export interface ScheduleModel {
  nightOf: string;
  timeZone: string;
  gridStartMs: number;
  gridEndMs: number;
  resources: { id: string; label: string; tier: string; ratedKw: number }[];
  bursts: PowerBurst[];
  occupancy: { id: string; sessionId: string; portId: string; startMs: number; endMs: number }[];
  deadlines: { sessionId: string; portId: string; atMs: number; shortened: boolean }[];
  capacity: CapacityBucket[];
  disruptions: { eventId: string; type: ScheduleDisruptionView["type"]; atMs: number; runStatus: string | null; runReason: string | null }[];
  /** Proposals awaiting driver approval. They are drawn as PROPOSAL bursts and are never part of a committed version. */
  pendingProposals: number;
  sessions: SessionSummary[];
  /** Revision key: changes whenever a session's committed version, the disruption set or a pending proposal changes. */
  revision: string;
}

const MS_PER_HOUR = 3_600_000;
const W_TO_KW = 1_000;

/** Energy in kWh for a sum of per-slot watts. Integer arithmetic until the final division. */
export function slotsToKwh(sumW: number): number {
  return (sumW * SLOT_MS) / (MS_PER_HOUR * W_TO_KW);
}

/** Contiguous nonzero-power slots become one burst. Power is in watts per slot. */
export function deriveBursts(
  session: Pick<ScheduleSessionView, "reservationId" | "portId" | "effectiveDepartMs">,
  powerW: readonly number[],
  lane: ScheduleLane,
  gridStartMs: number,
  recovered: boolean,
): PowerBurst[] {
  const bursts: PowerBurst[] = [];
  let i = 0;
  while (i < powerW.length) {
    if ((powerW[i] ?? 0) <= 0) {
      i++;
      continue;
    }
    const first = i;
    while (i < powerW.length && (powerW[i] ?? 0) > 0) i++;
    const slice = powerW.slice(first, i);
    const startMs = gridStartMs + first * SLOT_MS;
    const endMs = gridStartMs + i * SLOT_MS;
    bursts.push({
      id: `${session.reservationId}:${lane}:${first}`,
      sessionId: session.reservationId,
      portId: session.portId,
      lane,
      recovered,
      startMs,
      endMs,
      peakKw: Math.max(...slice) / W_TO_KW,
      kWh: slotsToKwh(slice.reduce((a, w) => a + w, 0)),
      pastDeparture: endMs > session.effectiveDepartMs,
    });
  }
  return bursts;
}

/** The version the operator sees as current: the latest committed version, or the agreed plan if none. */
export function currentPowerW(session: ScheduleSessionView): number[] {
  const version = session.versions.find((v) => v.version === session.currentVersion);
  return version ? version.powerW : session.originalPowerW;
}

/** Site cap in each slot: the station cap, lowered from each SITE_CAP_REDUCTION's effective slot onward. */
export function siteCapKwPerSlot(view: ScheduleView): number[] {
  const slots = Math.max(0, ...view.sessions.map((s) => s.originalPowerW.length));
  const caps = new Array<number>(slots).fill(view.stationCapW / W_TO_KW);
  for (const d of view.disruptions) {
    if (d.type !== "SITE_CAP_REDUCTION") continue;
    const capKw = (d.params.stationCapW ?? view.stationCapW) / W_TO_KW;
    for (let i = d.effectiveSlot; i < slots; i++) caps[i] = Math.min(caps[i]!, capKw);
  }
  return caps;
}

function buildCapacity(view: ScheduleView, sessions: readonly ScheduleSessionView[]): CapacityBucket[] {
  const caps = siteCapKwPerSlot(view);
  return caps.map((capKw, slot) => {
    const sumW = sessions.reduce((a, s) => a + (currentPowerW(s)[slot] ?? 0), 0);
    const drawKw = sumW / W_TO_KW;
    return { slot, startMs: view.gridStartMs + slot * SLOT_MS, drawKw, capKw, over: sumW / W_TO_KW > capKw };
  });
}

function summarise(s: ScheduleSessionView): SessionSummary {
  const current = currentPowerW(s);
  return {
    sessionId: s.reservationId,
    portId: s.portId,
    portLabel: s.portLabel,
    plugInMs: s.plugInMs,
    departMs: s.departMs,
    effectiveDepartMs: s.effectiveDepartMs,
    departureShortened: s.effectiveDepartMs < s.departMs,
    currentVersion: s.currentVersion,
    recovered: s.currentVersion > 1,
    originalKwh: slotsToKwh(s.originalPowerW.reduce((a, w) => a + w, 0)),
    currentKwh: slotsToKwh(current.reduce((a, w) => a + w, 0)),
    peakKw: Math.max(0, ...current) / W_TO_KW,
    serviceState: s.serviceState,
    paymentState: s.paymentState,
  };
}

/** Maps the read model to chart-ready records. Both lanes are always produced so a toggle never refetches. */
export function buildScheduleModel(view: ScheduleView, proposals: readonly ProposalInput[] = []): ScheduleModel {
  const sessionById = new Map(view.sessions.map((s) => [s.reservationId, s]));
  const bursts = view.sessions.flatMap((s) => [
    ...deriveBursts(s, s.originalPowerW, "ORIGINAL", view.gridStartMs, false),
    ...deriveBursts(s, currentPowerW(s), "CURRENT", view.gridStartMs, s.currentVersion > 1),
  ]);
  for (const p of proposals) {
    const session = sessionById.get(p.reservationId);
    if (!session) continue;
    bursts.push(...deriveBursts({ reservationId: p.runId, portId: p.portId, effectiveDepartMs: p.effectiveDepartMs }, p.powerW, "PROPOSAL", view.gridStartMs, true));
  }
  const capacity = buildCapacity(view, view.sessions);
  return {
    nightOf: view.nightOf,
    timeZone: view.timeZone,
    gridStartMs: view.gridStartMs,
    gridEndMs: view.gridStartMs + capacity.length * SLOT_MS,
    resources: view.ports.map((p) => ({ id: p.id, label: p.label, tier: p.tier, ratedKw: p.maxPowerW / W_TO_KW })),
    bursts,
    occupancy: view.sessions.map((s) => ({ id: `${s.reservationId}:occupancy`, sessionId: s.reservationId, portId: s.portId, startMs: s.plugInMs, endMs: s.effectiveDepartMs })),
    deadlines: view.sessions.map((s) => ({ sessionId: s.reservationId, portId: s.portId, atMs: s.effectiveDepartMs, shortened: s.effectiveDepartMs < s.departMs })),
    capacity,
    disruptions: view.disruptions.map((d) => ({
      eventId: d.eventId,
      type: d.type,
      atMs: view.gridStartMs + d.effectiveSlot * SLOT_MS,
      runStatus: d.runStatus,
      runReason: d.runReason,
    })),
    sessions: view.sessions.map(summarise),
    pendingProposals: proposals.filter((p) => sessionById.has(p.reservationId)).length,
    revision: revisionKey(view, proposals),
  };
}

/** Changes whenever a session's committed version, the disruption set or a pending proposal changes. */
export function revisionKey(view: Pick<ScheduleView, "sessions" | "disruptions">, proposals: readonly ProposalInput[] = []): string {
  const versions = view.sessions.map((s) => `${s.reservationId}@${s.currentVersion}`).sort();
  const disruptions = view.disruptions.map((d) => `${d.eventId}:${d.runStatus ?? "-"}`).sort();
  const pending = proposals.map((p) => `${p.runId}:${p.powerW.join(".")}`).sort();
  return `${versions.join(",")}|${disruptions.join(",")}|${pending.join(",")}`;
}

/** Bursts for one lane, the only data the timeline draws. */
export function burstsForLane(model: ScheduleModel, lane: ScheduleLane): PowerBurst[] {
  return model.bursts.filter((b) => b.lane === lane);
}

export function timeLabel(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(ms));
}

/** Plain-English summary for aria-label and the screen-reader text. */
export function scheduleSummary(model: ScheduleModel): string {
  const over = model.capacity.filter((c) => c.over).length;
  const recovered = model.sessions.filter((s) => s.recovered).length;
  const shortened = model.sessions.filter((s) => s.departureShortened).length;
  const pending = model.pendingProposals > 0 ? ` ${model.pendingProposals} proposal(s) awaiting driver approval, not committed.` : "";
  return `${model.sessions.length} sessions on ${model.resources.length} ports. ${recovered} recovered, ${shortened} with shortened departure, ${over} time slot(s) over the site cap.${pending}`;
}
