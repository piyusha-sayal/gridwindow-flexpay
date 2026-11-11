"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/components/api";
import { PaymentBadge, ServiceBadge } from "@/components/ui";
import { economicOutcome } from "@/domain/paymentState";
import { formatLocalTime } from "@/domain/time";
import { formatKWh, formatUsd } from "@/domain/units";
import type { ReservationView } from "@/server/services/viewService";

/** Investigation drawer for one reservation: economics, provider evidence and full event trail. */
export function DetailPanel({ id, version, onClose }: { id: string; version: number; onClose: () => void }) {
  const [r, setR] = useState<ReservationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sheetRef = useRef<HTMLElement>(null);

  // Move focus into the panel when it opens (or switches reservation) and back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [id]);

  useEffect(() => {
    let alive = true;
    api<{ reservation: ReservationView }>(`/api/reservations/${encodeURIComponent(id)}`).then(
      (res) => alive && setR(res.reservation),
      (e: unknown) => alive && setError(e instanceof ApiError ? e.message : "Could not load reservation."),
    );
    return () => {
      alive = false;
    };
  }, [id, version]);

  // Keep Tab inside the open drawer; Escape closes it.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") return onClose();
    if (e.key !== "Tab") return;
    const items = [...(sheetRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex='0']") ?? [])];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="drawer-scrim absolute inset-0 bg-navy/50" aria-hidden="true" onClick={onClose} />
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        onKeyDown={onKeyDown}
        className="drawer absolute inset-y-0 right-0 w-[min(480px,100%)] overflow-y-auto bg-surface p-5 sm:p-6 space-y-5"
        style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))", paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Reservation detail</p>
          <h2 id="detail-title" ref={headingRef} tabIndex={-1} className="font-mono text-[15px] font-semibold break-all outline-none">
            {id}
          </h2>
        </div>
        <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close reservation detail (Escape)">
          Close
        </button>
      </div>
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      {!r && !error && <p className="working text-muted text-sm">Loading…</p>}
      {r && (
        <>
          <div className="flex flex-wrap gap-2 badge-wrap">
            <PaymentBadge state={r.paymentState} capacityConfirmed={r.slotsCommitted} />
            <ServiceBadge state={r.serviceState} />
            <span className="badge tone-neutral">{r.slotsCommitted ? "Capacity committed" : "Capacity not held"}</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[14px] tabular">
            <Item k="Parked" v={`Port ${r.portLabel} · ${formatLocalTime(r.plugInMs, r.timeZone)}-${formatLocalTime(r.departMs, r.timeZone)}`} />
            <Item k="Energy target" v={formatKWh(r.targetBatteryWh)} />
            <Item k="Delivered" v={r.simulation ? `${formatKWh(Math.floor(r.simulation.deliveredBatteryMilliWh / 1000))} (${r.simulation.outcome})` : "not run"} />
            <Item k="Authorization expires" v={r.authorizationExpiresAt ? new Date(r.authorizationExpiresAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "n/a"} />
            <Item k="Price / list" v={`${formatUsd(r.economics.priceCents)} / ${formatUsd(r.economics.listPriceCents)}`} />
            <Item k="Driver discount" v={formatUsd(r.economics.discountCents)} />
            <Item k="Energy cost immediate → flexible" v={`${r.economics.baselineEnergyCostCents !== null ? formatUsd(r.economics.baselineEnergyCostCents) : "n/a"} → ${formatUsd(r.economics.energyCostCents)}`} />
            <Item k="Collected (provider-captured)" v={formatUsd(r.proofs.find((p) => p.type === "CAPTURED")?.amountCents ?? 0)} />
            <Item {...contributionItem(r)} />
          </dl>
          <div className="space-y-5 border-t border-line pt-4">
            <div>
              <h3 className="font-semibold text-sm mb-1">Provider evidence ({r.providerMode === "MOCK" ? "MOCK provider" : "PayPal Sandbox API"})</h3>
              <ul className="text-xs space-y-1 tabular">
                {r.proofs.length === 0 && <li className="text-muted">None recorded.</li>}
                {r.proofs.map((p) => (
                  <li key={p.type}>
                    <strong>{p.type}</strong> · {p.providerStatus} · ref {p.ref}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-sm mb-1">Event trail</h3>
              <ol className="font-mono text-[11px] text-muted space-y-0.5 tabular [overflow-wrap:anywhere]">
                {r.events.map((e, i) => (
                  <li key={i}>
                    {new Date(e.occurredAt).toISOString().slice(11, 19)} · {e.source} · <span className="text-text">{e.type}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <Link href={`/reservations/${encodeURIComponent(id)}`} className="link-arrow text-[14px]">
            Open the driver view of this reservation
          </Link>
        </>
      )}
      </section>
    </div>
  );
}

/** Modeled contribution is realized only on a provider-confirmed capture; otherwise it is projected or lost. */
export function contributionItem(r: Pick<ReservationView, "paymentState" | "economics">): { k: string; v: string } {
  const amount = `+${formatUsd(r.economics.operatorImprovementCents)}`;
  switch (economicOutcome(r.paymentState)) {
    case "REALIZED":
      return { k: "Operator contribution (realized, modeled)", v: amount };
    case "NOT_REALIZED":
      return { k: "Operator contribution (not realized)", v: `$0.00 · ${amount} was projected` };
    default:
      return { k: "Operator contribution (projected)", v: `${amount} if capture succeeds` };
  }
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="detail-item min-w-0">
      <dt className="meta">{k}</dt>
      <dd className="mt-0.5 [overflow-wrap:anywhere]">{v}</dd>
    </div>
  );
}
