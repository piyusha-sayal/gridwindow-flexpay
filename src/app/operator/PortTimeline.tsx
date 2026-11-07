"use client";

import { AxisTicks, quoteAxis, TariffStrip } from "@/app/drive/NightAxis";
import { formatLocalTime } from "@/domain/time";
import { SLOT_MS } from "@/domain/units";
import type { DashboardSession, OperatorDashboard } from "@/server/services/viewService";
import { activeSessions } from "./metrics";

const HATCH = "repeating-linear-gradient(135deg, var(--teal) 0 2px, #bfe7e2 2px 4px)";

interface PortTimelineProps {
  d: OperatorDashboard;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Interactive occupancy timeline. Line-coloured bar = vehicle physically parked (port occupied);
 * columns = electrical draw. Each session is a focusable button opening its details.
 */
export function PortTimeline({ d, selectedId, onSelect }: PortTimelineProps) {
  const span = d.slotCount * SLOT_MS;
  const pct = (ms: number) => (Math.min(Math.max(ms - d.gridStartMs, 0), span) / span) * 100;
  const shown = [...activeSessions(d), ...d.sessions.filter((s) => s.serviceState === "FAILED" && !s.slotsCommitted)];
  const axis = quoteAxis({ startMs: d.gridStartMs, slotCount: d.slotCount }, d.timeZone);

  return (
    <section className="card p-5 sm:p-6 space-y-4" aria-labelledby="ports-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ports-title" className="text-[22px] font-semibold tracking-[-0.01em]">
          Ports
        </h2>
        <p className="meta">Parked occupancy vs. electrical draw · select a vehicle for details</p>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px] space-y-2">
          <div className="grid grid-cols-[72px_1fr] items-center gap-3">
            <span className="meta">Tariff</span>
            <TariffStrip axis={axis} className="h-5" />
          </div>
          {d.ports.map((port) => {
            const sessions = shown.filter((s) => s.portId === port.id);
            return (
              <div key={port.id} className="grid grid-cols-[72px_1fr] items-center gap-3">
                <span className="text-[15px] font-semibold">
                  Port {port.label}
                  <span className="block meta font-normal">{port.maxPowerW / 1000} kW</span>
                </span>
                <div className="relative h-14 rounded-[6px] bg-paper">
                  {sessions.length === 0 && <span className="absolute inset-0 flex items-center px-3 meta">Free all night</span>}
                  {sessions.map((s) => (
                    <SessionBar key={s.id} d={d} s={s} left={pct(s.plugInMs)} width={pct(s.departMs) - pct(s.plugInMs)} portMaxW={port.maxPowerW} selected={selectedId === s.id} onSelect={onSelect} />
                  ))}
                </div>
              </div>
            );
          })}
          <div className="grid grid-cols-[72px_1fr] gap-3">
            <span />
            <AxisTicks axis={axis} />
          </div>
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-text-2" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-4 rounded-[2px] bg-[var(--line)]" /> Vehicle parked (port occupied, no power)
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-4 rounded-[2px]" style={{ background: HATCH }} /> Scheduled draw (height = kW)
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-4 rounded-[2px] bg-teal" /> Delivered (synthetic)
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-4 rounded-[2px] bg-red" /> Shortfall during outage
        </li>
      </ul>
    </section>
  );
}

interface SessionBarProps {
  d: OperatorDashboard;
  s: DashboardSession;
  left: number;
  width: number;
  portMaxW: number;
  selected: boolean;
  onSelect: (id: string) => void;
}

function SessionBar({ d, s, left, width, portMaxW, selected, onSelect }: SessionBarProps) {
  const parkedMs = s.departMs - s.plugInMs;
  const chargingSlots = s.powerW.filter((w) => w > 0).length;
  const label = `Reservation ${s.id}: parked ${formatLocalTime(s.plugInMs, d.timeZone)} to ${formatLocalTime(s.departMs, d.timeZone)}, drawing power in ${chargingSlots} quarter-hours, payment ${s.paymentState}, charging ${s.serviceState}`;
  const held = s.paymentState === "AUTHORIZED" ? " · HELD" : "";
  return (
    <button
      type="button"
      className={`absolute inset-y-0 overflow-hidden rounded-[5px] bg-[var(--line)] text-left ${selected ? "ring-2 ring-ink" : "hover:ring-1 hover:ring-line-strong"}`}
      style={{ left: `${left}%`, width: `${width}%` }}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={() => onSelect(s.id)}
    >
      <span className="absolute left-1.5 top-1 right-1 truncate font-mono text-[10px] tracking-[0.04em] text-ink" aria-hidden="true">
        {s.id.slice(-4).toUpperCase()} · {s.serviceState} · {s.paymentState}
        {held}
      </span>
      <span className="absolute inset-x-0 bottom-0 h-8">
        {s.powerW.map((w, i) => {
          if (w <= 0) return null;
          const offset = i * SLOT_MS + d.gridStartMs - s.plugInMs;
          const delivered = s.deliveredW === null ? null : (s.deliveredW[i] ?? 0);
          const short = delivered !== null && delivered < w;
          return (
            <span
              key={i}
              className="absolute bottom-0"
              style={{
                left: `${(offset / parkedMs) * 100}%`,
                width: `${(SLOT_MS / parkedMs) * 100}%`,
                height: `${(w / portMaxW) * 100}%`,
                background: short ? "var(--red)" : delivered !== null ? "var(--teal)" : HATCH,
              }}
            />
          );
        })}
      </span>
    </button>
  );
}
