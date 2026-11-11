"use client";

import { ATTENTION_STATES, Badge, PaymentBadge, ServiceBadge } from "@/components/ui";
import { formatLocalTime } from "@/domain/time";
import { formatKWh, formatUsd } from "@/domain/units";
import type { DashboardSession, OperatorDashboard } from "@/server/services/viewService";
import { hasCaptureConflict, needsAttention, rowProvider } from "./metrics";

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
    <section className="card ops-panel p-5 sm:p-6 space-y-4" aria-labelledby="res-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="res-title" className="panel-title text-[22px] font-semibold">
          Reservations
        </h2>
        {attention.length > 0 && (
          <p className="attn-note text-[14px] text-warn" role="status">
            <span aria-hidden="true" className="live-dot live-dot-amber" />
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
        <div className="table-wrap hidden min-[1000px]:block relative overflow-x-auto" tabIndex={0} role="region" aria-label="Reservations table (scrolls horizontally)">
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
      <p className="fine-print text-[13px] text-muted">
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
    <tr className={`ops-row border-t border-border align-top ${selected ? "is-selected bg-teal-tint" : attention ? "is-attention bg-warn-soft" : ""}`}>
      <td className="py-3 pr-3">
        <button type="button" className="id-link font-mono text-[13px] underline underline-offset-4 text-left" onClick={() => onSelect(s.id)} aria-pressed={selected}>
          <span aria-hidden="true">{shortId(s.id)}</span>
          <span className="sr-only">{s.id}</span>
        </button>
        {s.lastEvent && <span className="block meta mt-0.5">{s.lastEvent.type}</span>}
      </td>
      <td className="pr-3">
        {d.ports.find((p) => p.id === s.portId)?.label} · {formatLocalTime(s.plugInMs, d.timeZone)}-{formatLocalTime(s.departMs, d.timeZone)}
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
        <ProviderTag s={s} runtimeMode={d.providerMode} />
        {hasCaptureConflict(s) && <span className="block meta mt-0.5 text-warn">Provider captured. Reconcile</span>}
        <ResolutionNote s={s} timeZone={d.timeZone} />
      </td>
      <td className="py-3">
        <Actions s={s} mock={mock} busy={busy || rowProvider(s, d.providerMode).mismatch} working={working} onAct={onAct} />
      </td>
    </tr>
  );
}

function Card({ d, s, mock, busy, working, selected, onAct, onSelect }: RowProps) {
  const attention = needsAttention(s, ATTENTION_STATES);
  return (
    <li className={`card res-card p-4 space-y-3 ${selected ? "is-selected bg-teal-tint" : attention ? "is-attention bg-warn-soft" : ""}`}>
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
          {formatLocalTime(s.plugInMs, d.timeZone)}-{formatLocalTime(s.departMs, d.timeZone)}
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
          <ProviderTag s={s} runtimeMode={d.providerMode} />
          <ResolutionNote s={s} timeZone={d.timeZone} />
        </CardField>
      </dl>
      <Actions s={s} mock={mock} busy={busy || rowProvider(s, d.providerMode).mismatch} working={working} onAct={onAct} />
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
    <div className="row-actions space-y-1.5">
      <div className="row-actions-main flex flex-wrap gap-1.5">
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
      <div className="row-actions-more flex flex-wrap gap-x-1 gap-y-0.5" role="group" aria-label="More actions">
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
        <p className="meta working" aria-live="polite">
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

/** Which provider mode this reservation lives in. A row from the other mode is flagged, so it is not read as a real failure. */
function ProviderTag({ s, runtimeMode }: { s: DashboardSession; runtimeMode: string }) {
  const p = rowProvider(s, runtimeMode);
  return (
    <span className="block mt-1">
      <Badge tone={s.providerMode === "MOCK" ? "warn" : "neutral"}>{p.label}</Badge>
      {p.note && <span className="block meta mt-0.5">{p.note}</span>}
    </span>
  );
}

function ResolutionNote({ s, timeZone }: { s: DashboardSession; timeZone: string }) {
  const text = resolutionText(s, timeZone);
  if (!text) return null;
  return <span className={`block meta mt-0.5 ${s.resolutionOverdue ? "text-warn font-semibold" : ""}`}>{text}</span>;
}
