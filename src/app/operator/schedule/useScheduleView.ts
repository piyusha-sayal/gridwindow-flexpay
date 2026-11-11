"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/components/api";
import type { ScheduleView } from "@/server/services/scheduleView";
import { buildScheduleModel, recoveryRevisionKey, type ProposalInput, type ScheduleModel } from "./scheduleModel";

export const POLL_MS = 3_000;

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

/** Pending proposals come only from the persisted run the server attaches to a session awaiting approval. */
function proposalsFor(view: ScheduleView): ProposalInput[] {
  return view.sessions.flatMap((session) => {
    const pending = session.pendingApproval;
    if (!pending) return [];
    return [{ runId: pending.runId, reservationId: session.reservationId, portId: session.portId, powerW: pending.proposed.powerW, effectiveDepartMs: session.effectiveDepartMs }];
  });
}

function maxVersion(view: ScheduleView): number {
  return Math.max(1, ...view.sessions.map((s) => s.currentVersion));
}

/** A loaded schedule or a load error, tagged with the night it was requested for (null: the server's default night). */
interface ForNight<T> {
  night: string | null;
  value: T;
}

/**
 * Loads the operator schedule and polls every few seconds while the tab is visible. A new revision raises a notice;
 * the view is replaced only when the revision actually changes, so an unchanged poll never disturbs the chart.
 * Data and errors are returned only for the night they were loaded for, so a night change never shows another night.
 */
export function useScheduleView(nightOf: string | null): ScheduleState {
  const [loaded, setLoaded] = useState<ForNight<{ view: ScheduleView; model: ScheduleModel }> | null>(null);
  const [failure, setFailure] = useState<ForNight<string> | null>(null);
  const [notice, setNotice] = useState<ScheduleVersionNotice | null>(null);
  const [tick, setTick] = useState(0);
  const revisionRef = useRef<string | null>(null);
  const recoveryRevisionRef = useRef<string | null>(null);
  const nightRef = useRef<string | null>(nightOf);

  const retry = useCallback(() => setTick((t) => t + 1), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    if (nightRef.current !== nightOf) {
      nightRef.current = nightOf;
      revisionRef.current = null;
      recoveryRevisionRef.current = null;
      setNotice(null);
    }
  }, [nightOf]);

  useEffect(() => {
    let alive = true;
    async function load() {
      const night = nightRef.current;
      try {
        const next = await fetchView(night);
        // A response for a night the board has already left is dropped.
        if (!alive || night !== nightRef.current) return;
        const proposals = proposalsFor(next);
        const nextModel = buildScheduleModel(next, proposals);
        const recoveryRevision = recoveryRevisionKey(next, proposals);
        const changed = recoveryRevisionRef.current !== null && recoveryRevisionRef.current !== recoveryRevision;
        if (revisionRef.current === nextModel.revision) return;
        revisionRef.current = nextModel.revision;
        recoveryRevisionRef.current = recoveryRevision;
        setLoaded({ night, value: { view: next, model: nextModel } });
        setFailure(null);
        if (changed) setNotice({ version: maxVersion(next), at: new Date() });
      } catch (e) {
        if (!alive || night !== nightRef.current) return;
        setFailure({ night, value: e instanceof ApiError ? e.message : "Could not load the schedule." });
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

  const current = loaded?.night === nightOf ? loaded.value : null;
  return {
    view: current?.view ?? null,
    model: current?.model ?? null,
    error: failure?.night === nightOf ? failure.value : null,
    notice: current ? notice : null,
    dismissNotice,
    retry,
  };
}
