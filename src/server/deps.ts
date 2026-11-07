import { randomBytes } from "node:crypto";
import type { EconomicsConfig } from "@/domain/economics";
import type { StationConfig } from "@/domain/station";
import type { PaymentGateway } from "@/payments/gateway";
import type { Db } from "./db/client";

/** Everything a service needs, injected so tests can control clock, ids and provider. */
export interface AppDeps {
  db: Db;
  gateway: PaymentGateway;
  station: StationConfig;
  economics: EconomicsConfig;
  now: () => number;
  newId: (prefix: string) => string;
  baseUrl: string;
  merchantRef: string;
  /** PayPal mode only: the payee every approved order must name before it is authorized. */
  expectedMerchantId?: string | null;
  quoteTtlMs: number;
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 400,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
