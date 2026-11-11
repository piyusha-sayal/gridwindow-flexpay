"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { SYNTHETIC_ECONOMICS } from "@/domain/economics";
import { formatUsd } from "@/domain/units";
import { FIXED_NIGHT_AXIS, pctOf as axisPct, TariffStrip } from "./drive/NightAxis";
import { HERO_DEFAULT_READY_SLOT, HERO_PLUG_IN_SLOT, HERO_PORT_W, HERO_SLOTS, heroSchedule, heroTimeLabel } from "./heroSchedule";

const MIN_READY = HERO_PLUG_IN_SLOT + 1;
const TICKS = [0, 16, 32, 48, 64];
const SHARE = SYNTHETIC_ECONOMICS.driverShareBp === 5_000 ? "half" : `${SYNTHETIC_ECONOMICS.driverShareBp / 100}%`;

const pctOf = (slot: number) => axisPct(slot, HERO_SLOTS);

function Bars({ powerW, color, label }: { powerW: readonly number[]; color: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="meta w-[86px] shrink-0">{label}</span>
      <div className="hero-bars relative h-10 flex-1 flex items-end gap-px" aria-hidden="true">
        {powerW.map((w, i) => (
          <span key={i} className="hero-bar flex-1 rounded-t-[2px]" style={{ height: `${(w / HERO_PORT_W) * 100}%`, background: color, transition: "height var(--t-bar) var(--ease)", "--i": i } as React.CSSProperties} />
        ))}
      </div>
    </div>
  );
}

/** Interactive landing illustration: drag the ready-by marker and see the modeled offer change. */
export function HeroScheduler() {
  const [ready, setReady] = useState(HERO_DEFAULT_READY_SLOT);
  const track = useRef<HTMLDivElement>(null);
  const r = heroSchedule(ready);
  const readyStr = heroTimeLabel(ready);

  const setFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return;
    const slot = Math.round(((e.clientX - box.left) / box.width) * HERO_SLOTS);
    setReady(Math.min(HERO_SLOTS, Math.max(MIN_READY, slot)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 4 : 1;
    const next: Record<string, number> = { ArrowLeft: ready - step, ArrowDown: ready - step, ArrowRight: ready + step, ArrowUp: ready + step, Home: MIN_READY, End: HERO_SLOTS };
    if (!(e.key in next)) return;
    e.preventDefault();
    setReady(Math.min(HERO_SLOTS, Math.max(MIN_READY, next[e.key]!)));
  };

  return (
    <figure className="card scheduler overflow-hidden" aria-labelledby="hero-caption">
      <div className="scheduler-head flex flex-wrap gap-x-5 gap-y-1 border-b border-line px-5 py-3 meta">
        <span className="text-ink">PORT C · 11 kW</span>
        <span>NEED 30 kWh</span>
        <span>PLUGGED IN 19:00</span>
        <span className="ml-auto">ILLUSTRATION · SYNTHETIC TARIFF · ONE VEHICLE</span>
      </div>
      <div className="grid gap-6 p-5 min-[900px]:grid-cols-[1fr_260px]">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-3">
            <span className="meta w-[86px] shrink-0">Price</span>
            <TariffStrip axis={FIXED_NIGHT_AXIS} className="h-7 flex-1" />
          </div>
          <div className="relative">
            <Bars powerW={r.baselineW} color="var(--chart-baseline)" label="Charge now" />
            <div className="hero-bars-flex mt-2">
              <Bars powerW={r.flexW} color="var(--teal)" label="GridWindow" />
            </div>
            {/* Hatched: before plug-in and after the ready-by time. */}
            <div className="pointer-events-none absolute inset-y-0 right-0 left-[98px]" aria-hidden="true">
              <span className="hatch-grey absolute inset-y-0 left-0" style={{ width: pctOf(HERO_PLUG_IN_SLOT) }} />
              <span className="hatch-grey absolute inset-y-0 right-0" style={{ width: pctOf(HERO_SLOTS - ready) }} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-[86px] shrink-0" />
            <div
              ref={track}
              className="relative h-9 flex-1 touch-none cursor-ew-resize"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setFromPointer(e);
              }}
              onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && setFromPointer(e)}
            >
              <div className="absolute inset-x-0 top-0 flex justify-between meta" aria-hidden="true">
                {TICKS.map((t) => (
                  <span key={t}>{heroTimeLabel(t)}</span>
                ))}
              </div>
              <div
                role="slider"
                tabIndex={0}
                aria-label="Ready-by time"
                aria-valuemin={MIN_READY}
                aria-valuemax={HERO_SLOTS}
                aria-valuenow={ready}
                aria-valuetext={`Ready by ${readyStr}`}
                onKeyDown={onKey}
                className="hero-handle absolute top-4 -translate-x-1/2 whitespace-nowrap rounded-full bg-navy px-2.5 py-1 font-mono text-[11px] text-white"
                style={{ left: pctOf(ready) }}
              >
                READY {readyStr} ⇆
              </div>
            </div>
          </div>
        </div>
        <div aria-live="polite" className="scheduler-result space-y-2 min-[900px]:border-l min-[900px]:border-line min-[900px]:pl-6">
          <p className="meta">
            CHARGE NOW · LIST <span className="text-ink">{formatUsd(r.listCents)}</span>
          </p>
          {r.kind === "OFFER" ? (
            <>
              <p className="meta">GRIDWINDOW OFFER</p>
              <p className="scheduler-price text-gradient font-semibold tracking-[-0.05em] leading-none tabular text-[clamp(48px,5.4vw,68px)]">{formatUsd(r.priceCents)}</p>
              <p>
                <span className="badge badge-save no-dot tone-success">
                  You save {formatUsd(r.discountCents)} · {Math.round((r.discountCents / r.listCents) * 100)}%
                </span>
              </p>
              <p className="meta text-ink">
                Charges {heroTimeLabel(r.startSlot)}-{heroTimeLabel(r.endSlot)}
              </p>
              <p className="text-[13px] text-muted">Ready by {readyStr} · same 30 kWh</p>
            </>
          ) : (
            <>
              <p className="text-xl font-semibold">{r.kind === "NOT_ENOUGH_TIME" ? "Not enough time" : "No cheaper window"}</p>
              <p className="text-[14px] text-text-2">
                {r.kind === "NOT_ENOUGH_TIME"
                  ? `11 kW can't deliver 30 kWh between 19:00 and ${readyStr}. Move the marker later.`
                  : `Before ${readyStr} there are no cheaper hours than charging now, so no flexible offer is made.`}
              </p>
            </>
          )}
        </div>
      </div>
      <figcaption id="hero-caption" className="scheduler-foot border-t border-line px-5 py-3 text-[13px] text-muted">
        Drag the marker or use arrow keys. Uses the app&apos;s synthetic tariff and pricing: {SHARE} of the modeled energy saving goes to the driver. Not live data.
      </figcaption>
    </figure>
  );
}
