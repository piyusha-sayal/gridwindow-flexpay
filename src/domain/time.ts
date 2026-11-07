import { SLOT_MS } from "./units";

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** Wall-clock parts of a UTC instant in an IANA time zone. */
export function localParts(utcMs: number, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`missing ${type} part`);
    return Number(part.value);
  };
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function offsetMs(utcMs: number, timeZone: string): number {
  const p = localParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(utcMs / 60_000) * 60_000;
}

/**
 * Convert a local wall time to a UTC instant. For an ambiguous (repeated) hour the
 * earlier instant is returned; a non-existent (skipped) time resolves forward.
 */
export function zonedTimeToUtc(local: LocalParts, timeZone: string): number {
  const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const firstGuess = naive - offsetMs(naive, timeZone);
  const earlier = naive - offsetMs(firstGuess - 3_600_000, timeZone);
  const later = naive - offsetMs(firstGuess + 3_600_000, timeZone);
  const candidates = [earlier, firstGuess, later].filter((c) => {
    const p = localParts(c, timeZone);
    return p.year === local.year && p.month === local.month && p.day === local.day && p.hour === local.hour && p.minute === local.minute;
  });
  if (candidates.length > 0) return Math.min(...candidates);
  return Math.max(firstGuess, later);
}

export function addLocalDays(date: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function parseLocalDate(value: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new RangeError(`invalid local date ${value}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** A night's planning horizon of 15-minute slots, anchored in UTC (DST-safe). */
export interface SlotGrid {
  startMs: number;
  slotCount: number;
  timeZone: string;
}

export function buildNightGrid(nightOf: string, timeZone: string, startHour = 18, endHour = 10): SlotGrid {
  const date = parseLocalDate(nightOf);
  const startMs = zonedTimeToUtc({ ...date, hour: startHour, minute: 0 }, timeZone);
  const endMs = zonedTimeToUtc({ ...addLocalDays(date, 1), hour: endHour, minute: 0 }, timeZone);
  if ((endMs - startMs) % SLOT_MS !== 0) throw new Error("horizon is not slot aligned");
  return { startMs, slotCount: (endMs - startMs) / SLOT_MS, timeZone };
}

export function slotStartMs(grid: SlotGrid, index: number): number {
  return grid.startMs + index * SLOT_MS;
}

export function gridEndMs(grid: SlotGrid): number {
  return grid.startMs + grid.slotCount * SLOT_MS;
}

export function formatLocalTime(utcMs: number, timeZone: string): string {
  const p = localParts(utcMs, timeZone);
  return `${p.hour.toString().padStart(2, "0")}:${p.minute.toString().padStart(2, "0")}`;
}
