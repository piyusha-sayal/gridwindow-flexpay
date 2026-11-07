/**
 * Landing-page illustration: one vehicle on one 11 kW port, priced with the app's real synthetic
 * tariff and economics rule (driver gets the configured share of the modeled energy saving).
 * Ignores site load and congestion, so it is labeled an illustration, never a quote.
 */
import { listPriceCents, microcentsToCentsCeil, priceFlexibleOffer, SYNTHETIC_ECONOMICS } from "@/domain/economics";
import { SYNTHETIC_TARIFF } from "@/domain/forecast";
import { requiredGridWh, SLOTS_PER_HOUR } from "@/domain/units";

export const HERO_START_HOUR = 18; // slot 0 = 18:00 local
export const HERO_SLOTS = 64; // 18:00 → 10:00
export const HERO_PLUG_IN_SLOT = 4; // 19:00
export const HERO_PORT_W = 11_000;
export const HERO_TARGET_BATTERY_WH = 30_000;
export const HERO_DEFAULT_READY_SLOT = 52; // 07:00
/** Mirrors the server's ASSUMED_EFFICIENCY_BP (a unit test keeps them equal; the server module is not client-safe). */
export const HERO_EFFICIENCY_BP = 9_200;

const NO_SPEND_CAP = Number.MAX_SAFE_INTEGER;

export const heroHour = (slot: number) => (HERO_START_HOUR + Math.floor(slot / SLOTS_PER_HOUR)) % 24;
export const heroTimeLabel = (slot: number) => `${String(heroHour(slot)).padStart(2, "0")}:${String((slot % SLOTS_PER_HOUR) * 15).padStart(2, "0")}`;

/** Tariff for each quarter-hour of the night, millicents per grid kWh. */
export function heroTariffMc(): number[] {
  return Array.from({ length: HERO_SLOTS }, (_, i) => SYNTHETIC_TARIFF.bands.find((b) => heroHour(i) >= b.fromHour && heroHour(i) < b.toHour)!.mcPerKWh);
}

/** Fills slots in the given order at full power until the grid energy is met; the last one is partial. */
function fill(order: readonly number[], gridWh: number): number[] | null {
  const powerW = new Array<number>(HERO_SLOTS).fill(0);
  let remainingWh = gridWh;
  for (const i of order) {
    if (remainingWh <= 0) break;
    const wh = Math.min(remainingWh, HERO_PORT_W / SLOTS_PER_HOUR);
    powerW[i] = wh * SLOTS_PER_HOUR;
    remainingWh -= wh;
  }
  return remainingWh > 0 ? null : powerW;
}

const costCents = (powerW: readonly number[], tariff: readonly number[]) => microcentsToCentsCeil(Math.ceil(powerW.reduce((a, w, i) => a + w * tariff[i]!, 0) / SLOTS_PER_HOUR));

export type HeroResult =
  | { kind: "OFFER"; baselineW: number[]; flexW: number[]; listCents: number; priceCents: number; discountCents: number; startSlot: number; endSlot: number }
  | { kind: "NOT_ENOUGH_TIME" | "NO_CHEAPER_WINDOW"; baselineW: number[]; flexW: number[]; listCents: number };

/** Prices the flexible schedule for a ready-by slot (exclusive end) using the real economics rule. */
export function heroSchedule(readySlot: number): HeroResult {
  const tariff = heroTariffMc();
  const gridWh = requiredGridWh(HERO_TARGET_BATTERY_WH, HERO_EFFICIENCY_BP);
  const allSlots = Array.from({ length: HERO_SLOTS - HERO_PLUG_IN_SLOT }, (_, k) => HERO_PLUG_IN_SLOT + k);
  const baselineW = fill(allSlots, gridWh)!;
  const listCents = listPriceCents(SYNTHETIC_ECONOMICS, HERO_TARGET_BATTERY_WH);
  const window = allSlots.filter((i) => i < readySlot);
  const cheapestFirst = [...window].sort((a, b) => tariff[a]! - tariff[b]! || a - b);
  const flexW = fill(cheapestFirst, gridWh);
  if (!flexW) return { kind: "NOT_ENOUGH_TIME", baselineW, flexW: new Array<number>(HERO_SLOTS).fill(0), listCents };
  const pricing = priceFlexibleOffer(SYNTHETIC_ECONOMICS, HERO_TARGET_BATTERY_WH, costCents(baselineW, tariff), costCents(flexW, tariff), NO_SPEND_CAP);
  if (!pricing.ok) return { kind: "NO_CHEAPER_WINDOW", baselineW, flexW, listCents };
  const used = flexW.flatMap((w, i) => (w > 0 ? [i] : []));
  return {
    kind: "OFFER",
    baselineW,
    flexW,
    listCents: pricing.baseline.priceCents,
    priceCents: pricing.flexible.priceCents,
    discountCents: pricing.driverDiscountCents,
    startSlot: used[0]!,
    endSlot: used[used.length - 1]! + 1,
  };
}
