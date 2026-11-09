/**
 * Win-win pricing. All money in integer USD cents. Every input here is a labeled
 * SYNTHETIC ASSUMPTION — not a real tariff, real PayPal fee schedule, or measured cost.
 */

export interface EconomicsConfig {
  label: string;
  /** Immediate-charging list price per battery kWh delivered. */
  listPriceCentsPerBatteryKWh: number;
  /** Assumed payment processing fee (basis points + fixed). Not a PayPal quote. */
  paymentFeeBp: number;
  paymentFeeFixedCents: number;
  /** Assumed per-session operating cost (attendant, wear, software). */
  operatingCostCents: number;
  /** Share of modeled energy-cost savings passed to the driver. */
  driverShareBp: number;
  minDriverDiscountCents: number;
  minOperatorImprovementCents: number;
  /** MODELED: operator cost of remedying one failed session (dispatch, attendant, goodwill). Not measured. */
  failedServiceRemedyCents: number;
}

export const SYNTHETIC_ECONOMICS: EconomicsConfig = {
  label: "Synthetic economics v1 (assumptions, not real fees or tariffs)",
  listPriceCentsPerBatteryKWh: 56,
  paymentFeeBp: 349,
  paymentFeeFixedCents: 49,
  operatingCostCents: 120,
  driverShareBp: 5_000,
  minDriverDiscountCents: 25,
  minOperatorImprovementCents: 1,
  failedServiceRemedyCents: 200,
};

export function microcentsToCentsCeil(microcents: number): number {
  return Math.ceil(microcents / 1_000_000);
}

export function listPriceCents(cfg: EconomicsConfig, targetBatteryWh: number): number {
  return Math.ceil((targetBatteryWh * cfg.listPriceCentsPerBatteryKWh) / 1000);
}

export function paymentFeeCents(cfg: EconomicsConfig, priceCents: number): number {
  return Math.ceil((priceCents * cfg.paymentFeeBp) / 10_000) + cfg.paymentFeeFixedCents;
}

export interface Contribution {
  priceCents: number;
  paymentFeeCents: number;
  energyCostCents: number;
  operatingCostCents: number;
  contributionCents: number;
}

export function contribution(cfg: EconomicsConfig, priceCents: number, energyCostCents: number): Contribution {
  const fee = paymentFeeCents(cfg, priceCents);
  return {
    priceCents,
    paymentFeeCents: fee,
    energyCostCents,
    operatingCostCents: cfg.operatingCostCents,
    contributionCents: priceCents - fee - energyCostCents - cfg.operatingCostCents,
  };
}

export type PricingRejection =
  | "NO_ENERGY_SAVINGS"
  | "DISCOUNT_BELOW_MINIMUM"
  | "OPERATOR_NOT_BETTER_OFF"
  | "EXCEEDS_SPEND_CAP";

export type FlexPricing =
  | {
      ok: true;
      baseline: Contribution;
      flexible: Contribution;
      energySavingsCents: number;
      driverDiscountCents: number;
      operatorImprovementCents: number;
    }
  | { ok: false; reason: PricingRejection; baseline: Contribution; energySavingsCents: number };

/**
 * Price a flexible offer against a feasible immediate baseline delivering the same energy.
 * Holds only if driver discount > 0 (>= minimum) AND operator contribution improves.
 */
export function priceFlexibleOffer(
  cfg: EconomicsConfig,
  targetBatteryWh: number,
  baselineEnergyCostCents: number,
  flexEnergyCostCents: number,
  spendCapCents: number,
): FlexPricing {
  const list = listPriceCents(cfg, targetBatteryWh);
  const baseline = contribution(cfg, list, baselineEnergyCostCents);
  const energySavingsCents = baselineEnergyCostCents - flexEnergyCostCents;
  if (energySavingsCents <= 0) return { ok: false, reason: "NO_ENERGY_SAVINGS", baseline, energySavingsCents };

  const discount = Math.min(Math.floor((energySavingsCents * cfg.driverShareBp) / 10_000), list - 1);
  if (discount < cfg.minDriverDiscountCents || discount <= 0) {
    return { ok: false, reason: "DISCOUNT_BELOW_MINIMUM", baseline, energySavingsCents };
  }
  const flexible = contribution(cfg, list - discount, flexEnergyCostCents);
  const improvement = flexible.contributionCents - baseline.contributionCents;
  if (improvement < cfg.minOperatorImprovementCents) {
    return { ok: false, reason: "OPERATOR_NOT_BETTER_OFF", baseline, energySavingsCents };
  }
  if (flexible.priceCents > spendCapCents) return { ok: false, reason: "EXCEEDS_SPEND_CAP", baseline, energySavingsCents };
  return { ok: true, baseline, flexible, energySavingsCents, driverDiscountCents: discount, operatorImprovementCents: improvement };
}

/** Independent economics validator: recomputes contribution from scratch for an accepted offer. */
export function validateOfferEconomics(
  cfg: EconomicsConfig,
  offer: { priceCents: number; listPriceCents: number; energyCostCents: number; baselineEnergyCostCents: number },
): string[] {
  const errors: string[] = [];
  if (!Number.isSafeInteger(offer.priceCents) || offer.priceCents <= 0) errors.push("price must be positive integer cents");
  if (offer.listPriceCents - offer.priceCents <= 0) errors.push("driver discount must be > 0");
  const feeOf = (p: number) => Math.ceil((p * cfg.paymentFeeBp) / 10_000) + cfg.paymentFeeFixedCents;
  const base = offer.listPriceCents - feeOf(offer.listPriceCents) - offer.baselineEnergyCostCents - cfg.operatingCostCents;
  const flex = offer.priceCents - feeOf(offer.priceCents) - offer.energyCostCents - cfg.operatingCostCents;
  if (flex - base < cfg.minOperatorImprovementCents) errors.push(`operator contribution not improved (${flex} vs ${base})`);
  return errors;
}
