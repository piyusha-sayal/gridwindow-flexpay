/**
 * Actual delivered energy versus the agreed battery minimum. The authoritative input is the synthetic energy ledger
 * (simulation_runs / simulator delivered battery energy), never the forecast plan. Integers only: milliWh against the
 * whole-Wh target from the accepted terms. The terms define no tolerance, so the comparison is exact.
 */

export type SettlementDecision = "CAPTURE" | "VOID";

/** Battery energy still missing from the agreed target, in milliWh (0 when the target is met). */
export function energyShortfallMilliWh(targetBatteryWh: number, deliveredBatteryMilliWh: number): number {
  return Math.max(0, targetBatteryWh * 1000 - deliveredBatteryMilliWh);
}

export function deliveredEnoughFor(targetBatteryWh: number, deliveredBatteryMilliWh: number): boolean {
  return energyShortfallMilliWh(targetBatteryWh, deliveredBatteryMilliWh) === 0;
}

/**
 * The capture decision for a synthetic run: capture only when the ledger delivered the agreed battery energy,
 * otherwise void. A forecast that meets the target never decides this.
 */
export function captureOrVoidFor(targetBatteryWh: number, deliveredBatteryMilliWh: number): SettlementDecision {
  return deliveredEnoughFor(targetBatteryWh, deliveredBatteryMilliWh) ? "CAPTURE" : "VOID";
}
