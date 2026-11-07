/** Process-wide app wiring (one DB + one gateway per server process, HMR-safe). */
import { createHash } from "node:crypto";
import path from "node:path";
import { SYNTHETIC_ECONOMICS } from "@/domain/economics";
import { DEMO_STATION } from "@/domain/station";
import type { PaymentGateway } from "@/payments/gateway";
import { MockGateway } from "@/payments/mockGateway";
import { PayPalSandboxGateway } from "@/payments/paypalSandbox";
import { openPglite, openPostgres, type Db } from "./db/client";
import { randomId, type AppDeps } from "./deps";
import { ConfigError, loadEnv, type AppEnv } from "./env";
import { createLlm } from "./ai/llmFactory";
import type { StructuredLlm } from "./ai/llm";
import { assertReplayWindowWithinRetention } from "./services/orderCreationService";
import { recoverPendingReservations } from "./services/recoveryService";

interface Runtime {
  env: AppEnv;
  deps: AppDeps;
  sessionKey: Buffer;
  operatorPassHash: Buffer | null;
  /** Null when no model credentials are configured; the assistant then uses its labeled deterministic fallback. */
  llm: StructuredLlm | null;
}

const globalKey = Symbol.for("gridwindow.runtime");
type GlobalWithRuntime = typeof globalThis & { [globalKey]?: Promise<Runtime> };

async function openDb(env: AppEnv): Promise<Db> {
  if (env.DATABASE_URL) return openPostgres(env.DATABASE_URL, { migrationUrl: env.MIGRATION_DATABASE_URL });
  return openPglite(env.GW_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite"));
}

function buildGateway(env: AppEnv, db: Db): PaymentGateway {
  if (env.PAYMENT_MODE === "paypal_sandbox") {
    return new PayPalSandboxGateway({
      clientId: env.PAYPAL_CLIENT_ID!,
      clientSecret: env.PAYPAL_CLIENT_SECRET!,
      webhookId: env.PAYPAL_WEBHOOK_ID ?? null,
      brandName: "GridWindow FlexPay (sandbox demo)",
    });
  }
  return new MockGateway(db, env.APP_BASE_URL);
}

async function init(): Promise<Runtime> {
  const env = loadEnv();
  // Fail closed in every environment: a per-process random key would silently log everyone out on restart.
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new ConfigError("SESSION_SECRET (>= 32 chars) is required.");
  const db = await openDb(env);
  const operatorPassHash = env.OPERATOR_PASSPHRASE && env.OPERATOR_PASSPHRASE.length >= 12 ? createHash("sha256").update(env.OPERATOR_PASSPHRASE).digest() : null;
  if (!operatorPassHash) console.warn("[gridwindow] OPERATOR_PASSPHRASE not set (>= 12 chars); operator console disabled.");
  const deps: AppDeps = {
    db,
    gateway: buildGateway(env, db),
    station: DEMO_STATION,
    economics: SYNTHETIC_ECONOMICS,
    now: () => Date.now(),
    newId: randomId,
    baseUrl: env.APP_BASE_URL.replace(/\/$/, ""),
    merchantRef: env.PAYMENT_MODE === "paypal_sandbox" ? "paypal-sandbox-merchant" : "mock-merchant",
    expectedMerchantId: env.PAYMENT_MODE === "paypal_sandbox" ? env.PAYPAL_EXPECTED_MERCHANT_ID : null,
    quoteTtlMs: 10 * 60_000,
  };
  assertReplayWindowWithinRetention(deps.quoteTtlMs);
  // Finish work interrupted by the previous process (crash mid-checkout, lost provider response, pending capture).
  void recoverPendingReservations(deps).catch((err: unknown) => console.warn("[gridwindow] startup recovery sweep failed", err instanceof Error ? err.name : "UNKNOWN"));
  const configured = createLlm(env);
  const llm = configured?.llm ?? null;
  if (!llm) console.warn("[gridwindow] no GEMINI_API_KEY or ANTHROPIC_API_KEY (or AI_PROVIDER mismatch); AI assistant runs in deterministic fallback mode.");
  return { env, deps, llm, sessionKey: createHash("sha256").update(`gw-session:${secret}`).digest(), operatorPassHash };
}

export function getRuntime(): Promise<Runtime> {
  const g = globalThis as GlobalWithRuntime;
  if (!g[globalKey]) {
    g[globalKey] = init().catch((err: unknown) => {
      delete g[globalKey];
      throw err;
    });
  }
  return g[globalKey];
}
