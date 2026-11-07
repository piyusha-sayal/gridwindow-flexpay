"use client";

import { useState } from "react";
import { PowerChart } from "@/components/PowerChart";
import { formatUsd } from "@/domain/units";
import type { OperatorDashboard } from "@/server/services/viewService";
import { activeSessions, kw, scheduleStats, sumSeries } from "./metrics";

const SERIES_COLORS = ["var(--teal-ink)", "var(--teal)", "var(--teal-pale)"];
type View = "optimized" | "baseline";

/** Site load under the committed (optimized) plans versus the same drivers charging immediately. */
export function LoadPanel({ d }: { d: OperatorDashboard }) {
  const [view, setView] = useState<View>("optimized");
  const sessions = activeSessions(d);
  const portLabel = (id: string) => d.ports.find((p) => p.id === id)?.label ?? id;
  const optimized = scheduleStats(d, sumSeries(sessions, d.slotCount, (s) => s.powerW), sessions.reduce((a, s) => a + s.energyCostCents, 0));
  const withBaseline = sessions.filter((s) => s.baselinePowerW.length > 0);
  const baseline = scheduleStats(d, sumSeries(withBaseline, d.slotCount, (s) => s.baselinePowerW), withBaseline.reduce((a, s) => a + (s.baselineEnergyCostCents ?? 0), 0));
  const usableCapW = d.stationCapW - d.safetyHeadroomW;
  // Third flag: the baseline value breaks the usable cap (shown red).
  const rows: [string, string, string, boolean][] = [
    ["Peak site load", kw(baseline.peakSiteW), kw(optimized.peakSiteW), baseline.peakSiteW > usableCapW],
    ["Minimum headroom below usable cap", kw(baseline.minHeadroomW), kw(optimized.minHeadroomW), baseline.minHeadroomW < 0],
    ["Quarter-hours above congestion threshold", String(baseline.congestedSlots), String(optimized.congestedSlots), false],
    ["Modeled EV energy cost", formatUsd(baseline.energyCostCents), formatUsd(optimized.energyCostCents), false],
  ];

  return (
    <section className="card p-5 sm:p-6 space-y-5" aria-labelledby="load-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="load-title" className="text-[22px] font-semibold tracking-[-0.01em]">
            Site load
          </h2>
          <p className="meta mt-1">
            Forecast base load + committed EV charging · usable cap {kw(usableCapW)} ({kw(d.stationCapW)} cap − {kw(d.safetyHeadroomW)} safety headroom) · {sessions.length} committed session(s)
          </p>
        </div>
        <div className="seg" role="radiogroup" aria-label="Schedule shown">
          {(["optimized", "baseline"] as const).map((v) => (
            <label key={v}>
              <input type="radio" name="load-view" checked={view === v} onChange={() => setView(v)} />
              {v === "optimized" ? "Optimized" : "If charged on arrival"}
            </label>
          ))}
        </div>
      </div>
      <PowerChart
        title={view === "optimized" ? "Site load with committed optimized schedules" : "Site load if the same drivers charged immediately"}
        gridStartMs={d.gridStartMs}
        timeZone={d.timeZone}
        capW={usableCapW}
        capLabel={`Usable cap ${kw(usableCapW)}`}
        thresholdW={d.congestionThresholdW}
        thresholdLabel={`+${(d.tariff.congestionSurchargeMcPerKWh / 1000).toFixed(0)}¢/kWh above`}
        overW={usableCapW}
        yMaxW={Math.ceil((d.stationCapW * 1.1) / 15_000) * 15_000}
        gridStepW={15_000}
        height={240}
        shade={d.touMcPerKWh}
        series={[
          { label: "Base load (forecast)", color: "var(--base-load)", values: d.forecastBaseLoadW },
          ...(view === "optimized" ? sessions : withBaseline).map((s, i) => ({
            label: `Port ${portLabel(s.portId)}`,
            color: SERIES_COLORS[i % SERIES_COLORS.length]!,
            values: view === "optimized" ? s.powerW : s.baselinePowerW,
          })),
        ]}
      />
      <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Baseline versus optimized table (scrolls horizontally)">
        <table className="data-table text-sm">
          <caption className="sr-only">Baseline versus optimized schedule comparison</caption>
          <thead className="text-left text-muted">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">Metric (committed sessions)</th>
              <th scope="col" className="pr-3 font-medium">If charged on arrival</th>
              <th scope="col" className="font-medium">Optimized</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, b, o, breaks]) => (
              <tr key={k} className="border-t border-border">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                  {k}
                </th>
                <td className={`pr-3 ${breaks ? "text-red font-semibold" : ""}`}>{b}</td>
                <td className="font-semibold">{o}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TariffTable d={d} />
    </section>
  );
}

function TariffTable({ d }: { d: OperatorDashboard }) {
  const usd = (mc: number) => `$${(mc / 100_000).toFixed(3)}/kWh`;
  const hour = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">Modeled tariff periods (synthetic)</summary>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2 tabular">
        {[...d.tariff.bands]
          .sort((a, b) => b.mcPerKWh - a.mcPerKWh)
          .map((b) => (
            <li key={b.fromHour} className="flex justify-between gap-3 rounded bg-surface-2 px-2 py-1">
              <span>
                {hour(b.fromHour)}–{hour(b.toHour)}
              </span>
              <span>{usd(b.mcPerKWh)}</span>
            </li>
          ))}
      </ul>
      <p className="text-xs text-muted mt-1">
        + {usd(d.tariff.congestionSurchargeMcPerKWh)} congestion surcharge above {kw(d.congestionThresholdW)} site load. {d.tariff.label}
      </p>
    </details>
  );
}
