/**
 * Integer unit helpers. Money is USD cents; power is watts; grid energy is Wh;
 * battery energy is mWh (so efficiency in basis points stays exact).
 */

export const SLOT_MINUTES = 15;
export const SLOT_MS = SLOT_MINUTES * 60 * 1000;
export const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;
/** Power must be a multiple of this so per-slot grid Wh (= W / 4) stays an integer. */
export const POWER_GRANULARITY_W = 4;

export function assertSafeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer, got ${value}`);
  }
}

/** Grid-input energy drawn in one 15-minute slot at a constant power. */
export function slotGridWh(powerW: number): number {
  assertSafeInt(powerW, "powerW");
  if (powerW % POWER_GRANULARITY_W !== 0) {
    throw new RangeError(`powerW must be a multiple of ${POWER_GRANULARITY_W}`);
  }
  return powerW / SLOTS_PER_HOUR;
}

/** Battery energy (mWh) stored from grid Wh at an efficiency in basis points (9200 = 92%). Floors: conservative. */
export function batteryMilliWhFromGridWh(gridWh: number, efficiencyBp: number): number {
  assertSafeInt(gridWh, "gridWh");
  assertSafeInt(efficiencyBp, "efficiencyBp");
  return Math.floor((gridWh * efficiencyBp) / 10);
}

/** Minimum grid Wh needed to put targetBatteryWh into the battery. Ceils: conservative. */
export function requiredGridWh(targetBatteryWh: number, efficiencyBp: number): number {
  assertSafeInt(targetBatteryWh, "targetBatteryWh");
  if (efficiencyBp <= 0 || efficiencyBp > 10_000) throw new RangeError("efficiencyBp out of range");
  return Math.ceil((targetBatteryWh * 10_000) / efficiencyBp);
}

/** Integer cents → PayPal amount string ("12.34"). */
export function centsToUsd(cents: number): string {
  assertSafeInt(cents, "cents");
  if (cents < 0) throw new RangeError("cents must be non-negative");
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

/** Strict parse of a provider USD amount string into integer cents; never uses float math. */
export function usdToCents(value: string): number {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new RangeError(`invalid USD amount: ${JSON.stringify(value)}`);
  const whole = Number(match[1]);
  const frac = Number((match[2] ?? "").padEnd(2, "0"));
  return whole * 100 + frac;
}

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${centsToUsd(Math.abs(cents))}`;
}

export function formatKWh(wh: number, digits = 2): string {
  return `${(wh / 1000).toFixed(digits)} kWh`;
}
