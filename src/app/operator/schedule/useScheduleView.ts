"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/components/api";
import type { ScheduleDisruptionView, ScheduleView } from "@/server/services/scheduleView";
import type { RecoveryRunView } from "@/server/services/recoveryRuns";
import { buildScheduleModel, type ProposalInput, type ScheduleModel } from "./scheduleModel";

export const POLL_MS = 3_000;

/** The server may attach the latest run id to each disruption. Read it defensively: absent means no proposal can be fetched. */
type DisruptionWithRun = ScheduleDisruptionView & { runId?: string };

export interface ScheduleVersionNotice {
  /** Highest committed schedule version on the night when the change was seen. */
  version: number;
  at: Date;
}

export interface ScheduleState {
  view: ScheduleView | null;
  model: ScheduleModel | null;
  error: string | null;
  notice: ScheduleVersionNotice | null;
  dismissNotice: () => void;
  retry: () => void;
}

async function fetchView(nightOf: string | null): Promise<ScheduleView> {
  const query = nightOf ? `?nightOf=${encodeURIComponent(nightOf)}` : "";
  return (await api<{ schedule: ScheduleView }>(`/api/schedule${query}`)).schedule;
}

/** Pending proposals come only from persisted runs awaiting approval. Nothing is inferred from the disruption alone. */
async function fetchProposals(view: ScheduleView): Promise<ProposalInput[]> {
  const pending = (view.disruptions as DisruptionWithRun[]).filter((d) => d.runStatus === "NEEDS_APPROVAL" && d.runId);
  const runs = await Promise.all(
    pending.map(async (d) => {
      const { run } = await api<{ run: RecoveryRunView }>(`/api/recovery/runs/${encodeURIComponent(d.runId!)}`);
      return { d, run };
    }),
  );
  const proposals: ProposalInput[] = [];
  for (const { d, run } of runs) {
    const session = view.sessions.find((s) => s.reservationId === d.reservationId);
    if (!session || !run.proposal) continue;
    proposals.push({ runId: run.runId, reservationId: session.reservationId, portId: session.portId, powerW: run.proposal.powerW, effectiveDepartMs: session.effectiveDepartMs });
  }
  return proposals;
}

function maxVersion(view: ScheduleView): number {
  return Math.max(1, ...view.sessions.map((s) => s.currentVersion));
}

/**
 * Loads the operator schedule and polls every few seconds while the tab is visible. A new revision raises a notice;
 * the view is replaced only when the revision actually changes, so an unchanged poll never disturbs the chart.
 */
export function useScheduleView(nightOf: string | null): ScheduleState {
  const [view, setView] = useState<ScheduleView | null>(null);
  const [model, setModel] = useState<ScheduleModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ScheduleVersionNotice | null>(null);
  const [tick, setTick] = useState(0);
  const revisionRef = useRef<string | null>(null);
  const nightRef = useRef<string | null>(nightOf);

  const retry = useCallback(() => setTick((t) => t + 1), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    if (nightRef.current !== nightOf) {
      nightRef.current = nightOf;
      revisionRef.current = null;
      setNotice(null);
    }
  }, [nightOf]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const next = await fetchView(nightRef.current);
        const proposals = await fetchProposals(next);
        if (!alive) return;
        const nextModel = buildScheduleModel(next, proposals);
        const changed = revisionRef.current !== null && revisionRef.current !== nextModel.revision;
        if (revisionRef.current === nextModel.revision) return;
        revisionRef.current = nextModel.revision;
        setView(next);
        setModel(nextModel);
        setError(null);
        if (changed) setNotice({ version: maxVersion(next), at: new Date() });
      } catch (e) {
        if (!alive) return;
        setError(e instanceof ApiError ? e.message : "Could not load the schedule.");
      }
    }
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tick, nightOf]);

  return { view, model, error, notice, dismissNotice, retry };
}
