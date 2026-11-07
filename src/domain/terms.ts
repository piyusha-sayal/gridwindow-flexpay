import { createHash } from "node:crypto";
import { SLOT_MS } from "./units";

export const TERMS_VERSION = "gw-terms-v1";

/** Immutable, hashable terms the driver approves. Server recomputes and compares before any payment call. */
export interface OfferTerms {
  version: typeof TERMS_VERSION;
  quoteSetId: string;
  offerId: string;
  stationId: string;
  merchantRef: string;
  portId: string;
  currency: "USD";
  amountCents: number;
  listPriceCents: number;
  targetBatteryWh: number;
  efficiencyBp: number;
  plugInMs: number;
  departMs: number;
  gridStartMs: number;
  powerW: number[];
  expiresAtMs: number;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonicalize((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function termsHash(terms: OfferTerms): string {
  return createHash("sha256").update(canonicalJson(terms)).digest("hex");
}

/**
 * Latest moment buyer approval can still be honored: the start of the first scheduled charging slot.
 * Approval after that cannot deliver the accepted schedule, so no authorization may follow.
 */
export function approvalDeadlineMs(terms: Pick<OfferTerms, "gridStartMs" | "powerW" | "plugInMs">): number {
  const first = terms.powerW.findIndex((w) => w > 0);
  return first < 0 ? terms.plugInMs : terms.gridStartMs + first * SLOT_MS;
}
