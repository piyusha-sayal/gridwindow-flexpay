"use client";

import { ATTENTION_STATES } from "@/components/ui";
import { formatKWh, formatUsd } from "@/domain/units";
import type { OperatorDashboard } from "@/server/services/viewService";
import { activeSessions, hasCaptureConflict, kw, needsAttention, nightSummary, scheduleStats, sumSeries } from "./metrics";

const pct = (w: number, of: number) => `${Math.min(100, Math.max(0, (w / of) * 100))}%`;

/** Three hero KPIs (load, provider-confirmed revenue, attention) and a secondary strip; every value from nightSummary(). */
export function NightKpis({ d }: { d: OperatorDashboard }) {
  const n = nightSummary(d, ATTENTION_STATES);
  const usableCapW = d.stationCapW - d.safetyHeadroomW;
  const congested = scheduleStats(d, sumSeries(activeSessions(d), d.slotCount, (s) => s.powerW), 0).congestedSlots;
  const attention = d.sessions.filter((s) => needsAttention(s, ATTENTION_STATES));
  const over = n.plannedPeakW > usableCapW;

  return (
    <section aria-label="Night summary" className="space-y-4">
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))]">
        <div className="card card-navy p-5 space-y-3">
          <p className="eyebrow">Planned peak load</p>
          <p className="text-[44px] font-semibold leading-none tracking-[-0.03em] tabular">{kw(n.plannedPeakW)}</p>
          <div className="space-y-1.5">
            <div className="relative h-2.5 rounded-full bg-white/15" aria-hidden="true">
              <span className={`absolute inset-y-0 left-0 rounded-full ${over ? "bg-red" : "bg-teal-bright"}`} style={{ width: pct(n.plannedPeakW, usableCapW) }} />
              <span className="absolute -inset-y-1 border-l-2 border-dashed border-amber" style={{ left: pct(d.congestionThresholdW, usableCapW) }} />
            </div>
            <p className="meta">
              of {kw(usableCapW)} usable cap · congestion above {kw(d.congestionThresholdW)}
            </p>
          </div>
          <p className="text-[14px] text-on-navy-body">
            Min headroom {kw(n.minHeadroomW)} · {congested} congested quarter-hour{congested === 1 ? "" : "s"}
          </p>
        </div>

        <div className="card p-5 space-y-3">
          <p className="eyebrow">Captured revenue · provider-confirmed</p>
          <p className="text-[44px] font-semibold leading-none tracking-[-0.03em] tabular">{formatUsd(n.capturedRevenueCents)}</p>
          <p className="text-[14px] text-text-2">
            {n.capturedCount} captured by provider · realized modeled contribution +{formatUsd(n.realizedContributionCents)}
          </p>
        </div>

        <div className={`card p-5 space-y-3 ${attention.length > 0 ? "border-[var(--amber-line)] bg-warn-soft" : ""}`}>
          <p className="eyebrow">Needs attention</p>
          <p className={`text-[44px] font-semibold leading-none tracking-[-0.03em] tabular ${attention.length > 0 ? "text-[var(--amber-ink)]" : ""}`}>{n.needsAttention}</p>
          {attention.length > 0 ? (
            <ul className="space-y-0.5 font-mono text-[12px]" aria-label="Reservations needing attention">
              {attention.map((s) => (
                <li key={s.id} className="[overflow-wrap:anywhere]">
                  {s.id.slice(-6)} · {s.paymentState}
                  {hasCaptureConflict(s) ? " · PROVIDER CAPTURED" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-text-2">Payment pending, declined, failed or unreconciled. Voided outages are resolved and not counted.</p>
          )}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-3 border-y border-line py-4 grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))]">
        <Stat k="Vehicles parked" v={String(n.vehiclesParked)} sub={`${n.portsInUse} of ${d.ports.length} ports occupied`} />
        <Stat k="Scheduled to charge" v={String(n.activeReservations)} sub={`of ${d.sessions.length} reservation(s)`} />
        <Stat k="Modeled energy cost" v={formatUsd(n.energyCostCents)} sub={`vs ${formatUsd(n.baselineEnergyCostCents)} if charged on arrival`} />
        <Stat k="Energy delivered" v={formatKWh(n.deliveredWh)} sub="simulated grid input" />
        <Stat k="Projected contribution" v={`+${formatUsd(n.projectedContributionCents)}`} sub="not realized until capture" />
      </dl>
    </section>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div className="min-w-0">
      <dt className="meta">{k}</dt>
      <dd className="mt-1 text-[22px] font-semibold tracking-[-0.01em] tabular">{v}</dd>
      <dd className="text-[13px] text-muted">{sub}</dd>
    </div>
  );
}
