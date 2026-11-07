import type { BenchmarkSummary } from "@/domain/benchmark";
import { Highlights } from "./Highlights";
import { loadSummary } from "./summary";

export const metadata = { title: "Benchmark · GridWindow FlexPay" };
export const dynamic = "force-dynamic";

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);
const usd = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

export default async function BenchmarkPage() {
  const s = await loadSummary();
  if (!s) {
    return (
      <div className="card p-6 space-y-2">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Benchmark</h1>
        <p>No benchmark results found. Run <code>npm run benchmark</code> to generate <code>artifacts/benchmark/summary.json</code>.</p>
      </div>
    );
  }
  return (
    <div className="space-y-10">
      <header className="space-y-3 max-w-[820px]">
        <p className="meta break-words">
          {s.provenance} · generated {s.generatedAt} · seeds {s.seedRange}
        </p>
        <h1 className="font-semibold tracking-[-0.03em] leading-[1.05] text-[clamp(32px,4.6vw,52px)]">
          {s.scenarioCount.toLocaleString("en-US")} synthetic nights. {s.requestCount.toLocaleString("en-US")} charging requests.
        </h1>
        <p className="text-[17px] text-text-2">
          Each seeded night replays the same requests under every scheduling policy, so differences come from the policy alone. This is a simulation, not measured field data.
        </p>
      </header>

      <Highlights s={s} />

      <OfferEconomics s={s} />

      <section className="space-y-4" aria-labelledby="full">
        <h2 id="full" className="text-[22px] font-semibold tracking-[-0.01em]">
          Full results
        </h2>
        <div className="card p-5 space-y-3">
          <h3 id="t1" className="text-[16px] font-semibold">
            Policy comparison (identical requests, sequential arrival)
          </h3>
          <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Policy comparison table (scrolls horizontally)">
            <table className="data-table text-[14px]">
              <caption className="sr-only">Per-policy results</caption>
              <thead className="text-left text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3">Policy</th>
                  <th scope="col" className="pr-3">Requests served</th>
                  <th scope="col" className="pr-3">Infeasible</th>
                  <th scope="col" className="pr-3">Hard-constraint violations</th>
                  <th scope="col" className="pr-3">Mean modeled energy cost / served request</th>
                  <th scope="col" className="pr-3">Mean site peak (kW)</th>
                  <th scope="col">Requests touching congestion</th>
                </tr>
              </thead>
              <tbody>
                {s.policies.map((p) => (
                  <tr key={p.policy} className={`border-t border-border ${p.policy === "optimized" ? "bg-teal-tint" : ""}`}>
                    <th scope="row" className="py-2 pr-3 text-left">
                      {p.policy}
                    </th>
                    <td className="pr-3">
                      {p.served} ({pct(p.served, s.requestCount)})
                    </td>
                    <td className="pr-3">
                      {p.infeasible}
                      {p.infeasibleReasons && Object.keys(p.infeasibleReasons).length > 0 && (
                        <span className="block text-xs text-muted">{Object.entries(p.infeasibleReasons).map(([k, v]) => `${k} ${v}`).join(", ")}</span>
                      )}
                    </td>
                    <td className="pr-3">{p.violations}</td>
                    <td className="pr-3">{usd(p.meanEnergyCostCentsPerServed)}</td>
                    <td className="pr-3">{(p.meanPeakSiteW / 1000).toFixed(2)}</td>
                    <td>{p.congestedRequests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-5 space-y-3">
          <h3 id="t2" className="text-[16px] font-semibold">
            Optimized vs. each baseline (same served request, paired)
          </h3>
          <p className="text-[14px] text-muted">
            A request is paired only when both policies served it. Every request is accounted for: paired + excluded = {s.requestCount}.
          </p>
          <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Pairwise comparison table (scrolls horizontally)">
            <table className="data-table text-[14px]">
              <caption className="sr-only">Pairwise comparison with denominators</caption>
              <thead className="text-left text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3">Baseline</th>
                  <th scope="col" className="pr-3">Requests</th>
                  <th scope="col" className="pr-3">Paired</th>
                  <th scope="col" className="pr-3">Excluded: baseline infeasible</th>
                  <th scope="col" className="pr-3">Excluded: optimized infeasible</th>
                  <th scope="col" className="pr-3">Optimized cheaper</th>
                  <th scope="col" className="pr-3">Equal</th>
                  <th scope="col" className="pr-3">Optimized more expensive</th>
                  <th scope="col">Mean difference (optimized − baseline)</th>
                </tr>
              </thead>
              <tbody>
                {s.pairwise.map((c) => (
                  <tr key={c.baseline} className="border-t border-border">
                    <th scope="row" className="py-2 pr-3 text-left">
                      {c.baseline}
                    </th>
                    <td className="pr-3">{c.requests ?? s.requestCount}</td>
                    <td className="pr-3">{c.pairs}</td>
                    <td className="pr-3">{c.excludedBaselineInfeasible ?? "n/a"}</td>
                    <td className="pr-3">{c.excludedOptimizedInfeasible ?? "n/a"}</td>
                    <td className="pr-3">
                      {c.optimizedCheaper} ({pct(c.optimizedCheaper, c.pairs)})
                    </td>
                    <td className="pr-3">{c.equal}</td>
                    <td className="pr-3">
                      <strong>{c.optimizedWorse}</strong>
                    </td>
                    <td>{usd(c.meanDeltaCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="space-y-3 max-w-[820px]" aria-labelledby="m">
        <h2 id="m" className="text-[22px] font-semibold tracking-[-0.01em]">
          Methodology
        </h2>
        <ol className="list-decimal space-y-2 pl-6 text-[14px] text-text-2">
          {s.methodology.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** Three separate per-offer measures; they are not parts of one total. */
function OfferEconomics({ s }: { s: BenchmarkSummary }) {
  const o = s.offers;
  const measures = [
    { k: "Driver saving", v: usd(o.meanDiscountCents), def: "List price − offer price." },
    { k: "Operator gross energy saving", v: o.meanEnergyCostSavingCents !== undefined ? usd(o.meanEnergyCostSavingCents) : "n/a", def: "Immediate − flexible modeled energy cost." },
    { k: "Operator contribution improvement", v: usd(o.meanOperatorImprovementCents), def: "Net, after the driver discount, assumed payment fee and operating cost." },
  ];
  return (
    <section className="card card-navy p-5 sm:p-7 space-y-6" aria-labelledby="t3">
      <div className="space-y-1">
        <h2 id="t3" className="text-[22px] font-semibold tracking-[-0.01em]">
          Offer economics
        </h2>
        <p className="text-[14px] text-on-navy-body">
          Means per published offer ({o.offerCount ?? "n/a"} offers). Three separate measures, not parts of one total.
        </p>
      </div>
      <dl className="grid gap-6 grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))]">
        {measures.map((m) => (
          <div key={m.k} className="space-y-1 border-t border-white/20 pt-3">
            <dt className="eyebrow">{m.k}</dt>
            <dd className="text-[36px] font-semibold leading-none tracking-[-0.02em] tabular">{m.v}</dd>
            <dd className="text-[13px] text-on-navy-body">{m.def}</dd>
          </div>
        ))}
      </dl>
      <ul className="space-y-1 text-[14px] text-on-navy-body tabular">
        <li>Requests with ≥ 1 published win-win offer: {o.withOffer} ({pct(o.withOffer, s.requestCount)})</li>
        <li>Requests with ≥ 2 offers: {o.withTwoOrMore}</li>
        <li>Requests with zero offers: {o.withZero}, reasons: {Object.entries(o.zeroReasons).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}</li>
        <li>Offers failing independent validators after generation: {o.validatorFailures}</li>
      </ul>
    </section>
  );
}
