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
      <div className="stagger grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))]">
        <div className="card card-navy kpi-tile p-5 space-y-3">
          <p className="eyebrow">Planned peak load</p>
          <p className="kpi-figure num-rise text-[clamp(40px,4.4vw,52px)] font-semibold leading-none tracking-[-0.04em] tabular">{kw(n.plannedPeakW)}</p>
          <div className="space-y-1.5">
            <div className="load-track relative h-3 rounded-full bg-white/15" aria-hidden="true">
              <span className={`load-fill absolute inset-y-0 left-0 rounded-full ${over ? "is-over bg-red" : "bg-teal-bright"}`} style={{ width: pct(n.plannedPeakW, usableCapW) }} />
              <span className="load-mark absolute -inset-y-1 border-l-2 border-dashed border-amber" style={{ left: pct(d.congestionThresholdW, usableCapW) }} />
            </div>
            <p className="meta">
              of {kw(usableCapW)} usable cap · congestion above {kw(d.congestionThresholdW)}
            </p>
          </div>
          <p className="text-[14px] text-on-navy-body">
            Min headroom {kw(n.minHeadroomW)} · {congested} congested quarter-hour{congested === 1 ? "" : "s"}
          </p>
        </div>

        <div className="card kpi-tile p-5 space-y-3">
          <p className="eyebrow">Captured revenue · provider-confirmed</p>
          <p className="kpi-figure num-rise text-gradient text-[clamp(40px,4.4vw,52px)] font-semibold leading-none tracking-[-0.04em] tabular">{formatUsd(n.capturedRevenueCents)}</p>
          <p className="text-[14px] text-text-2">
            {n.capturedCount} captured by provider · realized modeled contribution +{formatUsd(n.realizedContributionCents)}
          </p>
        </div>

        <div className={`card kpi-tile p-5 space-y-3 ${attention.length > 0 ? "is-attention pulse-ring border-[var(--amber-line)] bg-warn-soft" : ""}`}>
          <p className="eyebrow">Needs attention</p>
          <p className={`kpi-figure num-rise text-[clamp(40px,4.4vw,52px)] font-semibold leading-none tracking-[-0.04em] tabular ${attention.length > 0 ? "text-warn" : ""}`}>{n.needsAttention}</p>
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

      <dl className="stat-strip stagger grid gap-x-6 gap-y-3 py-4 grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))]">
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
    <div className="stat min-w-0">
      <dt className="meta">{k}</dt>
      <dd className="stat-value mt-1 text-[22px] font-semibold tabular">{v}</dd>
      <dd className="text-[13px] text-muted">{sub}</dd>
    </div>
  );
}
