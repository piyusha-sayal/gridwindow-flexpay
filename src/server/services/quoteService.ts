import { createHash } from "node:crypto";
import { z } from "zod";
import { generateQuote, type QuoteSet } from "@/domain/quotes";
import { allocationContext, buildNightScenario, FORECAST_LABEL, type NightScenario } from "@/domain/scenario";
import type { ChargeRequest, StationConfig } from "@/domain/station";
import { addLocalDays, localParts, parseLocalDate, zonedTimeToUtc } from "@/domain/time";
import { committedPlans } from "../repo";
import { ServiceError, type AppDeps } from "../deps";

/** Charging efficiency is a server-side assumption, never client supplied. */
export const ASSUMED_EFFICIENCY_BP = 9_200;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM");

export const quoteRequestSchema = z
  .object({
    portId: z.string().min(1).max(32),
    nightOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    plugInLocal: hhmm,
    departLocal: hhmm,
    targetBatteryKWh: z
      .number()
      .positive()
      .max(120)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "at most 2 decimals"),
    spendCapCents: z.number().int().min(100).max(50_000),
    /** Driver-confirmed mandatory minimum saving; omitted when the saving is only a preference. */
    requiredMinSavingsCents: z.number().int().min(1).max(50_000).optional(),
  })
  .strict();

export type QuoteRequestInput = z.infer<typeof quoteRequestSchema>;

/** Deterministic seed per night so every quote that night sees the same synthetic forecast. */
export function nightSeed(stationId: string, nightOf: string): number {
  return createHash("sha256").update(`${stationId}:${nightOf}`).digest().readUInt32BE(0);
}

export function scenarioFor(station: StationConfig, nightOf: string): NightScenario {
  return buildNightScenario(station, nightOf, nightSeed(station.id, nightOf));
}

/** Default departure prefilled on the driver form (local time, next morning). */
export const DEFAULT_DEPART_HOUR = 7;
/** Default plug-in (local evening time) and the minimum lead before a later plug-in default. */
export const DEFAULT_PLUG_IN_HOUR = 19;
export const DEFAULT_PLUG_IN_LEAD_MIN = 15;

export interface DefaultWindow {
  nightOf: string;
  plugInLocal: string;
  departLocal: string;
}

const hhmmOf = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * Default charging window for the driver form, in station wall time: tonight (the station-local date
 * of `nowMs`), plugging in at 19:00 or, later in the evening, at the next quarter-hour at least
 * DEFAULT_PLUG_IN_LEAD_MIN ahead, and leaving at 07:00 next morning. The window never starts in the
 * past, so a default request can still be approved before its first scheduled slot.
 */
export function driverDefaultWindow(station: StationConfig, nowMs: number): DefaultWindow {
  const p = localParts(nowMs, station.timeZone);
  const earliest = Math.ceil((p.hour * 60 + p.minute + DEFAULT_PLUG_IN_LEAD_MIN) / 15) * 15;
  return {
    nightOf: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
    plugInLocal: hhmmOf(Math.max(DEFAULT_PLUG_IN_HOUR * 60, earliest)),
    departLocal: hhmmOf(DEFAULT_DEPART_HOUR * 60),
  };
}

const QUARTER_MS = 15 * 60 * 1000;
const dateOf = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/**
 * Window for a relative deadline ("in two hours"): plug in at the next quarter-hour, leave at the last
 * quarter-hour within the deadline. Computed on absolute time, so a DST change inside the window is
 * exact; times before noon belong to the previous evening's night, as everywhere else.
 */
export function relativeDeadlineWindow(station: StationConfig, nowMs: number, withinMinutes: number): DefaultWindow {
  const plugIn = localParts(Math.ceil(nowMs / QUARTER_MS) * QUARTER_MS, station.timeZone);
  const depart = localParts(Math.floor((nowMs + withinMinutes * 60_000) / QUARTER_MS) * QUARTER_MS, station.timeZone);
  return {
    nightOf: dateOf(plugIn.hour < 12 ? addLocalDays(plugIn, -1) : plugIn),
    plugInLocal: hhmmOf(plugIn.hour * 60 + plugIn.minute),
    departLocal: hhmmOf(depart.hour * 60 + depart.minute),
  };
}

/** Default night for the driver form and operator console (see driverDefaultWindow). */
export function driverDefaultNightOf(station: StationConfig, nowMs: number): string {
  return driverDefaultWindow(station, nowMs).nightOf;
}

/** Evening times (>= 12:00) belong to nightOf; early-morning times to the next day. */
function nightTimeToUtc(station: StationConfig, nightOf: string, local: string): number {
  const [hour, minute] = local.split(":").map(Number) as [number, number];
  const base = parseLocalDate(nightOf);
  const date = hour >= 12 ? base : addLocalDays(base, 1);
  return zonedTimeToUtc({ ...date, hour, minute }, station.timeZone);
}

export function toChargeRequest(station: StationConfig, input: QuoteRequestInput): ChargeRequest {
  if (!station.ports.some((p) => p.id === input.portId)) throw new ServiceError("UNKNOWN_PORT", "Unknown port.");
  const plugInMs = nightTimeToUtc(station, input.nightOf, input.plugInLocal);
  const departMs = nightTimeToUtc(station, input.nightOf, input.departLocal);
  if (departMs <= plugInMs) throw new ServiceError("INVALID_WINDOW", "Departure must be after plug-in.");
  return {
    portId: input.portId,
    plugInMs,
    departMs,
    targetBatteryWh: Math.round(input.targetBatteryKWh * 1000),
    efficiencyBp: ASSUMED_EFFICIENCY_BP,
    spendCapCents: input.spendCapCents,
  };
}

export async function createQuote(deps: AppDeps, driverSession: string, input: QuoteRequestInput): Promise<QuoteSet> {
  const nowMs = deps.now();
  const request = toChargeRequest(deps.station, input);
  if (request.departMs <= nowMs) throw new ServiceError("DEPARTURE_PASSED", "Departure time has already passed.");
  // A plug-in in the past would let charging be scheduled in slots that are already over.
  if (request.plugInMs < nowMs) throw new ServiceError("PLUG_IN_PASSED", `Plug-in time has already passed. Choose ${driverDefaultWindow(deps.station, nowMs).plugInLocal} or later.`);
  const scenario = scenarioFor(deps.station, input.nightOf);
  const committed = await committedPlans(deps.db, deps.station.id, input.nightOf);
  const quoteSetId = deps.newId("qs");
  const priced = generateQuote({
    ctx: allocationContext(deps.station, scenario, committed),
    economics: deps.economics,
    request,
    quoteSetId,
    merchantRef: deps.merchantRef,
    nowMs,
    ttlMs: deps.quoteTtlMs,
    forecastLabel: FORECAST_LABEL,
  });
  const quote: QuoteSet = { ...priced, requiredMinSavingsCents: input.requiredMinSavingsCents ?? null };
  await deps.db.query(
    "insert into quote_sets (id, driver_session, station_id, night_of, created_at, expires_at, payload) values ($1, $2, $3, $4, $5, $6, $7)",
    [quoteSetId, driverSession, deps.station.id, input.nightOf, new Date(nowMs).toISOString(), new Date(quote.expiresAtMs).toISOString(), JSON.stringify(quote)],
  );
  return quote;
}

export async function getQuoteSet(deps: AppDeps, driverSession: string, quoteSetId: string): Promise<{ quote: QuoteSet; nightOf: string }> {
  const rows = await deps.db.query<{ payload: QuoteSet; driver_session: string; night_of: string }>(
    "select payload, driver_session, night_of from quote_sets where id = $1",
    [quoteSetId],
  );
  const row = rows[0];
  // Same response for missing and foreign quotes: no existence oracle.
  if (!row || row.driver_session !== driverSession) throw new ServiceError("QUOTE_NOT_FOUND", "Quote not found.", 404);
  return { quote: row.payload, nightOf: row.night_of };
}
