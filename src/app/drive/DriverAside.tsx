"use client";

import type { PricedOffer } from "@/domain/quotes";
import { formatLocalTime } from "@/domain/time";
import { formatUsd } from "@/domain/units";
import type { DriverConfig, FormState } from "./driverTypes";
import { summarizeRequest, summarySentence } from "./requestSummary";

/** Live summary of the form as typed. Display only: the server validates and prices the request. */
export function RequestCard({ config, form, onEdit }: { config: DriverConfig; form: FormState; onEdit?: () => void }) {
  const port = config.station.ports.find((p) => p.id === form.portId);
  const cap = Number(form.spendCap.replace(/^\$/, "").trim());
  const summary = summarizeRequest(form, port?.maxPowerW ?? 0);
  const rows: [string, string][] = [
    ["Energy", form.targetBatteryKWh.trim() ? `${form.targetBatteryKWh.trim()} kWh` : "Not set"],
    ["Port", port ? `Port ${port.label} · ${port.maxPowerW / 1000} kW` : "Not set"],
    ["Night of", form.nightOf || "Not set"],
    ["Plug in", form.plugInLocal ? `${form.plugInLocal} tonight` : "Not set"],
    ["Ready by", form.departLocal ? `${form.departLocal} tomorrow` : "Not set"],
    ["Budget", Number.isFinite(cap) && cap > 0 ? `up to $${cap.toFixed(2)}` : "Not set"],
    ["Min. saving", Number(form.minSavings) > 0 ? `at least $${Number(form.minSavings).toFixed(2)} · ${form.minSavingsRequired ? "required" : "preferred"}` : "any"],
  ];
  return (
    <section aria-labelledby="request-card-title" className="card aside-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="request-card-title" className="meta">
          Your request
        </h2>
        {onEdit && (
          <button type="button" className="btn btn-text btn-sm" onClick={onEdit}>
            Edit
          </button>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px] tabular">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {summary && <p className="border-t border-line-2 pt-3 text-[14px] text-text-2">{summarySentence(summary)}</p>}
    </section>
  );
}

interface SelectedProps {
  offer: PricedOffer;
  tz: string;
  expired: boolean;
  onReview: () => void;
}

/** Navy card for the selected offer (≥760px). */
export function SelectedCard({ offer, tz, expired, onReview }: SelectedProps) {
  return (
    <section aria-labelledby="selected-title" className="card card-navy ring-flow selected-card p-5 space-y-4">
      <div>
        <p className="meta">Selected</p>
        <h2 id="selected-title" className="mt-1 text-[18px] font-semibold text-white">
          {offer.label}
        </h2>
        <p className="font-mono text-[13px] text-on-navy-body">
          Charges {formatLocalTime(offer.chargeStartMs, tz)}-{formatLocalTime(offer.chargeEndMs, tz)}
        </p>
      </div>
      <p className="flex items-baseline gap-3 tabular">
        <span className="selected-price text-[44px] font-semibold leading-none tracking-[-0.03em] text-white">{formatUsd(offer.priceCents)}</span>
        <s className="text-on-navy-muted">{formatUsd(offer.listPriceCents)}</s>
      </p>
      <p className="save-line text-[14px] text-teal-bright">You save {formatUsd(offer.discountCents)}</p>
      <button type="button" className="btn btn-teal w-full" onClick={onReview} disabled={expired}>
        Review and approve
      </button>
      <p className="text-[13px] text-on-navy-body">Nothing is authorized until you approve.</p>
    </section>
  );
}

/** Fixed bottom bar replacing the aside on small screens (step 2). */
export function MobileOfferBar({ offer, expired, onReview }: Omit<SelectedProps, "tz">) {
  return (
    <div className="offer-bar fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom,0px))] z-20 border-t border-line bg-surface/95 px-[var(--gutter)] py-3 backdrop-blur min-[760px]:hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium">{offer.label}</p>
          <p className="text-[18px] font-semibold tabular">{formatUsd(offer.priceCents)}</p>
        </div>
        <button type="button" className="btn btn-primary shrink-0" onClick={onReview} disabled={expired}>
          Review and approve
        </button>
      </div>
    </div>
  );
}
