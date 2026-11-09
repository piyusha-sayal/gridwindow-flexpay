import { formatKWh } from "@/domain/units";
import type { SessionReservation } from "@/server/services/sessionService";

const stampFormats = new Map<string, Intl.DateTimeFormat>();

/** Time-zone-aware timestamp in the station's zone, e.g. "5 Nov 2026, 19:00 EST". */
export function formatStamp(ms: number, timeZone: string): string {
  let format = stampFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });
    stampFormats.set(timeZone, format);
  }
  return format.format(ms);
}

export function windowLabel(r: Pick<SessionReservation, "offer" | "timeZone">): string {
  return `${formatStamp(r.offer.plugInMs, r.timeZone)} to ${formatStamp(r.offer.departMs, r.timeZone)}`;
}

export function batteryLabel(wh: number): string {
  return formatKWh(wh);
}

export function simulationLabel(outcome: SessionReservation["simulationOutcome"]): string {
  if (outcome === "DELIVERED") return "Charging delivered (synthetic simulation)";
  if (outcome === "FAILED") return "Charging failed (synthetic simulation)";
  return "Charging not simulated yet";
}
