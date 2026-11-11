"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { DISTURBANCE_LABEL } from "@/components/recoveryCopy";
import { Alert } from "@/components/ui";
import { CapacityStrip } from "./CapacityStrip";
import { ScheduleTable } from "./ScheduleTable";
import { scheduleSummary, timeLabel, type ScheduleLane } from "./scheduleModel";
import { useScheduleView } from "./useScheduleView";

/** Bryntum is loaded only on this operator route, never in public pages, and never on the server. */
const ScheduleChart = dynamic(() => import("./ScheduleChart").then((m) => m.ScheduleChart), {
  ssr: false,
  loading: () => <p className="p-4 text-muted" aria-live="polite">Loading timeline…</p>,
});

type Gate = "checking" | "operator" | "signed-out";

const LANES: { lane: ScheduleLane; label: string }[] = [
  { lane: "ORIGINAL", label: "Original plan" },
  { lane: "CURRENT", label: "Current (recovered)" },
];

export function ScheduleBoard({ nightOf }: { nightOf: string | null }) {
  const [gate, setGate] = useState<Gate>("checking");
  const [lane, setLane] = useState<ScheduleLane>("CURRENT");
  const { view, model, error, notice, dismissNotice, retry } = useScheduleView(nightOf);

  useEffect(() => {
    api<{ operator: boolean }>("/api/operator/session")
      .then((s) => setGate(s.operator ? "operator" : "signed-out"))
      .catch(() => setGate("signed-out"));
  }, []);

  if (gate === "checking") return <p aria-live="polite" className="text-muted">Checking operator session…</p>;
  if (gate === "signed-out") {
    return (
      <Alert tone="warn" title="Operator sign-in required">
        <Link href="/operator" className="underline underline-offset-4">Sign in to the operator console</Link> to view the schedule.
      </Alert>
    );
  }
  if (error && !model) {
    return (
      <Alert tone="danger" title="Schedule unavailable">
        <p>{error}</p>
        <button type="button" className="btn btn-sm mt-3" onClick={retry}>
          Retry
        </button>
      </Alert>
    );
  }
  if (!view || !model) {
    return (
      <div aria-live="polite" aria-busy="true" className="space-y-3">
        <p className="text-muted">Loading schedule…</p>
        <div className="skeleton h-64" aria-hidden="true" />
      </div>
    );
  }
  if (model.sessions.length === 0) {
    return (
      <Alert tone="neutral" title="No scheduled sessions for this night">
        Sessions appear here once a driver&apos;s charge is authorized and scheduled.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {notice && (
        <div role="status" className="card p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px]">
            Schedule updated by recovery at {timeLabel(notice.at.getTime(), view.timeZone)}, version {notice.version}.
          </p>
          <button type="button" className="btn btn-sm" onClick={dismissNotice}>
            Dismiss
          </button>
        </div>
      )}
      {error && <Alert tone="warn">Latest refresh failed; showing the last loaded schedule. {error}</Alert>}
      <p id="schedule-summary" aria-live="polite" className="meta">
        {scheduleSummary(model)}
      </p>

      <section className="card p-4 sm:p-5 space-y-4 min-w-0" aria-labelledby="timeline-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="timeline-title" className="text-[20px] font-semibold">
            Timeline
          </h2>
          <div role="group" aria-label="Plan shown on the timeline" className="flex gap-2">
            {LANES.map((l) => (
              <button
                key={l.lane}
                type="button"
                aria-pressed={lane === l.lane}
                className={`btn btn-sm ${lane === l.lane ? "btn-primary" : ""}`}
                onClick={() => setLane(l.lane)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="max-w-full overflow-hidden" data-testid="schedule-chart">
          <ScheduleChart model={model} lane={lane} />
        </div>
        {model.pendingProposals > 0 && (
          <p className="meta">Proposed bars await the driver&apos;s approval. They are not committed and are not part of the current plan.</p>
        )}
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
          {model.disruptions.map((d) => (
            <li key={d.eventId}>
              {DISTURBANCE_LABEL[d.type]} from {timeLabel(d.atMs, model.timeZone)} · SYNTHETIC
              {d.runStatus ? ` · run ${d.runStatus}` : ""}
              {d.runReason ? ` · ${d.runReason}` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-4 sm:p-5 space-y-4" aria-labelledby="capacity-title">
        <h2 id="capacity-title" className="text-[20px] font-semibold">
          Site demand vs usable limit
        </h2>
        <CapacityStrip model={model} />
      </section>

      <section className="space-y-3" aria-labelledby="table-title">
        <h2 id="table-title" className="text-[20px] font-semibold">
          Table view
        </h2>
        <ScheduleTable model={model} />
      </section>
    </div>
  );
}
