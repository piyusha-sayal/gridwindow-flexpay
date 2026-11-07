import { formatLocalTime } from "@/domain/time";

export interface PowerSeries {
  label: string;
  color: string;
  values: readonly number[];
}

interface PowerChartProps {
  title: string;
  gridStartMs: number;
  timeZone: string;
  /** Stacked series, bottom first (watts per 15-minute slot). */
  series: readonly PowerSeries[];
  capW?: number;
  capLabel?: string;
  thresholdW?: number;
  height?: number;
  /** false = series are alternatives drawn over each other, not added together. */
  stacked?: boolean;
  /** Optional per-slot tariff (any unit); darker background = more expensive energy. */
  shade?: readonly number[];
  thresholdLabel?: string;
  /** Fixed top of the y scale (W); gridlines every `gridStepW`. */
  yMaxW?: number;
  gridStepW?: number;
  /** Stacked load above this level is drawn red (e.g. the usable cap). */
  overW?: number;
}

const SLOT_MS = 900_000;
const W = 720;

/** Accessible stacked-bar power chart with a table alternative. */
export function PowerChart({
  title,
  gridStartMs,
  timeZone,
  series,
  capW,
  capLabel = "Station cap",
  thresholdW,
  thresholdLabel = "Congestion threshold",
  height = 180,
  stacked = true,
  shade,
  yMaxW,
  gridStepW,
  overW,
}: PowerChartProps) {
  const slots = Math.max(0, ...series.map((s) => s.values.length));
  const totals = Array.from({ length: slots }, (_, i) =>
    stacked ? series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0) : Math.max(0, ...series.map((s) => s.values[i] ?? 0)),
  );
  const maxW = Math.max(yMaxW ?? 0, capW ?? 0, ...totals, 1000);
  const gridLines = gridStepW ? Array.from({ length: Math.floor(maxW / gridStepW) + 1 }, (_, k) => k * gridStepW) : [0, maxW * 0.5, maxW];
  const overSlots = overW === undefined ? 0 : totals.filter((t) => t > overW).length;
  // Bars scale to the container width; axis labels are HTML so they stay legible on narrow screens.
  const pad = { top: 8 };
  const plotH = height - 22 - pad.top;
  const barW = slots ? W / slots : 0;
  const y = (w: number) => pad.top + plotH - (w / maxW) * plotH;
  const boxH = pad.top + plotH;
  const peak = Math.max(0, ...totals);
  const summary = `${title}. Peak ${(peak / 1000).toFixed(1)} kW${capW ? ` against a ${(capW / 1000).toFixed(0)} kW cap` : ""}${overW !== undefined ? `; ${overSlots} quarter-hour(s) above it` : ""}.`;
  const ticks = Array.from({ length: slots }, (_, i) => i).filter((i) => i % 8 === 0);

  return (
    <figure className="space-y-1">
      <div className="relative" style={{ height: boxH }}>
        <svg viewBox={`0 0 ${W} ${boxH}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" role="img" aria-label={summary}>
          {shade &&
            shade.map((v, i) => {
              const lo = Math.min(...shade);
              const hi = Math.max(...shade);
              const t = hi === lo ? 0 : (v - lo) / (hi - lo);
              return <rect key={`s${i}`} x={i * barW} y={pad.top} width={barW} height={plotH} fill="var(--warn)" fillOpacity={0.03 + t * 0.14} />;
            })}
          {gridLines.map((w) => (
            <line key={w} x1={0} x2={W} y1={y(w)} y2={y(w)} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
          ))}
          {Array.from({ length: slots }, (_, i) => {
            let acc = 0;
            const width = Math.max(barW - 0.5, 0.5);
            return (
              <g key={i}>
                {series.map((s) => {
                  const v = s.values[i] ?? 0;
                  if (v <= 0) return null;
                  const top = y(acc + v);
                  const rect = <rect key={s.label} x={i * barW} y={top} width={width} height={y(acc) - top} fill={s.color} fillOpacity={stacked ? 1 : 0.6} />;
                  if (stacked) acc += v;
                  return rect;
                })}
                {stacked && overW !== undefined && acc > overW && <rect x={i * barW} y={y(acc)} width={width} height={y(overW) - y(acc)} fill="var(--red)" />}
              </g>
            );
          })}
          {thresholdW !== undefined && <line x1={0} x2={W} y1={y(thresholdW)} y2={y(thresholdW)} stroke="var(--warn)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
          {capW !== undefined && <line x1={0} x2={W} y1={y(capW)} y2={y(capW)} stroke="var(--cap)" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
        </svg>
        {gridLines.slice(1).map((w) => (
          <span key={w} aria-hidden className="absolute left-0 -translate-y-1/2 text-[11px] leading-none text-muted bg-surface/80 px-0.5 rounded tabular" style={{ top: y(w) }}>
            {(w / 1000).toFixed(0)} kW
          </span>
        ))}
        {capW !== undefined && (
          <span aria-hidden className="absolute right-0 -translate-y-full pb-0.5 font-mono text-[10px] tracking-[0.06em] text-ink bg-surface/80 px-0.5" style={{ top: y(capW) }}>
            {capLabel.toUpperCase()}
          </span>
        )}
        {thresholdW !== undefined && (
          <span aria-hidden className="absolute right-0 -translate-y-full pb-0.5 font-mono text-[10px] tracking-[0.06em] text-[var(--amber-ink)] bg-surface/80 px-0.5" style={{ top: y(thresholdW) }}>
            {thresholdLabel.toUpperCase()}
          </span>
        )}
      </div>
      <div aria-hidden className="relative h-4 text-[11px] text-muted tabular">
        {ticks.map((i) => (
          <span key={i} className={`absolute ${i % 16 === 0 ? "" : "hidden sm:inline"}`} style={{ left: `${(i / slots) * 100}%` }}>
            {formatLocalTime(gridStartMs + i * SLOT_MS, timeZone)}
          </span>
        ))}
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span aria-hidden className="inline-block w-3 h-3 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        {capW !== undefined && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="inline-block w-3 h-0.5" style={{ background: "var(--cap)" }} />
            {capLabel}
          </span>
        )}
        {shade && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="inline-block w-3 h-3 rounded-sm" style={{ background: "var(--warn)", opacity: 0.2 }} />
            Darker background = higher modeled tariff
          </span>
        )}
        {thresholdW !== undefined && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="inline-block w-3 h-0 border-t border-dashed" style={{ borderColor: "var(--amber)" }} />
            {thresholdLabel}
          </span>
        )}
        {overW !== undefined && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="inline-block w-3 h-3 rounded-sm" style={{ background: "var(--red)" }} />
            Above usable cap
          </span>
        )}
      </figcaption>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Show data table</summary>
        <div className="max-h-56 overflow-auto mt-2">
          <table className="w-full tabular">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">
                  Time
                </th>
                {series.map((s) => (
                  <th key={s.label} scope="col" className="text-right">
                    {s.label} (kW)
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: slots }, (_, i) => i)
                .filter((i) => totals[i]! > 0)
                .map((i) => (
                  <tr key={i}>
                    <th scope="row" className="text-left font-normal">
                      {formatLocalTime(gridStartMs + i * SLOT_MS, timeZone)}
                    </th>
                    {series.map((s) => (
                      <td key={s.label} className="text-right">
                        {((s.values[i] ?? 0) / 1000).toFixed(1)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
