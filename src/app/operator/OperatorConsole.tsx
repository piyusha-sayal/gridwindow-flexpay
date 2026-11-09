"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/components/api";
import { Alert } from "@/components/ui";
import type { DashboardSession, OperatorDashboard } from "@/server/services/viewService";
import { DemoTools } from "./DemoTools";
import { DetailPanel } from "./DetailPanel";
import { LoadPanel } from "./LoadPanel";
import { NightKpis } from "./NightKpis";
import { PortTimeline } from "./PortTimeline";
import { RecoveryPanel } from "./RecoveryPanel";
import { ReservationTable, type OperatorAction } from "./ReservationTable";

export function OperatorConsole() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ operator: boolean }>("/api/operator/session")
      .then((s) => setAuthed(s.operator))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <p aria-live="polite" className="text-muted">Checking operator session…</p>;
  if (!authed) return <Login onDone={() => setAuthed(true)} error={error} setError={setError} />;
  return (
    <Dashboard
      onSignOut={async () => {
        await api("/api/operator/session", { method: "DELETE" }).catch(() => undefined);
        setAuthed(false);
      }}
    />
  );
}

function Login({ onDone, error, setError }: { onDone: () => void; error: string | null; setError: (e: string | null) => void }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/operator/session", { method: "POST", json: { passphrase: pass } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="card p-6 sm:p-8 max-w-sm mx-auto space-y-5">
      <p className="eyebrow">Operator</p>
      <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Operator sign-in</h1>
      {error && (
        <p role="alert" className="text-red text-[14px]">
          {error}
        </p>
      )}
      <div>
        <label htmlFor="pass" className="label">
          Passphrase
        </label>
        <input id="pass" type="password" autoComplete="current-password" className="field" value={pass} onChange={(e) => setPass(e.target.value)} required />
      </div>
      <button className="btn btn-primary btn-lg w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

type DashboardResponse = { dashboard: OperatorDashboard; demoTools: boolean };

const ACTION_DONE: Record<OperatorAction["kind"], string> = {
  simulate: "Delivery simulated",
  outage: "Outage injected",
  reconcile: "Reconciled with provider",
  "simulate-pending": "Delivered · capture pending",
  "simulate-declined": "Delivered · capture declined",
  "resolve-capture": "Provider capture resolved",
};

/** Station name and default night come from the public config, not from code. */
type StationConfig = { station: { name: string }; defaultNightOf: string };

async function fetchDashboard(nightOf: string): Promise<DashboardResponse> {
  return api<DashboardResponse>(`/api/operator/dashboard${nightOf ? `?night=${encodeURIComponent(nightOf)}` : ""}`);
}

function actionRequest(s: DashboardSession, action: OperatorAction): { path: string; json: Record<string, unknown> } {
  const base = `/api/operator/reservations/${encodeURIComponent(s.id)}`;
  switch (action.kind) {
    case "outage": {
      const first = s.powerW.findIndex((w) => w > 0);
      return { path: `${base}/simulate`, json: { outage: { fromSlot: Math.max(0, first), toSlot: s.powerW.length } } };
    }
    case "simulate-pending":
      return { path: `${base}/simulate`, json: { mockCaptureOutcome: "PENDING" } };
    case "simulate-declined":
      return { path: `${base}/simulate`, json: { mockCaptureOutcome: "DECLINED" } };
    case "resolve-capture":
      return { path: `${base}/mock-capture`, json: { status: action.status } };
    case "reconcile":
      return { path: `${base}/reconcile`, json: {} };
    default:
      return { path: `${base}/simulate`, json: {} };
  }
}

function Dashboard({ onSignOut }: { onSignOut: () => void }) {
  const [night, setNight] = useState<string>("");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [config, setConfig] = useState<StationConfig | null>(null);

  useEffect(() => {
    api<StationConfig>("/api/config").then(setConfig, () => setConfig(null));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const apply = useCallback((res: DashboardResponse) => {
    setData(res);
    setNight(res.dashboard.nightOf);
    setError(null);
    setVersion((v) => v + 1);
  }, []);
  const fail = useCallback((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load dashboard."), []);
  const load = useCallback((nightOf: string) => fetchDashboard(nightOf).then(apply, fail), [apply, fail]);

  useEffect(() => {
    let alive = true;
    fetchDashboard("").then(
      (res) => alive && apply(res),
      (e: unknown) => alive && fail(e),
    );
    return () => {
      alive = false;
    };
  }, [apply, fail]);

  async function act(s: DashboardSession, action: OperatorAction) {
    setBusyId(s.id);
    setError(null);
    try {
      const { path, json } = actionRequest(s, action);
      await api(path, { method: "POST", json });
      await load(night);
      setToast(`${ACTION_DONE[action.kind]} · ${s.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (!data) return error ? <Alert tone="danger" title="Dashboard unavailable">{error}</Alert> : (
      <div aria-live="polite" aria-busy="true" className="space-y-3">
        <p className="text-muted">Loading dashboard…</p>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-20" />
          ))}
        </div>
      </div>
    );
  const d = data.dashboard;
  const site = config?.station.name.replace(/\s*\(synthetic\)$/i, "") ?? "the station";
  const when = config && d.nightOf === config.defaultNightOf ? "Tonight" : `Night of ${d.nightOf}`;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="space-y-2">
          <p className="meta">
            {d.ports.length} ports · provider {d.providerMode === "PAYPAL_SANDBOX" ? "PayPal Sandbox" : "MOCK (simulated)"} · synthetic site and tariff
          </p>
          <h1 className="font-semibold tracking-[-0.03em] leading-[1.05] text-[clamp(30px,4.2vw,44px)]">
            {when} at {site}
          </h1>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load(night);
          }}
        >
          <div>
            <label htmlFor="night" className="label">
              Night of
            </label>
            <input id="night" type="date" className="field" value={night} onChange={(e) => setNight(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary">
            Load
          </button>
          <Link href="/operator/schedule" className="btn">
            Schedule view
          </Link>
          <button type="button" className="btn" onClick={onSignOut}>
            Sign out
          </button>
        </form>
      </header>

      {error && <Alert tone="danger">{error}</Alert>}

      <NightKpis d={d} />

      {data.demoTools && <DemoTools nightOf={d.nightOf} onDone={() => void load(d.nightOf)} />}

      {d.sessions.length === 0 ? (
        <section className="card p-8 text-center space-y-4" aria-labelledby="empty-title">
          <h2 id="empty-title" className="text-[22px] font-semibold">
            No reservations for this night yet
          </h2>
          <p className="text-muted text-[14px]">Create one from the driver page{data.demoTools ? " or seed background drivers with the demo tools above" : ""}.</p>
          <Link href="/drive" className="btn btn-primary">
            Open driver flow
          </Link>
        </section>
      ) : (
        <>
          <PortTimeline d={d} selectedId={selectedId} onSelect={setSelectedId} />
          <ReservationTable d={d} busyId={busyId} selectedId={selectedId} onAct={(s, a) => void act(s, a)} onSelect={setSelectedId} />
        </>
      )}
      <LoadPanel d={d} />
      <RecoveryPanel nightOf={d.nightOf} />
      {selectedId && <DetailPanel id={selectedId} version={version} onClose={() => setSelectedId(null)} />}
      {toast && (
        <div
          role="status"
          className="fixed left-1/2 z-40 flex w-[min(560px,calc(100%-2rem))] -translate-x-1/2 items-center justify-between gap-4 rounded-[var(--r-card-sm)] bg-ink px-4 py-3 text-[14px] text-white shadow-[var(--shadow-receipt)]"
          style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{toast}</span>
          <button type="button" className="font-mono text-[12px] text-teal-bright" onClick={() => setToast(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
