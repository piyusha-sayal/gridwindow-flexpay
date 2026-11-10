import { formatKw, summarizeCapacity } from "./capacityStats";
import { timeLabel, type ScheduleModel } from "./scheduleModel";

const TICK_EVERY_SLOTS = 8; // two hours of quarter-hour slots

/**
 * Scheduled EV demand against the site limit, per quarter-hour, in plain React (Bryntum Community has no summary row).
 * It plots the schedule as planned, not measured consumption, and it does not include the site's base load.
 * Over-limit slots are hatched and listed as time ranges, so the state never relies on colour alone.
 */
export function CapacityStrip({ model }: { model: ScheduleModel }) {
  const s = summarizeCapacity(model.capacity);
  const topKw = Math.max(6, Math.ceil(Math.max(s.peakKw, s.maxLimitKw) / 6) * 6);
  const yTicks = [topKw, topKw / 2, 0];
  const limitText = s.minLimitKw === s.maxLimitKw ? formatKw(s.maxLimitKw) : `${formatKw(s.minLimitKw)} to ${formatKw(s.maxLimitKw)}, varies by time`;
  const range = (startMs: number, endMs: number) => `${timeLabel(startMs, model.timeZone)}–${timeLabel(endMs, model.timeZone)}`;

  return (
    <div className="space-y-4">
      <p className="text-[14px] text-text-2">
        Scheduled charging demand for every quarter-hour of the night, compared with the site limit. This is the plan, not measured consumption, and it does not include the site&apos;s base load.
      </p>

      <dl className="grid gap-px overflow-hidden rounded-[var(--r-card-sm)] border border-line bg-line sm:grid-cols-3">
        <Stat label="Peak scheduled demand" value={formatKw(s.peakKw)} />
        <Stat label="Site limit" value={limitText} />
        <Stat
          label="Over capacity"
          value={s.overloads.length === 0 ? "None" : s.overloads.map((r) => range(r.startMs, r.endMs)).join(", ")}
          note={s.overSlots > 0 ? `${s.overSlots} quarter-hour${s.overSlots === 1 ? "" : "s"}` : undefined}
          alert={s.overSlots > 0}
        />
      </dl>

      <div className="grid grid-cols-[auto_1fr] gap-x-2">
        <div className="relative w-12 text-right font-mono text-[11px] text-muted" aria-hidden="true">
          {yTicks.map((kw) => (
            <span key={kw} className="absolute right-0 -translate-y-1/2" style={{ top: `${((topKw - kw) / topKw) * 100}%` }}>
              {kw} kW
            </span>
          ))}
        </div>
        <div className="min-w-0">
          <div className="relative h-40 border-b border-l border-line-strong" role="list" aria-label="Scheduled demand against the site limit, per quarter-hour">
            {yTicks.slice(0, 2).map((kw) => (
              <div key={kw} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line" style={{ top: `${((topKw - kw) / topKw) * 100}%` }} aria-hidden="true" />
            ))}
            <div className="absolute inset-0 flex items-end gap-px">
              {model.capacity.map((c) => {
                const label = `${timeLabel(c.startMs, model.timeZone)}: ${formatKw(c.drawKw)} scheduled of ${formatKw(c.capKw)} limit${c.over ? ", over capacity" : ""}`;
                return (
                  <div key={c.slot} role="listitem" aria-label={label} title={label} className="relative h-full min-w-[3px] flex-1">
                    <div className={`absolute inset-x-0 bottom-0 rounded-t-[2px] ${c.over ? "gw-capacity-over" : "bg-teal"}`} style={{ height: `${(c.drawKw / topKw) * 100}%` }} aria-hidden="true" />
                    <div className="absolute inset-x-0 border-t-2 border-ink" style={{ bottom: `${(c.capKw / topKw) * 100}%` }} aria-hidden="true" />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="relative mt-1 h-5 font-mono text-[11px] text-muted" aria-hidden="true">
            {model.capacity.map((c) =>
              c.slot % TICK_EVERY_SLOTS === 0 ? (
                <span key={c.slot} className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0" style={{ left: `${(c.slot / model.capacity.length) * 100}%` }}>
                  {timeLabel(c.startMs, model.timeZone)}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-text-2" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-4 rounded-[2px] bg-teal" /> Scheduled demand
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="gw-capacity-over h-3 w-4 rounded-[2px]" /> Over the site limit
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block w-4 border-t-2 border-ink" /> Site limit
        </li>
      </ul>
    </div>
  );
}

function Stat({ label, value, note, alert = false }: { label: string; value: string; note?: string; alert?: boolean }) {
  return (
    <div className={`min-w-0 bg-surface px-4 py-3 ${alert ? "text-red" : ""}`}>
      <dt className="meta text-text-2!">{label}</dt>
      <dd className="mt-1 text-[17px] font-semibold tabular [overflow-wrap:anywhere]">{value}</dd>
      {note && <dd className="text-[12px] text-muted">{note}</dd>}
    </div>
  );
}
