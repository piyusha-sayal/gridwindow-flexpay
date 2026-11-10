"use client";

import { ATTENTION_STATES, PaymentBadge, ServiceBadge } from "@/components/ui";
import { formatLocalTime } from "@/domain/time";
import { formatKWh, formatUsd } from "@/domain/units";
import type { DashboardSession, OperatorDashboard } from "@/server/services/viewService";
import { hasCaptureConflict, needsAttention } from "./metrics";

export type OperatorAction =
  | { kind: "simulate" }
  | { kind: "outage" }
  | { kind: "reconcile" }
  | { kind: "simulate-pending" }
  | { kind: "simulate-declined" }
  | { kind: "resolve-capture"; status: "COMPLETED" | "DECLINED" };

interface ReservationTableProps {
  d: OperatorDashboard;
  busyId: string | null;
  selectedId: string | null;
  onAct: (s: DashboardSession, action: OperatorAction) => void;
  onSelect: (id: string) => void;
}

/** Accepted commitments with payment and fulfillment state shown independently. */
export function ReservationTable({ d, busyId, selectedId, onAct, onSelect }: ReservationTableProps) {
  const mock = d.providerMode === "MOCK";
  const attention = d.sessions.filter((s) => needsAttention(s, ATTENTION_STATES));
  return (
    <section className="card p-5 sm:p-6 space-y-4" aria-labelledby="res-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="res-title" className="text-[22px] font-semibold tracking-[-0.01em]">
          Reservations
        </h2>
        {attention.length > 0 && (
          <p className="text-[14px] text-[var(--amber-ink)]" role="status">
            {attention.length} need attention (payment pending, declined, failed or reconciling)
          </p>
        )}
      </div>
      {d.sessions.length === 0 ? (
        <p className="text-muted text-sm">No reservations for this night yet. Create one from the driver page{mock ? " or seed background drivers with the demo tools" : ""}.</p>
      ) : (
        <>
        <ul className="min-[1000px]:hidden space-y-3" aria-label="Reservation cards">
          {d.sessions.map((s) => (
            <Card key={s.id} d={d} s={s} mock={mock} busy={busyId !== null} working={busyId === s.id} selected={selectedId === s.id} onAct={onAct} onSelect={onSelect} />
          ))}
        </ul>
        <div className="hidden min-[1000px]:block relative overflow-x-auto" tabIndex={0} role="region" aria-label="Reservations table (scrolls horizontally)">
          <table className="data-table text-[14px]">
            <caption className="sr-only">Reservations for the night of {d.nightOf}</caption>
            <thead className="text-left text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">Reservation</th>
                <th scope="col" className="pr-3 font-medium">Port · parked</th>
                <th scope="col" className="pr-3 font-medium">Energy</th>
                <th scope="col" className="pr-3 font-medium">Amount</th>
                <th scope="col" className="pr-3 font-medium">Charging</th>
                <th scope="col" className="pr-3 font-medium">Payment</th>
                <th scope="col" className="font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.sessions.map((s) => (
                <Row key={s.id} d={d} s={s} mock={mock} busy={busyId !== null} working={busyId === s.id} selected={selectedId === s.id} onAct={onAct} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      <p className="text-[13px] text-muted">
        Outage injection affects only the synthetic simulator; it voids the authorization through the payment provider.
        {mock && " Pending/declined capture controls script the MOCK provider only and are unavailable with PayPal."}
      </p>
    </section>
  );
}

interface RowProps {
  d: OperatorDashboard;
  s: DashboardSession;
  mock: boolean;
  busy: boolean;
  /** This row's action is in flight. */
  working: boolean;
  selected: boolean;
  onAct: (s: DashboardSession, action: OperatorAction) => void;
  onSelect: (id: string) => void;
}

function Row({ d, s, mock, busy, working, selected, onAct, onSelect }: RowProps) {
  const attention = needsAttention(s, ATTENTION_STATES);
  return (
    <tr className={`border-t border-border align-top ${selected ? "bg-teal-tint" : attention ? "bg-[#fffbf2]" : ""}`}>
      <td className="py-3 pr-3">
        <button type="button" className="font-mono text-[13px] underline underline-offset-4 text-left" onClick={() => onSelect(s.id)} aria-pressed={selected}>
          <span aria-hidden="true">{shortId(s.id)}</span>
          <span className="sr-only">{s.id}</span>
        </button>
        {s.lastEvent && <span className="block meta mt-0.5">{s.lastEvent.type}</span>}
      </td>
      <td className="pr-3">
        {d.ports.find((p) => p.id === s.portId)?.label} · {formatLocalTime(s.plugInMs, d.timeZone)}–{formatLocalTime(s.departMs, d.timeZone)}
      </td>
      <td className="pr-3">{formatKWh(s.targetBatteryWh)}</td>
      <td className="pr-3">
        <span className="font-semibold">{formatUsd(s.amountCents)}</span>
        <span className="block meta mt-0.5">
          −{formatUsd(s.discountCents)} vs {formatUsd(s.listPriceCents)}
        </span>
      </td>
      <td className="pr-3">
        <ServiceBadge state={s.serviceState} />
        <code className="block meta mt-0.5">{s.serviceState}</code>
      </td>
      <td className="pr-3">
        <PaymentBadge state={s.paymentState} capacityConfirmed={s.slotsCommitted} />
        <code className="block meta mt-0.5">{s.paymentState}</code>
        {hasCaptureConflict(s) && <span className="block meta mt-0.5 text-[var(--amber-ink)]">Provider captured. Reconcile</span>}
        <ResolutionNote s={s} timeZone={d.timeZone} />
      </td>
      <td className="py-3">
        <Actions s={s} mock={mock} busy={busy} working={working} onAct={onAct} />
      </td>
    </tr>
  );
}

function Card({ d, s, mock, busy, working, selected, onAct, onSelect }: RowProps) {
  const attention = needsAttention(s, ATTENTION_STATES);
  return (
    <li className={`card p-4 space-y-3 ${selected ? "bg-teal-tint" : attention ? "bg-[#fffbf2]" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="eyebrow">Reservation</p>
          <code className="font-mono text-[12px] [overflow-wrap:anywhere]">{s.id}</code>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => onSelect(s.id)} aria-pressed={selected} aria-label={`Details for reservation ${s.id}`}>
          Details
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <CardField label="Port">{d.ports.find((p) => p.id === s.portId)?.label}</CardField>
        <CardField label="Parked">
          {formatLocalTime(s.plugInMs, d.timeZone)}–{formatLocalTime(s.departMs, d.timeZone)}
        </CardField>
        <CardField label="Energy">{formatKWh(s.targetBatteryWh)}</CardField>
        <CardField label="Customer amount">{formatUsd(s.amountCents)}</CardField>
        <CardField label="Charging" wide>
          <ServiceBadge state={s.serviceState} />
          <code className="block text-xs text-muted mt-0.5">{s.serviceState}</code>
        </CardField>
        <CardField label="Payment" wide>
          <PaymentBadge state={s.paymentState} capacityConfirmed={s.slotsCommitted} />
          <code className="block text-xs text-muted mt-0.5">{s.paymentState}</code>
          <ResolutionNote s={s} timeZone={d.timeZone} />
        </CardField>
      </dl>
      <Actions s={s} mock={mock} busy={busy} working={working} onAct={onAct} />
    </li>
  );
}

function CardField({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2 badge-wrap" : ""}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Primary and destructive actions first; MOCK-scripted and maintenance actions as compact secondary buttons. */
function Actions({ s, mock, busy, working, onAct }: Pick<RowProps, "s" | "mock" | "busy" | "working" | "onAct">) {
  const ready = s.paymentState === "AUTHORIZED" && s.serviceState === "SCHEDULED" && s.slotsCommitted;
  const pending = s.paymentState === "CAPTURE_PENDING";
  const secondary = "btn btn-sm btn-text text-[13px]";
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {mock && pending ? (
          <>
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onAct(s, { kind: "resolve-capture", status: "COMPLETED" })}>
              Provider completes capture
            </button>
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => onAct(s, { kind: "resolve-capture", status: "DECLINED" })}>
              Provider declines capture
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-sm btn-primary" disabled={!ready || busy} onClick={() => onAct(s, { kind: "simulate" })}>
              Deliver
            </button>
            <button className="btn btn-sm btn-danger" disabled={!ready || busy} onClick={() => onAct(s, { kind: "outage" })}>
              Inject outage
            </button>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-x-1 gap-y-0.5" role="group" aria-label="More actions">
        {mock && ready && (
          <>
            <button className={secondary} disabled={busy} onClick={() => onAct(s, { kind: "simulate-pending" })}>
              Deliver · capture pending
            </button>
            <button className={secondary} disabled={busy} onClick={() => onAct(s, { kind: "simulate-declined" })}>
              Deliver · capture declined
            </button>
          </>
        )}
        <button className={secondary} disabled={busy} onClick={() => onAct(s, { kind: "reconcile" })}>
          Reconcile
        </button>
      </div>
      {working && (
        <p className="meta" aria-live="polite">
          Working…
        </p>
      )}
    </div>
  );
}

const shortId = (id: string) => `…${id.slice(-6)}`;

/** Plain-text operator deadline in station time, e.g. "Resolve by 14:30 (overdue)". Null when no flag is open. */
export function resolutionText(s: Pick<DashboardSession, "operatorResolutionRequired" | "resolutionDeadline" | "resolutionOverdue">, timeZone: string): string | null {
  if (!s.operatorResolutionRequired || !s.resolutionDeadline) return s.operatorResolutionRequired ? "Operator decision required" : null;
  const time = formatLocalTime(Date.parse(s.resolutionDeadline), timeZone);
  return `Resolve by ${time}${s.resolutionOverdue ? " (overdue)" : ""}`;
}

function ResolutionNote({ s, timeZone }: { s: DashboardSession; timeZone: string }) {
  const text = resolutionText(s, timeZone);
  if (!text) return null;
  return <span className={`block meta mt-0.5 ${s.resolutionOverdue ? "text-[var(--amber-ink)] font-semibold" : ""}`}>{text}</span>;
}
