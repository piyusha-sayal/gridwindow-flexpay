import type { SessionReservation } from "@/server/services/sessionService";
import { formatStamp } from "./rewardsFormat";

export function EventTrail({ events, timeZone }: { events: SessionReservation["events"]; timeZone: string }) {
  return (
    <details className="disclosure text-[13px]">
      <summary className="cursor-pointer font-medium text-text-2">Events ({events.length})</summary>
      {events.length === 0 ? (
        <p className="mt-2 text-muted">No events recorded.</p>
      ) : (
        <ol className="timeline mt-3 space-y-1.5 break-words font-mono text-[12px] text-text-2">
          {events.map((e, i) => (
            <li key={`${e.occurredAt}-${i}`}>
              {formatStamp(Date.parse(e.occurredAt), timeZone)} · {e.source} · {e.type}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
