/**
 * Impact Lab scenario model shared by the page, the client panel and the compare endpoint.
 * Pure: no server or database imports, so it is safe in client bundles.
 */
import { z } from "zod";
import { DEMO_STATION } from "@/domain/station";

export const PREFERENCES = [
  { id: "lowest_price", label: "Lowest price", hint: "Cheapest offer among all offers shown." },
  { id: "finish_early", label: "Finish early", hint: "The offer that is ready one hour before ready-by." },
  { id: "gentle", label: "Gentle charging", hint: "The offer that charges at half of the port's power." },
] as const;

export type PreferenceId = (typeof PREFERENCES)[number]["id"];

/** Offer kind each preference selects (lowest_price selects across all offers). */
export const PREFERENCE_OFFER_KIND: Record<Exclude<PreferenceId, "lowest_price">, "flex_early_finish" | "flex_gentle"> = {
  finish_early: "flex_early_finish",
  gentle: "flex_gentle",
};

/** Synthetic tariff variants; the evening band is multiplied for this comparison only. */
export const TARIFFS = [
  { id: "standard", label: "Standard synthetic tariff" },
  { id: "evening_x2", label: "Evening peak price doubled (synthetic)" },
] as const;

export type TariffId = (typeof TARIFFS)[number]["id"];

export const DEFAULT_SCENARIO = {
  portId: "port_b",
  kWh: 30,
  plugInLocal: "19:00",
  readyByLocal: "07:00",
  preference: "lowest_price",
  tariff: "standard",
} as const satisfies Omit<ImpactScenarioInput, "nightOf">;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM");

export const impactScenarioSchema = z
  .object({
    portId: z.string().refine((id) => DEMO_STATION.ports.some((p) => p.id === id), "unknown port"),
    nightOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD"),
    plugInLocal: hhmm,
    readyByLocal: hhmm,
    kWh: z
      .number()
      .positive()
      .max(120)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "at most 2 decimals"),
    preference: z.enum(PREFERENCES.map((p) => p.id)),
    tariff: z.enum(TARIFFS.map((t) => t.id)),
  })
  .strict();

export type ImpactScenarioInput = z.infer<typeof impactScenarioSchema>;

export interface PortOption {
  id: string;
  label: string;
  maxPowerW: number;
  tier: string;
}

export type QueryValue = string | string[] | undefined;

/**
 * Builds a valid scenario from URL parameters. Each parameter is checked on its own; a bad or
 * missing value falls back to `defaults` so the page still renders.
 */
export function scenarioFromQuery(query: Record<string, QueryValue>, defaults: ImpactScenarioInput): ImpactScenarioInput {
  const pick = <K extends keyof ImpactScenarioInput>(key: K, parse: (raw: string) => unknown): ImpactScenarioInput[K] => {
    const raw = query[key];
    if (typeof raw !== "string") return defaults[key];
    const parsed = impactScenarioSchema.shape[key].safeParse(parse(raw));
    return parsed.success ? (parsed.data as ImpactScenarioInput[K]) : defaults[key];
  };
  return {
    portId: pick("portId", (v) => v),
    nightOf: pick("nightOf", (v) => v),
    plugInLocal: pick("plugInLocal", (v) => v),
    readyByLocal: pick("readyByLocal", (v) => v),
    kWh: pick("kWh", (v) => (v.trim() === "" ? NaN : Number(v))),
    preference: pick("preference", (v) => v),
    tariff: pick("tariff", (v) => v),
  };
}

/** Plain-English label for a preference id. */
export function preferenceLabel(id: PreferenceId): string {
  return PREFERENCES.find((p) => p.id === id)?.label ?? id;
}
