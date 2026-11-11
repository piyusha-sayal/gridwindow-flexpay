import { holdsCapacity } from "@/domain/capacity";
import { economicOutcome } from "@/domain/paymentState";
import { SLOTS_PER_HOUR } from "@/domain/units";
import type { DashboardSession, OperatorDashboard } from "@/server/services/viewService";

/** Sessions that hold (or held) station capacity on this night. */
export function activeSessions(d: OperatorDashboard): DashboardSession[] {
  return d.sessions.filter(holdsCapacity);
}

export interface RowProvider {
  /** Short label for the row badge. */
  label: string;
  /** True when the row was created under a different provider mode than the one this server runs. */
  mismatch: boolean;
  /** Plain-English note for the mismatch, or null. Actions on a mismatched row are refused by the server (409). */
  note: string | null;
}

const MODE_LABEL: Record<string, string> = { PAYPAL_SANDBOX: "PayPal Sandbox", MOCK: "MOCK (simulated)" };

/** Provider identity of one reservation row against the provider mode this server runs. Display only. */
export function rowProvider(s: Pick<DashboardSession, "providerMode">, runtimeMode: string): RowProvider {
  const label = MODE_LABEL[s.providerMode] ?? s.providerMode;
  const mismatch = s.providerMode !== runtimeMode;
  return { label, mismatch, note: mismatch ? `Created under ${label}, but this server runs ${MODE_LABEL[runtimeMode] ?? runtimeMode}. Actions are unavailable here.` : null };
}

export function sumSeries(sessions: DashboardSession[], slots: number, pick: (s: DashboardSession) => readonly number[]): number[] {
  return Array.from({ length: slots }, (_, i) => sessions.reduce((sum, s) => sum + (pick(s)[i] ?? 0), 0));
}

export interface ScheduleStats {
  peakSiteW: number;
  minHeadroomW: number;
  congestedSlots: number;
  energyCostCents: number;
}

/** Site-level stats for one schedule set (optimized = committed plans, baseline = immediate plans). */
export function scheduleStats(d: OperatorDashboard, evW: number[], energyCostCents: number): ScheduleStats {
  const site = evW.map((w, i) => w + (d.forecastBaseLoadW[i] ?? 0));
  const usableCap = d.stationCapW - d.safetyHeadroomW;
  return {
    peakSiteW: Math.max(0, ...site),
    minHeadroomW: Math.min(...site.map((w) => usableCap - w)),
    congestedSlots: site.filter((w) => w > d.congestionThresholdW).length,
    energyCostCents,
  };
}

export const kw = (w: number) => `${(w / 1000).toFixed(1)} kW`;

/** The provider recorded a capture although the local state is not CAPTURED: money moved, review needed. */
export const hasCaptureConflict = (s: Pick<DashboardSession, "paymentState" | "providerCapturedCents">) => s.providerCapturedCents !== null && s.paymentState !== "CAPTURED";

export const needsAttention = (s: Pick<DashboardSession, "paymentState" | "providerCapturedCents">, attentionStates: ReadonlySet<string>) =>
  attentionStates.has(s.paymentState) || hasCaptureConflict(s);

export interface NightSummary {
  activeReservations: number;
  vehiclesParked: number;
  portsInUse: number;
  plannedPeakW: number;
  stationCapW: number;
  minHeadroomW: number;
  energyCostCents: number;
  baselineEnergyCostCents: number;
  /** Modeled contribution of reservations whose payment is not final yet (not realized). */
  projectedContributionCents: number;
  /** Modeled contribution of provider-captured reservations only. */
  realizedContributionCents: number;
  capturedRevenueCents: number;
  capturedCount: number;
  /** Simulated grid energy actually delivered across all reservations (Wh). */
  deliveredWh: number;
  needsAttention: number;
}

/** Operator KPIs for one night, all from the dashboard data (modeled money, planned kW). */
export function nightSummary(d: OperatorDashboard, attentionStates: ReadonlySet<string>): NightSummary {
  const sessions = activeSessions(d);
  const opt = scheduleStats(d, sumSeries(sessions, d.slotCount, (s) => s.powerW), 0);
  // Provider-confirmed money, including captures the local state does not reflect yet.
  const captured = d.sessions.filter((s) => s.paymentState === "CAPTURED" || s.providerCapturedCents !== null);
  return {
    activeReservations: sessions.filter((s) => s.serviceState === "SCHEDULED").length,
    vehiclesParked: sessions.length,
    portsInUse: new Set(sessions.map((s) => s.portId)).size,
    plannedPeakW: opt.peakSiteW,
    stationCapW: d.stationCapW,
    minHeadroomW: opt.minHeadroomW,
    energyCostCents: sessions.reduce((a, s) => a + s.energyCostCents, 0),
    baselineEnergyCostCents: sessions.reduce((a, s) => a + (s.baselineEnergyCostCents ?? s.energyCostCents), 0),
    projectedContributionCents: sumBy(sessions, (s) => (economicOutcome(s.paymentState) === "PROJECTED" ? s.operatorImprovementCents : 0)),
    realizedContributionCents: sumBy(captured, (s) => (s.paymentState === "CAPTURED" ? s.operatorImprovementCents : 0)),
    capturedRevenueCents: sumBy(captured, (s) => s.providerCapturedCents ?? s.amountCents),
    capturedCount: captured.length,
    deliveredWh: sumBy(d.sessions, (s) => (s.deliveredW ?? []).reduce((a, w) => a + w, 0)) / SLOTS_PER_HOUR,
    needsAttention: d.sessions.filter((s) => needsAttention(s, attentionStates)).length,
  };
}

const sumBy = (sessions: DashboardSession[], pick: (s: DashboardSession) => number) => sessions.reduce((a, s) => a + pick(s), 0);
