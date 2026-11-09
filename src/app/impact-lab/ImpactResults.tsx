"use client";

import { useState } from "react";
import { PowerChart } from "@/components/PowerChart";
import { formatLocalTime } from "@/domain/time";
import { formatUsd } from "@/domain/units";
import type { OfferKind } from "@/domain/quotes";
import type { ChargeProfile, ImpactComparison, OfferView, Recommendation } from "@/server/services/impactService";
import { preferenceLabel, type PortOption } from "./scenario";

const fmtDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
};

const fmtKw = (kw: number): string => `${kw.toFixed(1)} kW`;

function labelOf(c: ImpactComparison, kind: OfferKind): string {
  return c.offers.find((o) => o.kind === kind)?.label ?? kind;
}

function recommendationText(c: ImpactComparison, rec: Recommendation): string {
  if (rec.status === "none") return rec.message;
  if (rec.status === "tie") {
    const names = rec.kinds.map((k) => labelOf(c, k));
    return `Tie: ${names.join(" and ")} both cost ${formatUsd(rec.priceCents)} for ${preferenceLabel(c.scenario.preference)}. The comparison does not pick one.`;
  }
  const offer = c.offers.find((o) => o.kind === rec.kind);
  if (!offer) return "No offer is available for this scenario.";
  return `${offer.label} is the recommendation for ${preferenceLabel(c.scenario.preference)}: ${formatUsd(offer.priceCents)}, a modeled saving of ${formatUsd(offer.savingCents)} versus Charge Now.`;
}

export function ImpactResults({ comparison: c, ports, timeZone }: { comparison: ImpactComparison; ports: readonly PortOption[]; timeZone: string }) {
  const port = ports.find((p) => p.id === c.scenario.portId);
  const offerKinds = c.offers.map((o) => o.kind);
  const recommendedKind = c.recommendation.status === "chosen" ? c.recommendation.kind : undefined;
  const [chosenKind, setChosenKind] = useState<OfferKind | null>(null);
  const chartKind = chosenKind && offerKinds.includes(chosenKind) ? chosenKind : (recommendedKind ?? offerKinds[0] ?? null);
  const chartOffer = c.offers.find((o) => o.kind === chartKind) ?? null;
  const when = (ms: number) => formatLocalTime(ms, timeZone);

  return (
    <div className="space-y-6">
      <section className="card p-5 sm:p-6 space-y-3" aria-labelledby="results-title">
        <h3 id="results-title" className="text-[18px] font-semibold">
          Results for Port {port?.label ?? c.scenario.portId}, {c.scenario.kWh} kWh
        </h3>
        <p className="text-[15px]">{recommendationText(c, c.recommendation)}</p>
        <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Comparison table (scrolls horizontally)">
          <table className="data-table text-[14px]">
            <caption className="sr-only">Charge Now and each offer, with modeled price, saving, peak power, duration, completion and feasibility</caption>
            <thead className="text-left text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3">Option</th>
                <th scope="col" className="pr-3">Price</th>
                <th scope="col" className="pr-3">Saving vs Charge Now</th>
                <th scope="col" className="pr-3">Peak power</th>
                <th scope="col" className="pr-3">Duration</th>
                <th scope="col" className="pr-3">Expected completion</th>
                <th scope="col">Feasibility</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <th scope="row" className="py-2 pr-3 text-left">Charge Now (baseline)</th>
                <td className="pr-3">{formatUsd(c.baseline.priceCents)}</td>
                <td className="pr-3">None</td>
                <td className="pr-3">{c.baseline.profile ? fmtKw(c.baseline.profile.peakKw) : "n/a"}</td>
                <td className="pr-3">{c.baseline.profile ? fmtDuration(c.baseline.profile.durationMinutes) : "n/a"}</td>
                <td className="pr-3">{c.baseline.profile ? when(c.baseline.profile.endMs) : "n/a"}</td>
                <td>{c.baseline.feasible ? "Feasible" : "Not feasible"}</td>
              </tr>
              {c.offers.map((o) => (
                <OfferRow key={o.kind} offer={o} when={when} highlighted={o.kind === recommendedKind} />
              ))}
            </tbody>
          </table>
        </div>
        {!c.baseline.feasible && c.baseline.reason && (
          <p className="text-[14px] text-muted">Charge Now is not feasible: {c.baseline.reason}</p>
        )}
      </section>

      {c.rejected.length > 0 && (
        <section className="card p-5 space-y-2" aria-labelledby="rejected-title">
          <h3 id="rejected-title" className="text-[16px] font-semibold">
            Variants not offered
          </h3>
          <ul className="space-y-1.5 text-[14px] text-text-2">
            {c.rejected.map((r) => (
              <li key={r.kind}>
                <span className="font-semibold">{r.label}:</span> {r.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-5 space-y-4" aria-labelledby="chart-title">
        <h3 id="chart-title" className="text-[16px] font-semibold">
          Charging power over time
        </h3>
        {c.baseline.profile && chartOffer ? (
          <>
            <div className="space-y-1.5">
              <label htmlFor="chart-offer" className="block text-[14px] font-semibold">
                Offer shown on the chart
              </label>
              <select id="chart-offer" className="field" value={chartOffer.kind} onChange={(e) => setChosenKind(e.target.value as OfferKind)}>
                {c.offers.map((o) => (
                  <option key={o.kind} value={o.kind}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <PowerChart
              title={`Modeled charging power: Charge Now vs ${chartOffer.label}`}
              gridStartMs={c.grid.startMs}
              timeZone={timeZone}
              stacked={false}
              series={[
                { label: "Charge Now", color: "var(--chart-bar-muted)", values: c.baseline.profile.powerW },
                { label: chartOffer.label, color: "var(--teal)", values: chartOffer.profile.powerW },
              ]}
            />
          </>
        ) : (
          <p className="text-[14px] text-muted">No offer to chart for this scenario. The chart compares Charge Now with an offer once one is available.</p>
        )}
      </section>

      <EvidenceBlock c={c} port={port} />
    </div>
  );
}

function OfferRow({ offer: o, when, highlighted }: { offer: OfferView; when: (ms: number) => string; highlighted: boolean }) {
  const p: ChargeProfile = o.profile;
  return (
    <tr className={`border-t border-border ${highlighted ? "bg-teal-tint" : ""}`}>
      <th scope="row" className="py-2 pr-3 text-left">
        {o.label}
        {highlighted && <span className="block text-xs font-semibold text-teal-ink">Recommended</span>}
      </th>
      <td className="pr-3">{formatUsd(o.priceCents)}</td>
      <td className="pr-3">{formatUsd(o.savingCents)}</td>
      <td className="pr-3">{fmtKw(p.peakKw)}</td>
      <td className="pr-3">{fmtDuration(p.durationMinutes)}</td>
      <td className="pr-3">{when(p.endMs)}</td>
      <td>Feasible</td>
    </tr>
  );
}

function EvidenceBlock({ c, port }: { c: ImpactComparison; port: PortOption | undefined }) {
  const a = c.assumptions;
  return (
    <section className="card p-5 sm:p-6 space-y-3 text-[14px] text-text-2" aria-labelledby="evidence-title">
      <h3 id="evidence-title" className="text-[18px] font-semibold text-ink">
        Evidence and limitations
      </h3>
      <dl className="space-y-2">
        <div>
          <dt className="font-semibold text-ink">Inputs</dt>
          <dd>
            Port {port?.label ?? c.scenario.portId}, {c.scenario.kWh} kWh target battery energy, plug-in {c.scenario.plugInLocal}, ready-by {c.scenario.readyByLocal}, night of{" "}
            {c.scenario.nightOf}, preference {preferenceLabel(c.scenario.preference)}.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Method</dt>
          <dd>Same quote engine as Smart Charge, on 15-minute slots, with the committed bookings for that night. No spend cap is applied.</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Baseline</dt>
          <dd>{a.baselineDefinition}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Assumptions</dt>
          <dd>
            Tariff: {a.tariff}. Economics: {a.economics}. Forecast: {a.forecast}. Provenance: {a.provenance}.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Limitations</dt>
          <dd>
            Every number here is modeled from synthetic assumptions, not measured. This comparison is hypothetical: it is not a quote, cannot be bought, and does not check whether
            the times have already passed. It makes no claim about emissions, grid impact or real-world savings.
          </dd>
        </div>
      </dl>
    </section>
  );
}
