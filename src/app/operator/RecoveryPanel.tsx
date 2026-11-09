"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/components/api";
import { DISTURBANCE_LABEL, RUN_STATUS_LABEL } from "@/components/recoveryCopy";
import { Alert, Badge } from "@/components/ui";
import { DISTURBANCE_TYPES, type DisturbanceType } from "@/domain/disturbance";
import type { ScheduleDisruptionView, ScheduleSessionView, ScheduleView } from "@/server/services/scheduleView";
import { RecoveryRunDetail } from "./RecoveryRunDetail";
import { buildInjection, newEventId } from "./recoveryForm";

function runLabel(status: string): string {
  return (RUN_STATUS_LABEL as Record<string, string>)[status] ?? status;
}

const VALUE_LABEL: Partial<Record<DisturbanceType, { label: string; initial: number }>> = {
  CHARGER_POWER_REDUCTION: { label: "Maximum port power (W)", initial: 1800 },
  SITE_CAP_REDUCTION: { label: "Station cap (W)", initial: 12000 },
  EARLY_DEPARTURE: { label: "Minutes early", initial: 60 },
};

interface SchedulePayload {
  schedule: ScheduleView;
}

export function RecoveryPanel({ nightOf }: { nightOf: string }) {
  const [schedule, setSchedule] = useState<ScheduleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reservationId, setReservationId] = useState("");
  const [type, setType] = useState<DisturbanceType>("CHARGER_POWER_REDUCTION");
  const [slot, setSlot] = useState(0);
  const [value, setValue] = useState(VALUE_LABEL.CHARGER_POWER_REDUCTION!.initial);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);

  const load = useCallback(() => {
    return api<SchedulePayload>(`/api/schedule?nightOf=${encodeURIComponent(nightOf)}`).then(
      ({ schedule: s }) => {
        setSchedule(s);
        setError(null);
        setReservationId((current) => (current && s.sessions.some((x) => x.reservationId === current) ? current : (s.sessions[0]?.reservationId ?? "")));
      },
      (e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load recovery data."),
    );
  }, [nightOf]);

  useEffect(() => {
    void load();
  }, [load]);

  function chooseType(next: DisturbanceType) {
    setType(next);
    setValue(VALUE_LABEL[next]?.initial ?? 0);
  }

  async function inject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const session: ScheduleSessionView | undefined = schedule?.sessions.find((s) => s.reservationId === reservationId);
    if (!session) {
      setError("Choose a session to disturb.");
      return;
    }
    const built = buildInjection({ type, reservationId, effectiveSlot: slot, value }, session.departMs, newEventId(Date.now()));
    if (!built.ok) {
      setError(built.message);
      return;
    }
    setSubmitting(true);
    try {
      const res = await api<{ event: { eventId: string }; created: boolean }>("/api/recovery/events", { method: "POST", json: built.request });
      setSelectedEvent(res.event.eventId);
      setNotice(`${DISTURBANCE_LABEL[type]} recorded as SYNTHETIC (${res.event.eventId}). Recovery is running.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The disturbance could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  const valueField = VALUE_LABEL[type];
  const selectedReservation = schedule?.disruptions.find((d) => d.eventId === selectedEvent)?.reservationId ?? null;
  return (
    <section className="card p-5 sm:p-6 space-y-5" aria-labelledby="recovery-title">
      <div className="space-y-1">
        <p className="eyebrow">Synthetic disturbance</p>
        <h2 id="recovery-title" className="text-[22px] font-semibold tracking-[-0.01em]">
          Recovery engine
        </h2>
        <p className="meta">Injected disturbances are simulated inputs. They are not real grid or charger events.</p>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}

      {!schedule ? (
        <p aria-live="polite" className="text-muted">
          Loading sessions…
        </p>
      ) : schedule.sessions.length === 0 ? (
        <p className="text-muted text-[14px]">No authorized, scheduled sessions on this night to disturb.</p>
      ) : (
        <form onSubmit={(e) => void inject(e)} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 items-end" aria-label="Inject a synthetic disturbance">
          <div>
            <label htmlFor="rec-session" className="label">
              Session
            </label>
            <select id="rec-session" className="field" value={reservationId} onChange={(e) => setReservationId(e.target.value)}>
              {schedule.sessions.map((s) => (
                <option key={s.reservationId} value={s.reservationId}>
                  Port {s.portLabel} · {s.reservationId.slice(-8)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rec-type" className="label">
              Disturbance
            </label>
            <select id="rec-type" className="field" value={type} onChange={(e) => chooseType(e.target.value as DisturbanceType)}>
              {DISTURBANCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DISTURBANCE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rec-slot" className="label">
              Effective slot
            </label>
            <input id="rec-slot" type="number" min={0} step={1} className="field" value={slot} onChange={(e) => setSlot(Number(e.target.value))} />
          </div>
          <div>
            {valueField ? (
              <>
                <label htmlFor="rec-value" className="label">
                  {valueField.label}
                </label>
                <input id="rec-value" type="number" min={1} step={1} className="field" value={value} onChange={(e) => setValue(Number(e.target.value))} />
              </>
            ) : (
              <p className="meta">No parameter needed</p>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Recording…" : "Inject SYNTHETIC disturbance"}
          </button>
        </form>
      )}

      {schedule && schedule.disruptions.length > 0 && (
        <DisturbanceList disruptions={schedule.disruptions} selected={selectedEvent} onSelect={setSelectedEvent} timeZone={schedule.timeZone} />
      )}
      {selectedEvent && selectedReservation && <RecoveryRunDetail key={selectedEvent} eventId={selectedEvent} reservationId={selectedReservation} />}
    </section>
  );
}

function DisturbanceList({
  disruptions,
  selected,
  onSelect,
  timeZone,
}: {
  disruptions: ScheduleDisruptionView[];
  selected: string | null;
  onSelect: (id: string) => void;
  timeZone: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-[16px] font-semibold">Recorded disturbances</h3>
      <ul className="space-y-2">
        {disruptions.map((d) => (
          <li key={d.eventId}>
            <button
              type="button"
              aria-pressed={selected === d.eventId}
              onClick={() => onSelect(d.eventId)}
              className="w-full flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-card-sm)] border border-line px-3 py-2 text-left text-[14px] hover:bg-paper"
            >
              <span>
                {DISTURBANCE_LABEL[d.type]} · effective slot {d.effectiveSlot}
                <span className="block meta">{d.eventId} · {timeZone}</span>
              </span>
              <span className="flex flex-wrap gap-2">
                <Badge tone="neutral">SYNTHETIC</Badge>
                {d.runStatus && <Badge tone={d.runStatus === "NEEDS_APPROVAL" ? "warn" : "info"}>{runLabel(d.runStatus)}</Badge>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="meta">Select a disturbance to see its run, reasoning, proposal and payment state.</p>
    </div>
  );
}
