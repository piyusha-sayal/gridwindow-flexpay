import { z } from "zod";

/**
 * Process configuration. Fails closed: any PAYPAL_ENV other than "sandbox" aborts,
 * and PayPal mode requires explicit sandbox credentials. Secrets are never logged.
 */
const schema = z
  .object({
    PAYMENT_MODE: z.enum(["mock", "paypal_sandbox"]).default("mock"),
    PAYPAL_ENV: z.string().optional(),
    PAYPAL_CLIENT_ID: z.string().optional(),
    PAYPAL_CLIENT_SECRET: z.string().optional(),
    PAYPAL_WEBHOOK_ID: z.string().optional(),
    /** Account ID of the sandbox business account that owns the REST app; every approved order must name it as payee. */
    PAYPAL_EXPECTED_MERCHANT_ID: z.string().optional(),
    APP_BASE_URL: z.string().url().default("http://localhost:3000"),
    SESSION_SECRET: z.string().optional(),
    OPERATOR_PASSPHRASE: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    MIGRATION_DATABASE_URL: z.string().optional(),
    GW_DATA_DIR: z.string().optional(),
    NODE_ENV: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL: z.string().min(1).max(64).optional(),
    AI_PROVIDER: z.enum(["gemini", "anthropic"]).optional(),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().min(1).max(64).optional(),
    /** Set by automated test runners: forbids any hosted database URL (see runtime.openDb). */
    GW_ISOLATED_DB: z.enum(["true"]).optional(),
    DEMO_TOOLS: z.enum(["true", "false"]).optional(),
  })
  .transform((e) => ({ ...e, PAYPAL_ENV: e.PAYPAL_ENV?.trim() || undefined }));

export type AppEnv = z.infer<typeof schema>;

/** PayPal account identifiers are 10-20 upper-case letters and digits. */
export const MERCHANT_ID_FORMAT = /^[A-Z0-9]{10,20}$/;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const env = schema.parse(Object.fromEntries(Object.entries(source).map(([k, v]) => [k, v === "" ? undefined : v])));
  if (env.PAYPAL_ENV !== undefined && env.PAYPAL_ENV !== "sandbox") {
    throw new ConfigError(`PAYPAL_ENV must be "sandbox"; live mode is forbidden in this build (got a non-sandbox value).`);
  }
  if (env.PAYMENT_MODE === "paypal_sandbox") {
    if (env.PAYPAL_ENV !== "sandbox") throw new ConfigError('PAYMENT_MODE=paypal_sandbox requires PAYPAL_ENV="sandbox".');
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new ConfigError("PayPal sandbox credentials are not configured.");
    if (!env.PAYPAL_EXPECTED_MERCHANT_ID || !MERCHANT_ID_FORMAT.test(env.PAYPAL_EXPECTED_MERCHANT_ID)) {
      throw new ConfigError("PAYPAL_EXPECTED_MERCHANT_ID (the sandbox business account ID) is required in PayPal mode.");
    }
  }
  if (env.NODE_ENV === "production" && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)) {
    throw new ConfigError("SESSION_SECRET (>= 32 chars) is required in production.");
  }
  assertIsolatedRun(env);
  return env;
}

/**
 * Automated test runs set GW_ISOLATED_DB=true. Because `next start` also loads .env.local, a run could otherwise
 * inherit the owner's hosted database, model keys or PayPal mode. Refuse to start instead; only names are reported.
 */
export function assertIsolatedRun(env: AppEnv): void {
  if (env.GW_ISOLATED_DB !== "true") return;
  const leaks = [
    env.DATABASE_URL && "DATABASE_URL",
    env.MIGRATION_DATABASE_URL && "MIGRATION_DATABASE_URL",
    env.GEMINI_API_KEY && "GEMINI_API_KEY",
    env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY",
    env.PAYMENT_MODE !== "mock" && "PAYMENT_MODE (must be mock)",
  ].filter(Boolean);
  if (leaks.length > 0) throw new ConfigError(`GW_ISOLATED_DB is set but the environment reaches external services: ${leaks.join(", ")}.`);
}
