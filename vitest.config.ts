import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    // Each integration file opens its own in-memory PGlite and runs migrations in beforeAll; under
    // parallel load that exceeds the 10 s default (observed: "Hook timed out in 10000ms").
    hookTimeout: 60_000,
  },
});
