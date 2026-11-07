import type { BenchmarkSummary, PairwiseStats, PolicyStats } from "@/domain/benchmark";
import { DEMO_STATION } from "@/domain/station";

const OPTIMIZED = "optimized";

export interface BenchmarkHighlights {
  requestCount: number;
  optimized: PolicyStats | null;
  totalViolations: number;
  baselines: PolicyStats[];
  /** Paired comparisons in which the optimized schedule cost more than the baseline. */
  costlier: Pick<PairwiseStats, "baseline" | "pairs" | "optimizedWorse">[];
}

/** Headline figures taken verbatim from the benchmark summary; nothing is derived beyond sums and lookups. */
export function benchmarkHighlights(s: BenchmarkSummary): BenchmarkHighlights {
  return {
    requestCount: s.requestCount,
    optimized: s.policies.find((p) => p.policy === OPTIMIZED) ?? null,
    totalViolations: s.policies.reduce((a, p) => a + p.violations, 0),
    baselines: s.policies.filter((p) => p.policy !== OPTIMIZED),
    costlier: s.pairwise.map(({ baseline, pairs, optimizedWorse }) => ({ baseline, pairs, optimizedWorse })),
  };
}

const kw = (w: number) => `${(w / 1000).toFixed(1)} kW`;
const usd = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
const n = (v: number) => v.toLocaleString("en-US");
/** The benchmark runs against the demo station; its usable cap is drawn on the peak chart. */
const USABLE_CAP_W = DEMO_STATION.stationCapW - DEMO_STATION.safetyHeadroomW;

interface BarRow {
  label: string;
  value: number;
  text: string;
  highlight: boolean;
}

function Bars({ title, unit, rows, markW }: { title: string; unit: string; rows: BarRow[]; markW?: { value: number; label: string } }) {
  const max = Math.max(1, markW?.value ?? 0, ...rows.map((r) => r.value));
  return (
    <figure className="card p-5 space-y-3 min-w-0">
      <figcaption>
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="meta">
          {unit} · lower is better
        </span>
      </figcaption>
      <ul className="space-y-2.5 text-[14px]">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="flex justify-between gap-2">
              <span className={r.highlight ? "font-semibold text-teal-ink" : "text-text-2"}>{r.label}</span>
              <span className="tabular">{r.text}</span>
            </div>
            <div className="relative mt-1 h-2.5 rounded-[2px] bg-[var(--chart-track)]" aria-hidden="true">
              <div className="h-full rounded-[2px]" style={{ width: `${(r.value / max) * 100}%`, background: r.highlight ? "var(--teal)" : "var(--chart-bar-muted)" }} />
              {markW && <span className="absolute -inset-y-1 border-l-2 border-ink" style={{ left: `${(markW.value / max) * 100}%` }} />}
            </div>
          </li>
        ))}
      </ul>
      {markW && <p className="meta">Black line: {markW.label}</p>}
    </figure>
  );
}

function Headline({ k, v, sub, alert = false }: { k: string; v: string; sub: string; alert?: boolean }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="meta">{k}</dt>
      <dd className={`text-[clamp(26px,3vw,34px)] font-semibold leading-tight tracking-[-0.02em] tabular ${alert ? "text-red" : ""}`}>{v}</dd>
      <dd className="text-[13px] text-muted">{sub}</dd>
    </div>
  );
}

export function Highlights({ s }: { s: BenchmarkSummary }) {
  const h = benchmarkHighlights(s);
  const o = h.optimized;
  const immediate = h.baselines.find((b) => b.policy === "immediate") ?? null;
  const unfavorable = h.costlier.reduce((a, c) => a + c.optimizedWorse, 0);
  const rows = (pick: (p: PolicyStats) => number, text: (p: PolicyStats) => string): BarRow[] =>
    s.policies.map((p) => ({ label: p.policy, value: pick(p), text: text(p), highlight: p.policy === OPTIMIZED }));

  return (
    <section aria-labelledby="hl" className="space-y-8">
      <div className="space-y-4">
        <h2 id="hl" className="eyebrow">
          At a glance
        </h2>
        <dl className="grid gap-x-5 gap-y-5 border-t border-ink pt-5 grid-cols-2 min-[700px]:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
          <Headline k="Requests simulated" v={n(h.requestCount)} sub={`${n(s.scenarioCount)} seeded scenarios`} />
          <Headline k="Optimized served" v={o ? n(o.served) : "—"} sub={o ? `${o.infeasible} infeasible` : "no optimized policy in results"} />
          <Headline k="Hard-constraint violations" v={n(h.totalViolations)} sub="reported, all policies" />
          <Headline
            k="Mean energy cost"
            v={o ? usd(o.meanEnergyCostCentsPerServed) : "—"}
            sub={immediate ? `vs ${usd(immediate.meanEnergyCostCentsPerServed)} charging immediately, per served request` : "per served request"}
          />
          <Headline k="Mean site peak" v={o ? kw(o.meanPeakSiteW) : "—"} sub={immediate ? `vs ${kw(immediate.meanPeakSiteW)} charging immediately` : "optimized"} />
          <Headline
            k="Unfavorable pairwise comparisons"
            v={n(unfavorable)}
            sub={`${h.costlier.map((c) => c.optimizedWorse).join(" + ")} where optimized cost more (${h.costlier.map((c) => `vs ${c.baseline}`).join(", ")}). Not necessarily ${n(unfavorable)} distinct requests.`}
            alert={unfavorable > 0}
          />
        </dl>
      </div>

      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))]">
        <Bars title="Mean modeled energy cost per served request" unit="USD" rows={rows((p) => p.meanEnergyCostCentsPerServed, (p) => usd(p.meanEnergyCostCentsPerServed))} />
        <Bars title="Mean site peak load" unit="kW" rows={rows((p) => p.meanPeakSiteW, (p) => kw(p.meanPeakSiteW))} markW={{ value: USABLE_CAP_W, label: `usable cap ${kw(USABLE_CAP_W)}` }} />
        <Bars title="Requests touching congestion" unit="count" rows={rows((p) => p.congestedRequests, (p) => `${n(p.congestedRequests)} of ${n(s.requestCount)}`)} />
        <Bars title="Requests not served (infeasible)" unit="count" rows={rows((p) => p.infeasible, (p) => `${n(p.infeasible)} of ${n(s.requestCount)}`)} />
      </div>

      <RequestByRequest s={s} />
      <p className="text-[13px] text-muted">Synthetic simulation, not measured field results. Full tables with denominators follow below.</p>
    </section>
  );
}

/** One 100% bar per baseline over its paired requests: cheaper / equal / more expensive (min 3px so none disappear). */
function RequestByRequest({ s }: { s: BenchmarkSummary }) {
  const seg = (count: number, pairs: number) => (count === 0 ? "0" : `max(3px, ${(count / pairs) * 100}%)`);
  return (
    <section aria-labelledby="rbr" className="card p-5 sm:p-6 space-y-5">
      <div className="space-y-1">
        <h2 id="rbr" className="text-[22px] font-semibold tracking-[-0.01em]">
          Request by request
        </h2>
        <p className="text-[14px] text-muted">Optimized versus each baseline on the same served request. Requests either policy could not serve are excluded and counted.</p>
      </div>
      <ul className="space-y-5">
        {s.pairwise.map((c) => (
          <li key={c.baseline} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-[15px] font-semibold">vs {c.baseline}</span>
              <span className="meta">
                {n(c.pairs)} paired · mean difference {usd(c.meanDeltaCents)}
              </span>
            </div>
            <div className="flex h-4 overflow-hidden rounded-[3px]" aria-hidden="true">
              <span style={{ width: seg(c.optimizedCheaper, c.pairs), background: "var(--teal)" }} />
              <span style={{ width: seg(c.equal, c.pairs), background: "#d9d5cb" }} />
              <span style={{ width: seg(c.optimizedWorse, c.pairs), background: "var(--red)" }} />
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular">
              <span className="text-teal-ink">{n(c.optimizedCheaper)} cheaper</span>
              <span className="text-text-2">{n(c.equal)} equal</span>
              <span className="text-red">{n(c.optimizedWorse)} more expensive</span>
              <span className="text-muted">
                excluded: {n(c.excludedBaselineInfeasible)} baseline infeasible, {n(c.excludedOptimizedInfeasible)} optimized infeasible
                {c.excludedBothInfeasible ? `, ${n(c.excludedBothInfeasible)} both` : ""}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
