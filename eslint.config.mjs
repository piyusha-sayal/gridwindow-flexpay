import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next*/**", "node_modules/**", ".data/**", "artifacts/**", "design/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
  { rules: { "no-console": ["error", { allow: ["warn", "error"] }] } },
];

export default config;
