"use client";

import { useState } from "react";
import { api, ApiError } from "@/components/api";
import type { AiSource } from "@/components/ui";

type Explanation = { summary: string; points: string[] } & AiSource;
type State = { status: "closed" | "loading" } | { status: "done"; data: Explanation } | { status: "error"; message: string };

/** "Why is it cheaper?" disclosure. Loads on first open; the server supplies every figure and verifies model text. */
export function AiExplain({ quoteSetId, offerId }: { quoteSetId: string; offerId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ status: "closed" });

  async function load() {
    setState({ status: "loading" });
    try {
      setState({ status: "done", data: await api<Explanation>("/api/assist/explain", { method: "POST", json: { quoteSetId, offerId } }) });
    } catch (e) {
      setState({ status: "error", message: e instanceof ApiError ? e.message : "Could not load the explanation." });
    }
  }

  function toggle() {
    setOpen(!open);
    if (!open && state.status === "closed") void load();
  }

  return (
    <div className="ai-panel">
      <button type="button" className="ai-toggle flex w-full items-center gap-3 text-left text-[16px] font-semibold" aria-expanded={open} aria-controls={`why-${offerId}`} onClick={toggle}>
        <span aria-hidden="true" className="ico ico-spark" />
        Why is it cheaper?
        <span aria-hidden="true" className="ai-chevron font-mono text-muted">
          {open ? "−" : "+"}
        </span>
      </button>
      <div id={`why-${offerId}`} hidden={!open} className="ai-body pt-3 space-y-3 text-[15px]" aria-live="polite" aria-busy={state.status === "loading"}>
        <p className="meta">Every number checked against the quote</p>
        {state.status === "loading" && <p className="working text-muted">Explaining…</p>}
        {state.status === "error" && (
          <p role="alert" className="text-red">
            {state.message}{" "}
            <button type="button" className="underline" onClick={load}>
              Retry
            </button>
          </p>
        )}
        {state.status === "done" && (
          <>
            <p>{state.data.summary}</p>
            <ul className="list-disc pl-5 space-y-1 text-text-2">
              {state.data.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
