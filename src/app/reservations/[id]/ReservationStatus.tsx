"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/components/api";
import { FlexReceipt } from "@/components/FlexReceipt";
import { Alert, Badge } from "@/components/ui";
import { formatLocalTime } from "@/domain/time";
import { formatKWh, formatUsd } from "@/domain/units";
import type { ReservationView } from "@/server/services/viewService";
import { AskAssistant } from "./AskAssistant";
import { ChargingPanel } from "./ChargingPanel";
import { PaymentPanel } from "./PaymentPanel";
import { RecoveryConsent } from "./RecoveryConsent";
import { RecoveryStatus } from "./RecoveryStatus";

const POLL_STATES = new Set(["QUOTE_ACCEPTED", "BUYER_APPROVED", "CAPTURE_PENDING", "NEEDS_RECONCILIATION"]);

async function fetchReservation(id: string): Promise<ReservationView> {
  return (await api<{ reservation: ReservationView }>(`/api/reservations/${encodeURIComponent(id)}`)).reservation;
}

export function ReservationStatus({ id }: { id: string }) {
  const [r, setR] = useState<ReservationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);

  const load = useCallback(
    () =>
      fetchReservation(id).then(
        (reservation) => {
          setR(reservation);
          setError(null);
        },
        (e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load reservation."),
      ),
    [id],
  );

  useEffect(() => {
    let alive = true;
    fetchReservation(id).then(
      (reservation) => alive && setR(reservation),
      (e: unknown) => alive && setError(e instanceof ApiError ? e.message : "Could not load reservation."),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  // Poll while the provider state may still change without user action.
  useEffect(() => {
    if (!r || !POLL_STATES.has(r.paymentState)) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [r, load]);

  // Accelerated playback of the stored synthetic energy records.
  useEffect(() => {
    if (playhead === null || !r?.simulation) return;
    if (playhead >= r.simulation.records.length) return;
    const t = setTimeout(() => setPlayhead(playhead + 1), 120);
    return () => clearTimeout(t);
  }, [playhead, r]);

  async function simulate() {
    setBusy(true);
    setError(null);
    try {
      const { reservation } = await api<{ reservation: ReservationView }>(`/api/reservations/${encodeURIComponent(id)}/simulate`, { method: "POST", json: {} });
      setR(reservation);
      setPlayhead(0);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Simulation failed to start.");
    } finally {
      setBusy(false);
    }
  }

  if (!r) {
    return error ? (
      <Alert tone="danger" title="Reservation unavailable">
        {error} <Link href="/drive" className="underline">Request a charge</Link>
      </Alert>
    ) : (
      <p aria-live="polite" className="text-muted">Loading reservation…</p>
    );
  }

  const records = r.simulation?.records ?? [];
  const shown = playhead === null ? records.length : Math.min(playhead, records.length);
  const showReceipt = r.proofs.some((p) => p.type === "CAPTURED" || p.type === "VOIDED") || r.paymentState === "CAPTURE_PENDING" || r.paymentState === "CAPTURE_DECLINED";

  return (
    <div className="space-y-8">
      <header className="space-y-3 no-print">
        <p className="meta break-all">Reservation {r.id}</p>
        <p className="meta">
          Night of {new Intl.DateTimeFormat("en-US", { timeZone: r.timeZone, weekday: "short", month: "short", day: "numeric" }).format(r.plugInMs)} · parked {formatLocalTime(r.plugInMs, r.timeZone)} → departs{" "}
          {formatLocalTime(r.departMs, r.timeZone)}
        </p>
        <h1 className="font-semibold tracking-[-0.03em] leading-[1.05] text-[clamp(30px,4.2vw,44px)]">
          {formatUsd(r.economics.priceCents)} for {formatKWh(r.targetBatteryWh)} on port {r.portLabel}
        </h1>
        <div className="flex flex-wrap items-center gap-2 badge-wrap">
          {r.providerMode === "MOCK" ? <Badge tone="warn">MOCK payment · simulated</Badge> : <Badge tone="info">PayPal Sandbox</Badge>}
          <span className="meta">provider: {r.providerMode === "PAYPAL_SANDBOX" ? "PayPal Sandbox" : "MOCK (not PayPal)"}</span>
        </div>
      </header>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="no-print">
        <RecoveryConsent r={r} onChanged={() => void load()} />
        {r.recovery && <RecoveryStatus recovery={r.recovery} />}
      </div>

      <div className="grid gap-5 min-[900px]:grid-cols-2 no-print">
        <ChargingPanel r={r} shown={shown} busy={busy} onSimulate={simulate} />
        <PaymentPanel r={r} />
      </div>

      {showReceipt && <FlexReceipt r={r} />}

      <AskAssistant reservationId={r.id} />

      <p className="text-[14px] no-print">
        <Link href="/drive" className="underline underline-offset-4">
          Request another charge
        </Link>
      </p>
    </div>
  );
}
