import { defineConfig, devices } from "@playwright/test";

const PORT = 3107;
const BASE = `http://localhost:${PORT}`;

/** E2E runs the production build in MOCK provider mode with a throwaway database. */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: BASE, trace: "retain-on-failure" },
  projects: [
    { name: "setup", testMatch: /operator\.setup\.ts/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /(driver|dealAgent|screens|qa)\.spec\.ts/, dependencies: ["setup"] },
    { name: "tablet", use: { ...devices["iPad (gen 7)"], browserName: "chromium" }, testMatch: /(screens|qa)\.spec\.ts/, dependencies: ["setup"] },
  ],
  webServer: {
    command: `node node_modules/next/dist/bin/next start -p ${PORT}`,
    url: `${BASE}/api/config`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PAYMENT_MODE: "mock",
      PAYPAL_ENV: "sandbox",
      APP_BASE_URL: BASE,
      SESSION_SECRET: "e2e-session-secret-0123456789abcdef0123456789",
      OPERATOR_PASSPHRASE: "e2e-operator-passphrase",
      GW_DATA_DIR: `.data/e2e-${Date.now()}`,
      // `next start` loads .env.local; blank these so e2e can never touch a hosted database.
      DATABASE_URL: "",
      GW_ISOLATED_DB: "true",
      MIGRATION_DATABASE_URL: "",
      NEXT_TELEMETRY_DISABLED: "1",
      // E2E is deterministic: no model credentials, so the assistant runs its labeled fallback.
      ANTHROPIC_API_KEY: "",
      GEMINI_API_KEY: "",
      AI_PROVIDER: "",
      // The optional failover provider must also stay off, even if .env.local configures it.
      OPENROUTER_API_KEY: "",
      AI_FALLBACK_PROVIDER: "",
      // No live product search in e2e: the Channel3 section hides itself without a key.
      CHANNEL3_API_KEY: "",
      DEMO_TOOLS: "true",
    },
  },
});
