import { randomUUID } from "node:crypto";
import { SYNTHETIC_ECONOMICS } from "@/domain/economics";
import { DEMO_STATION } from "@/domain/station";
import { ProviderError, type PaymentGateway, type ProviderAuthorization, type ProviderCapture, type ProviderOrder, type CreateOrderInput } from "@/payments/gateway";
import { MockGateway } from "@/payments/mockGateway";
import { openPglite, openPostgres, type Db } from "@/server/db/client";
import type { AppDeps } from "@/server/deps";
import { assertDisposableTestUrl } from "./dbGuard";
import type { QuoteRequestInput } from "@/server/services/quoteService";

/** Delegates to the mock provider; individual methods can be overridden to inject faults. */
export class ScriptedGateway implements PaymentGateway {
  readonly mode = "MOCK" as const;
  overrides: Partial<PaymentGateway> = {};
  calls: string[] = [];
  webhookValid = false;

  constructor(readonly inner: MockGateway) {}

  private pick<K extends keyof PaymentGateway>(name: K): PaymentGateway[K] {
    this.calls.push(name);
    const fallback = this.inner[name] as unknown as (...args: unknown[]) => unknown;
    return (this.overrides[name] ?? fallback.bind(this.inner)) as PaymentGateway[K];
  }

  createOrder(i: CreateOrderInput): Promise<ProviderOrder> {
    return this.pick("createOrder")(i);
  }
  getOrder(id: string): Promise<ProviderOrder> {
    return this.pick("getOrder")(id);
  }
  authorizeOrder(id: string, key: string): Promise<ProviderAuthorization> {
    return this.pick("authorizeOrder")(id, key);
  }
  getAuthorization(id: string): Promise<ProviderAuthorization> {
    return this.pick("getAuthorization")(id);
  }
  captureAuthorization(id: string, cents: number, inv: string, key: string): Promise<ProviderCapture> {
    return this.pick("captureAuthorization")(id, cents, inv, key);
  }
  getCapture(id: string): Promise<ProviderCapture> {
    return this.pick("getCapture")(id);
  }
  voidAuthorization(id: string, key: string): Promise<void> {
    return this.pick("voidAuthorization")(id, key);
  }
  async verifyWebhook(): Promise<boolean> {
    this.calls.push("verifyWebhook");
    return this.webhookValid;
  }
}

export const timeout = () => new ProviderError("TIMEOUT", "simulated timeout");

export interface TestApp {
  deps: AppDeps;
  db: Db;
  gateway: ScriptedGateway;
  mock: MockGateway;
  clock: { now: number };
}

/**
 * Real PostgreSQL when TEST_DATABASE_URL points at an isolated throwaway server: each test file gets its
 * own schema (tests run in parallel files and truncate). Otherwise embedded PGlite.
 */
export async function openTestDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openPglite();
  assertDisposableTestUrl(url);
  const { Client } = await import("pg");
  const schema = `t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new Client({ connectionString: url });
  await admin.connect();
  await admin.query(`create schema ${schema}`);
  await admin.end();
  const sep = url.includes("?") ? "&" : "?";
  return openPostgres(`${url}${sep}options=${encodeURIComponent(`-c search_path=${schema}`)}`);
}

export const NIGHT = "2026-11-05";
const START_MS = Date.parse("2026-11-05T20:00:00Z"); // 12:00 local

export async function makeApp(): Promise<TestApp> {
  const db = await openTestDb();
  const mock = new MockGateway(db, "http://test.local");
  const gateway = new ScriptedGateway(mock);
  const clock = { now: START_MS };
  let seq = 0;
  const deps: AppDeps = {
    db,
    gateway,
    station: DEMO_STATION,
    economics: SYNTHETIC_ECONOMICS,
    now: () => clock.now,
    newId: (prefix) => `${prefix}_${randomUUID().slice(0, 8)}_${++seq}`,
    baseUrl: "http://test.local",
    merchantRef: "sandbox-merchant-test",
    quoteTtlMs: 10 * 60_000,
  };
  return { deps, db, gateway, mock, clock };
}

/** Clears all rows and restores clock and gateway scripting between tests. */
export async function resetApp(app: TestApp): Promise<void> {
  await app.db.query(
    "truncate events, energy_records, simulation_runs, webhook_inbox, provider_proofs, payment_operations, reservations, quote_sets, mock_provider_objects restart identity cascade",
  );
  app.clock.now = START_MS;
  app.gateway.overrides = {};
  app.gateway.calls = [];
  app.gateway.webhookValid = false;
}

export function request(overrides: Partial<QuoteRequestInput> = {}): QuoteRequestInput {
  return { portId: "port_c", nightOf: NIGHT, plugInLocal: "19:00", departLocal: "07:00", targetBatteryKWh: 30, spendCapCents: 2500, ...overrides };
}
