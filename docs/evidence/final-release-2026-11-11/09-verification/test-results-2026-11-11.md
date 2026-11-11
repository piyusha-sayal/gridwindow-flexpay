# Automated test results, 2026-11-11

Machine: Windows 11, Node 24.20.0. Code: commit `11cf209` on `chore/final-release-verification-satyam` (production build `11cf209`). Heavy suites were run one at a time (the machine is memory-constrained).

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | exit 0 |
| ESLint | `npm run lint` | exit 0, 0 problems |
| Vitest | `npm test` | 95 files passed, 1 skipped (96); **1,002 tests passed, 12 skipped (1,014)**; 64 s |
| Production build | `npm run build` | exit 0 (`✓ Compiled successfully`) |
| Release scan | `npm run release:scan` | PASS: `.next/static` 46 files, no secret shapes, sensitive names or configured values; `.env.example` placeholders only |
| Dependency audit | `npm audit --omit=dev` | 0 vulnerabilities |
| Playwright | `npx playwright test --project=<desktop, mobile, tablet>` | see below |
| SDK typecheck | `apimatic/sdk/typescript`: `tsc --noEmit -p tsconfig.json` with its own TypeScript 7.0.2 | exit 0 |
| SDK contract | `scripts/sdk-contract.mts` | 13 of 13 operations PASS |
| APIMatic validator | `apimatic api validate -i apimatic` | Succeeded (warnings only) |
| Recovery benchmark | `npx tsx scripts/recovery-benchmark.ts` | 200 seeds, 5,820 scenarios; deterministic (regenerated `docs/RECOVERY_BENCHMARK.md`) |

**Skipped Vitest tests (12):** `tests/integration/postgres.test.ts`, the real-PostgreSQL suite. It runs only with `TEST_DATABASE_URL` pointing at a disposable local PostgreSQL (refused for hosted hosts by `tests/integration/dbGuard.ts`). Not run this round; last PASS on a disposable PostgreSQL 18.1 cluster (2026-11-07, 2026-11-09).

**Tests changed in this closure:** added `tests/integration/bookingAfterDisturbance.test.ts`, `tests/integration/recoveryAfterDisturbance.test.ts`, three `violationsIntroducedBy` unit tests, and for the AI failover chain one integration test, two unit tests and two configuration tests (one replaces the old "OpenRouter replaces the second Gemini model" test). Removed: the three `aiSourceText` tests, with the label they covered. Re-pinned: the synthetic benchmark figures in `independent-benchmark-breakdown.test.ts` (old values kept in a comment). Eight browser specs now check the API's `source` field instead of the removed label. Mutation checks: each new regression test fails on the original code.

## Playwright

Run 2026-11-11 16:35-16:47 UTC, build `11cf209` (`UwTffMwWzXAmMCrRcM0fg`), one device profile at a time, isolated server (MOCK provider, throwaway PGlite, no model or Channel3 key, `GW_ISOLATED_DB=true`).

| Profile | Result | Time |
|---|---|---|
| desktop (Chrome) | 111 passed, 0 failed | 9.8 min |
| mobile (Pixel 7) | 14 passed, 3 skipped, 0 failed | 1.9 min |
| tablet (iPad gen 7, Chromium) | 3 passed, 3 skipped, 0 failed | 41 s |

Collected: 132 tests in 24 files (the operator sign-in setup counts once; it runs once per profile). Totals: **126 passed, 6 skipped, 0 failed.**

- **Expected failures (2, desktop):** `independent-bryntum-tz.spec.ts` "QA-3 (known residual)" for 2027-03-13 and 2027-11-06 in an Asia/Kolkata browser. They are marked `test.fail`: Bryntum places ticks on browser-local hours in a half-hour-offset zone. Documented limitation.
- **Skipped (6):** `qa.spec.ts` keyboard-only journeys (driver journey, invalid-input focus, operator journey) on mobile and tablet. By design, they run on desktop only.
- An earlier run on `81d1d63` failed 13 desktop tests that still asserted the removed "Deterministic fallback" label. The specs were updated to assert the API's `source` field instead (no assertion was dropped), and this run is clean.

## After the release: hotfix and deployed commit

The production smoke test on the release (`6265654`) found that every live Gemini call was rejected (HTTP 400; fix 5 in `docs/FINAL_RELEASE_VERIFICATION_2026-11-11.md`). Hotfix PR #10 (`ed68391`, merged as `7959a1b`) added two tests (`tests/unit/geminiLlm.test.ts`: the real SDK sends `X-Server-Timeout: 20` for an 8 s adapter timeout, mutation-checked; the deadline floor).

| Gate on `7959a1b` | Result |
|---|---|
| TypeScript, ESLint | exit 0, exit 0 |
| Vitest | 95 files passed, 1 skipped (96); **1,004 passed, 12 skipped (1,016)** |
| Production build, release scan | exit 0; PASS |
| GitHub Actions CI | run 43064443321 (PR #9, `a03382d`) success; 43065723689 (`main` `6265654`) success; 43067727398 (PR #10, `ed68391`) success; 43068227922 (`main` `7959a1b`) success |
| Production smoke test (live) | 21 of 21 (`smoke-live-results-2026-11-11.json`) |
| SDK contract | 17 of 17 calls, 13 operations, 6 live (`sdk-contract-2026-11-11.txt`) |

Playwright was not re-run after `11cf209`: the later changes are the OpenAPI spec with the regenerated portal and SDK (not part of the app), documentation, and the Gemini client deadline, which applies only with a model key; e2e runs without one.
