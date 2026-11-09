import type { ChargePreference } from "@/domain/nlRequest";
import type { AiSource } from "@/components/ui";
import type { DealEvaluation } from "@/domain/dealAgent";
import type { PricedOffer } from "@/domain/quotes";

export interface DriverConfig {
  providerMode: "PAYPAL_SANDBOX" | "MOCK";
  station: { name: string; timeZone: string; stationCapW: number; ports: { id: string; label: string; maxPowerW: number; tier?: string }[] };
  ai: { enabled: boolean; model: string | null };
  defaultNightOf: string;
  /** Server-chosen default window that has not started yet (station wall time). */
  defaultPlugInLocal: string;
  defaultDepartLocal: string;
}

export interface FormState {
  portId: string;
  nightOf: string;
  plugInLocal: string;
  departLocal: string;
  targetBatteryKWh: string;
  spendCap: string;
  /** Minimum validated saving the Flex Deal Agent must find, USD; empty = any saving. */
  minSavings: string;
  /** Driver confirmed the minimum saving as a hard requirement: stored with the quote and enforced at accept. */
  minSavingsRequired: boolean;
  preference: ChargePreference;
}

/** Flex Deal Agent response: backend evaluation plus grounded (or deterministic) explanation. */
export type DealResult = { evaluation: DealEvaluation; summary: string; points: string[] } & AiSource;
export type DealState = { status: "idle" | "loading" } | { status: "done"; data: DealResult } | { status: "error"; message: string };

export type FieldErrors = Partial<Record<keyof FormState, string>>;

export const PREFERENCES: { value: ChargePreference; label: string; kind: PricedOffer["kind"] }[] = [
  { value: "lowest_cost", label: "Lowest price", kind: "flex_lowest_cost" },
  { value: "early_finish", label: "Finish early", kind: "flex_early_finish" },
  { value: "gentle", label: "Gentle charging", kind: "flex_gentle" },
];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Client-side checks mirror the server schema for fast feedback; the server re-validates everything. */
export function validateForm(f: FormState): FieldErrors {
  const e: FieldErrors = {};
  const kwh = Number(f.targetBatteryKWh);
  if (!f.targetBatteryKWh.trim() || !Number.isFinite(kwh) || kwh <= 0 || kwh > 120) e.targetBatteryKWh = "Enter between 0.01 and 120 kWh.";
  else if (!/^\d+(\.\d{1,2})?$/.test(f.targetBatteryKWh.trim())) e.targetBatteryKWh = "Use at most two decimals.";
  const cap = f.spendCap.replace(/^\$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cap) || Number(cap) < 1 || Number(cap) > 500) e.spendCap = "Enter a dollar amount between 1.00 and 500.00.";
  const minSave = (f.minSavings ?? "").replace(/^\$/, "").trim();
  if (minSave && (!/^\d{1,3}(\.\d{1,2})?$/.test(minSave) || Number(minSave) <= 0)) e.minSavings = "Enter a dollar amount like 4.00, or leave empty.";
  else if (!minSave && f.minSavingsRequired) e.minSavings = "Enter the saving you require, or untick the requirement.";
  if (!HHMM.test(f.plugInLocal)) e.plugInLocal = "Use HH:MM.";
  if (!HHMM.test(f.departLocal)) e.departLocal = "Use HH:MM.";
  // Same rule as the server: times from 12:00 belong to the evening, earlier times to the next morning.
  const onNight = (hhmm: string) => (toMinutes(hhmm) >= 12 * 60 ? toMinutes(hhmm) : toMinutes(hhmm) + 24 * 60);
  if (!e.plugInLocal && !e.departLocal && onNight(f.departLocal) <= onNight(f.plugInLocal)) e.departLocal = "Departure must be after plug-in.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.nightOf)) e.nightOf = "Choose a date.";
  return e;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");
