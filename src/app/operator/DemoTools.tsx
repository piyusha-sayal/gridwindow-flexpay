"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/components/api";

/** Dev-only controls; the server refuses them unless DEMO_TOOLS=true, MOCK mode and an operator session. */
export function DemoTools({ nightOf, onDone }: { nightOf: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);

  // Focus the safe choice when the destructive confirmation appears; return focus when it closes.
  useEffect(() => {
    if (confirmReset) keepRef.current?.focus();
  }, [confirmReset]);

  function cancelReset() {
    setConfirmReset(false);
    requestAnimationFrame(() => resetRef.current?.focus());
  }

  async function run(json: Record<string, string>, done: (res: { seeded?: string[] }) => string) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(done(await api<{ seeded?: string[] }>("/api/operator/demo", { method: "POST", json })));
      onDone();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Demo action failed.");
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  }

  return (
    <section className="rounded-[var(--r-card-sm)] border border-dashed border-line-strong px-4 py-3 space-y-2" aria-labelledby="demo-title">
      <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
      <h2 id="demo-title" className="font-mono text-[11px] font-medium tracking-[0.1em] uppercase text-muted">
        Demo tools (development only · MOCK)
      </h2>
        <button className="btn btn-sm" disabled={busy} onClick={() => run({ action: "seed", nightOf }, (r) => `Seeded ${r.seeded?.length ?? 0} background reservation(s) through the real checkout flow.`)}>
          Seed background drivers for {nightOf}
        </button>
        {confirmReset ? (
          <div role="group" aria-labelledby="reset-q" className="flex flex-wrap gap-2 items-center" onKeyDown={(e) => e.key === "Escape" && cancelReset()}>
            <span id="reset-q" className="text-[14px] text-red">
              Delete all reservations, quotes and events?
            </span>
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => run({ action: "reset", confirm: "RESET" }, () => "All demo data was reset.")}>
              Yes, reset
            </button>
            <button ref={keepRef} className="btn btn-sm" onClick={cancelReset}>
              Keep data
            </button>
          </div>
        ) : (
          <button ref={resetRef} className="btn btn-sm" disabled={busy} onClick={() => setConfirmReset(true)}>
            Reset demo data…
          </button>
        )}
      </div>
      {message && (
        <p className="text-[14px] text-muted" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
