"use client";

import { ServiceBadge } from "@/components/ui";
import { formatLocalTime } from "@/domain/time";
import { formatKWh, SLOT_MS } from "@/domain/units";
import { AxisTicks, pctOf, quoteAxis } from "@/app/drive/NightAxis";
import type { EnergyRecordView, ReservationView } from "@/server/services/viewService";

interface ChargingPanelProps {
  r: ReservationView;
  /** Number of stored energy records revealed so far by the accelerated playback. */
  shown: number;
  busy: boolean;
  onSimulate: () => void;
}

/** Charging is reported on its own, independent of payment: scheduled power, synthetic delivery and the battery. */
export function ChargingPanel({ r, shown, busy, onSimulate }: ChargingPanelProps) {
  const records = r.simulation?.records ?? [];
  const revealed = records.slice(0, shown);
  const deliveredMilliWh = revealed.reduce((s, x) => s + x.batteryMilliWh, 0);
  const pct = Math.min(100, Math.round((deliveredMilliWh / (r.targetBatteryWh * 1000)) * 100));
  const finished = r.simulation !== null && shown === records.length;
  const chargingStart = r.powerW.findIndex((w) => w > 0);

  return (
    <section className="card p-5 sm:p-6 space-y-5 min-w-0" aria-labelledby="sim-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sim-title" className="eyebrow text-ink">
          Charging · synthetic
        </h2>
        <ServiceBadge state={r.serviceState} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4" aria-live="polite">
        <p className="flex items-baseline gap-2 tabular">
          <span className="text-[clamp(44px,6vw,64px)] font-semibold leading-none tracking-[-0.03em]">{(Math.floor(deliveredMilliWh / 1000) / 1000).toFixed(2)}</span>
          <span className="text-[17px] text-muted">of {formatKWh(r.targetBatteryWh)}</span>
          <span className="sr-only">delivered ({pct}%)</span>
        </p>
        {finished && (
          <strong className={r.simulation!.outcome === "DELIVERED" ? "text-teal-ink" : "text-red"}>{r.simulation!.outcome === "DELIVERED" ? "Delivered" : "Failed: charger outage"}</strong>
        )}
      </div>

      <Battery pct={pct} />

      <ScheduleColumns r={r} revealed={revealed} />
      <p className="meta">
        Scheduled {chargingStart >= 0 ? formatLocalTime(r.gridStartMs + chargingStart * SLOT_MS, r.timeZone) : "n/a"} onward · {r.powerW.filter((w) => w > 0).length} × 15 min
      </p>

      {r.simulation === null &&
        (r.canSimulate ? (
          <button type="button" className="btn btn-primary" onClick={onSimulate} disabled={busy}>
            {busy ? "Simulating night…" : "Run the synthetic overnight charge"}
          </button>
        ) : (
          <p className="text-muted text-[14px]">Charging can be simulated once the amount is authorized and capacity is committed.</p>
        ))}
    </section>
  );
}

function Battery({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 items-center">
        <div
          className="relative h-11 flex-1 rounded-[10px] border-[1.5px] border-ink p-[3px]"
          role="progressbar"
          aria-label="Energy delivered"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <span className="block h-full rounded-[7px] bg-teal" style={{ width: `${pct}%`, transition: "width var(--t-slow) var(--ease)" }} />
        </div>
        <span className="h-4 w-[5px] rounded-r-[2px] bg-ink" aria-hidden="true" />
      </div>
      <span className="w-[4ch] text-right font-mono text-[13px] tabular" aria-hidden="true">
        {pct}%
      </span>
    </div>
  );
}

/** One column per 15-minute slot: scheduled power, delivered (teal) filling in, failed slots red, dashed departure line. */
function ScheduleColumns({ r, revealed }: { r: ReservationView; revealed: EnergyRecordView[] }) {
  const n = r.powerW.length;
  const maxW = Math.max(1, ...r.powerW);
  const delivered = new Map(revealed.map((x) => [x.slotIndex, x]));
  const leaveSlot = Math.min(n, Math.max(0, (r.departMs - r.gridStartMs) / SLOT_MS));
  const axis = quoteAxis({ startMs: r.gridStartMs, slotCount: n }, r.timeZone);
  const failedSlots = revealed.filter((x) => x.deliveredW < x.commandedW).length;

  return (
    <figure className="space-y-1.5">
      <figcaption className="sr-only">
        Scheduled versus delivered charging power: {r.powerW.filter((w) => w > 0).length} scheduled slots, {revealed.filter((x) => x.deliveredW > 0).length} delivered so far
        {failedSlots ? `, ${failedSlots} short of schedule` : ""}. Departure {formatLocalTime(r.departMs, r.timeZone)}.
      </figcaption>
      <div className="relative h-24" aria-hidden="true">
        <div className="flex h-full items-end gap-px">
          {r.powerW.map((w, i) => {
            const rec = delivered.get(i);
            const short = rec !== undefined && rec.deliveredW < rec.commandedW;
            return (
              <span key={i} className="relative flex-1 rounded-[1px]" style={{ height: `${(w / maxW) * 100}%`, background: short ? "var(--red)" : "var(--chart-scheduled)" }}>
                {rec && !short && <span className="absolute inset-x-0 bottom-0 rounded-[1px] bg-teal" style={{ height: `${w > 0 ? (rec.deliveredW / w) * 100 : 0}%`, transition: "height var(--t-bar) var(--ease)" }} />}
              </span>
            );
          })}
        </div>
        <span className="absolute -inset-y-1 border-l border-dashed border-ink" style={{ left: pctOf(leaveSlot, n) }}>
          <span className="absolute -top-4 left-1 whitespace-nowrap font-mono text-[10px] tracking-[0.06em]">LEAVE {formatLocalTime(r.departMs, r.timeZone)}</span>
        </span>
      </div>
      <AxisTicks axis={axis} />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 meta" aria-hidden="true">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-[var(--chart-scheduled)] ring-1 ring-line-strong" /> Scheduled
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-teal" /> Delivered (synthetic)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-red" /> Short of schedule
        </li>
      </ul>
    </figure>
  );
}
