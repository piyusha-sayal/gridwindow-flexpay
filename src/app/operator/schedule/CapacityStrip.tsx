import { timeLabel, type ScheduleModel } from "./scheduleModel";

/**
 * Site draw against the site cap per time slot, in plain React (Bryntum Community has no summary row).
 * Over-cap slots carry a hatched pattern and the words "over cap", so the state is not colour alone.
 */
export function CapacityStrip({ model }: { model: ScheduleModel }) {
  const maxKw = Math.max(1, ...model.capacity.map((c) => Math.max(c.drawKw, c.capKw)));
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-px h-24" role="list" aria-label="Site draw against site cap per time slot">
        {model.capacity.map((c) => {
          const drawPct = (c.drawKw / maxKw) * 100;
          const capPct = (c.capKw / maxKw) * 100;
          const label = `${timeLabel(c.startMs, model.timeZone)}: ${c.drawKw.toFixed(1)} kW of ${c.capKw.toFixed(1)} kW cap${c.over ? ", over cap" : ""}`;
          return (
            <div key={c.slot} role="listitem" aria-label={label} title={label} className="relative flex-1 h-full min-w-[3px]">
              <div className="absolute inset-x-0 bottom-0 border-t-2 border-ink" style={{ bottom: `${capPct}%` }} aria-hidden="true" />
              <div
                className={`absolute inset-x-0 bottom-0 rounded-t-[2px] ${c.over ? "gw-capacity-over" : "bg-teal"}`}
                style={{ height: `${drawPct}%` }}
                aria-hidden="true"
              />
            </div>
          );
        })}
      </div>
      <p className="meta">Solid line is the site cap; bars are draw. Hatched bars are over cap.</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {model.capacity
          .filter((c) => c.over)
          .map((c) => (
            <li key={c.slot} className="text-red">
              {timeLabel(c.startMs, model.timeZone)} over cap ({c.drawKw.toFixed(1)} of {c.capKw.toFixed(1)} kW)
            </li>
          ))}
      </ul>
    </div>
  );
}
