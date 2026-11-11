import { timeLabel, type ScheduleModel } from "./scheduleModel";

/** Accessible text equivalent of the timeline: same data, one row per session. Always rendered. */
export function ScheduleTable({ model }: { model: ScheduleModel }) {
  const portLabel = (id: string) => model.resources.find((r) => r.id === id)?.label ?? id;
  return (
    <div role="region" tabIndex={0} aria-label="Schedule table, scroll sideways when narrow" className="table-wrap sched-table-wrap overflow-x-auto rounded-[var(--r-card-sm)] border border-line">
      <table className="sched-table w-full min-w-[640px] border-collapse text-left text-[14px]">
        <caption className="px-3 py-2 text-left meta">Sessions on this night, original and current plan (times in {model.timeZone})</caption>
        <thead>
          <tr className="border-b border-line bg-paper">
            <th scope="col" className="px-3 py-2 font-semibold">Port</th>
            <th scope="col" className="px-3 py-2 font-semibold">Parked</th>
            <th scope="col" className="px-3 py-2 font-semibold">Departs (agreed)</th>
            <th scope="col" className="px-3 py-2 font-semibold">Departs (effective)</th>
            <th scope="col" className="px-3 py-2 font-semibold">Plan version</th>
            <th scope="col" className="px-3 py-2 font-semibold">Original kWh</th>
            <th scope="col" className="px-3 py-2 font-semibold">Current kWh</th>
            <th scope="col" className="px-3 py-2 font-semibold">Peak kW</th>
          </tr>
        </thead>
        <tbody>
          {model.sessions.map((s) => (
            <tr key={s.sessionId} className="border-b border-line-2 last:border-b-0">
              <th scope="row" className="px-3 py-2 font-semibold">
                Port {portLabel(s.portId)}
                <span className="block font-mono text-[11px] font-normal text-muted">{s.sessionId}</span>
              </th>
              <td className="px-3 py-2">{timeLabel(s.plugInMs, model.timeZone)}</td>
              <td className="px-3 py-2">{timeLabel(s.departMs, model.timeZone)}</td>
              <td className="px-3 py-2">
                {timeLabel(s.effectiveDepartMs, model.timeZone)}
                {s.departureShortened && <span className="ml-2 meta">shortened</span>}
              </td>
              <td className="px-3 py-2">{s.recovered ? `v${s.currentVersion} (recovered)` : "v1 (agreed)"}</td>
              <td className="px-3 py-2">{s.originalKwh.toFixed(2)}</td>
              <td className="px-3 py-2">{s.currentKwh.toFixed(2)}</td>
              <td className="px-3 py-2">{s.peakKw.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {model.capacity.some((c) => c.over) && (
        <p className="border-t border-line px-3 py-2 text-[13px] text-red">
          Over site cap in {model.capacity.filter((c) => c.over).length} time slot(s). Table values are the current plan.
        </p>
      )}
    </div>
  );
}
