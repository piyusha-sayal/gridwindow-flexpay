# Final automated certification (MOCK payments, MOCK/fallback Gemini, synthetic data)

**Tested source:** branch `feature/combined-release-V1`, based on certified main `27d7ad486e0f6ac69f946990bddd23d6dbb56482` plus the fixes in "Defects found and fixed" below (the exact SHA is the commit that contains this file). Nothing external was contacted: no PayPal order, no Gemini call, no Neon connection, no deployment.

**Environment:** Windows 11, Next.js 16 production build served by `next start` on port 3107, `PAYMENT_MODE=mock`, PGlite for the app, and a disposable local PostgreSQL 18 cluster (ports 55432/55433, deleted afterwards) for the PostgreSQL tests. Playwright 1.63 Chromium, one worker, one spec file per invocation.

## Results
| Area | Evidence | Status |
|---|---|---|
| `npm ci`, `tsc --noEmit`, `eslint .` | executed, 0 errors, 0 warnings | PASS |
| Vitest | 802 passed, 12 skipped, 0 failed (77 files + 1 skipped file). The 12 skips are the PostgreSQL-gated tests when `TEST_DATABASE_URL` is unset (see `docs/SKIPPED_TESTS.md`) | PASS |
| Real PostgreSQL | `postgres.test.ts`, `authorizationRace.test.ts`, `integrityGaps.test.ts`, `reconciliationSweep.test.ts`: 47 passed, run serially, including the server-restart test and concurrent migrators and settlement workers | PASS |
| Migration CLI on disposable DBs | status, plan, apply 001-005, repeat apply (no-op), wrong fingerprint refused, two databases on one server get different fingerprints; drift, unknown-id and checksum cases in `migrator.test.ts` and `migrateCli.test.ts` | PASS |
| Playwright | 21 spec files, 0 failed, 6 skipped (all in `qa.spec.ts`: desktop-only keyboard journeys on the mobile/tablet projects) | PASS |
| Production builds (default and `.next-release`) | both exit 0 | PASS |
| `release:scan`, `npm audit --omit=dev` | PASS, 0 vulnerabilities | PASS |
| Recovery benchmark x2 | 200 seeds, 5820 scenarios; byte-identical and unchanged from the committed file | PASS |
| Secret / identity scan | no private emails or key shapes in the diff (test fixtures use fake URLs) | PASS |

## Browser sweep (`tests/e2e/certification.spec.ts`, evidence in `docs/evidence/certification/`)
For `/`, `/drive`, `/how-it-works`, `/impact-lab`, `/rewards`, `/operator` and `/operator/schedule` at 1440x900, 768x1024 and 390x844 (21 page/viewport combinations) the test asserts: no console errors, no uncaught exceptions, no failed network requests (navigation-aborted prefetches excluded), no horizontal overflow, no clipped non-ellipsis text, and no serious or critical axe (WCAG 2.2 AA) findings in application markup. **PASS.**

- Bryntum vendor markup on `/operator/schedule` has 1 critical (`aria-required-children`) and 2 serious (`color-contrast`, `scrollable-region-focusable`) axe findings at every viewport. They are reported separately and are not application defects; the station-time table is the accessible alternative. **Open vendor limitation.**
- Driver journey through the real UI with console and network monitoring: wizard, quote, approve, mock authorization, reservation page, synthetic charge, FlexReceipt (SYNTHETIC label, CAPTURED state, amount matches the reservation), then navigation to Rewards, Impact Lab and How it works. **PASS.**
- 23 PNG screenshots were captured. **They were not visually inspected by the agent** (image reads were blocked in this environment). Layout correctness rests on the assertions above and on the existing `screens`, `visual-review` and viewport-matrix specs. Look at them before using them as demo material.

## Recovery scenarios A-H (existing specs, all executed green)
- A, no disruption: `scenarios`, `driver`.
- B, charger slowdown with Bryntum update, persistence and receipt: `scenarioC`, `recoveryScheduler`, `independent-recovery-evidence`.
- C, infeasible recovery and attribution: `scenarios`, `attribution`, `reconciliationSweep`.
- D, driver consent (approve, reject, stale): `recoveryDriver` and the recovery integration tests.
- E, UNKNOWN versus OPERATOR: `attribution`, `settlementPolicy` unit tests.
- F, provider timeout, duplicate webhooks, reconciliation: `payment-states`, `integrityGaps`, `reconciliationSweep`.
- G, concurrent capacity requests: `postgres.test.ts`.
- H, authorization racing a deadline failure: `authorizationRace.test.ts` (15 tests on PGlite and PostgreSQL).

The Gemini path ran with the scripted or fallback model. Deterministic fallback is labelled as such and is not claimed as a model decision.

## Time zones (`independent-bryntum-tz`, `recoveryScheduler`)
Browser zones America/Los_Angeles, UTC and Asia/Kolkata across a normal date and both 2027 DST transitions: the station-time table and caption are identical in every zone; the station-zone axis skips 2 AM in spring and shows `1 AM PDT` / `1 AM PST` in fall; a UTC browser matches the station axis. **Residual:** a half-hour-offset browser (Kolkata) still draws native tick boundaries in its own zone (kept as two expected-failure tests). Record demos in a Pacific-time browser.

## Security (executed)
Operator authorization, driver session isolation, input validation, CSRF/origin checks, webhook replay and verification, capture-after-void prevention, stale-worker fencing, prompt injection, consent enforcement and restart recovery are covered by `security.spec`, `independent-security`, `integrityGaps`, `postgres.test` and the unit suites, all green. Forged `x-forwarded-for`: no bypass (without `TRUST_PROXY` every caller shares one bucket; with it only the proxy-appended hop is used). Side effect, Low: an anonymous party can temporarily lock the operator login for a 60 s window.

## Defects found and fixed in this run
1. **P2, Bryntum schedule requested missing images.** Each load fired three 404s (`/port a (3.6 kw).png` and similar) because the resource column used Bryntum's default image lookup. Fixed with `showImage: false` in `ScheduleChart.tsx`. Regression: the operator sweep asserts no console errors or failed requests.
2. **P1 (safety control), migration target fingerprint ignored the database name and port.** Two databases on one server shared a confirmation code. The fingerprint now hashes host, port and database name (credentials and query options excluded). Regression: `migrateCli.test.ts`; verified on two disposable databases; `docs/MIGRATIONS.md` updated. Operators must re-read the fingerprint with `--status`; any previously noted value is no longer valid.

## Remaining defects
- Critical or High: none known.
- Medium: half-hour browser zone axis ticks (disclosed); Bryntum vendor axe findings (disclosed).
- Low: QA-2 operator-login lockout; QA-4 and QA-5 copy; QA-6 clipped port labels seen in an older screenshot (the current clipped-text assertion passes; visual check pending).
- By design or bounded: drag and resize disabled; FAILED or CANCELLED rows with an order id but no authorization id stay in bounded sweep rotation.

## External certification still required (NEEDS USER APPROVAL)
One bounded real Gemini retry (the earlier attempt returned HTTP 504); up to two PayPal Sandbox transactions with manual buyer approval; Neon migration replay and app startup against Neon (the schema itself was later found at 001-005 by a read-only inspection); deployment, public release and Devpost. Until then a live Gemini decision and recovery-linked Sandbox evidence are BLOCKED / NOT TESTED. Update 2026-11-10: Neon was inspected read-only on 2026-11-10 (applied 001 to 005, nothing pending); see the section "Neon read-only inspection of 2026-11-10" in `docs/EXTERNAL_PREFLIGHT.md`.

## Addendum: final completion run (same branch, later commit)
Re-run on the final source after the fixes below: `npm ci`, `tsc` and `eslint` clean; Vitest **806 passed, 12 skipped, 0 failed** (802 + 4 new copy tests); real PostgreSQL **47 passed** (serial, disposable cluster, then deleted); Playwright **21 spec files, 0 failed, 6 skipped** (`qa.spec.ts`), one worker per spec; default and `.next-release` builds, `release:scan`, `npm audit --omit=dev` (0 vulnerabilities) all PASS; recovery benchmark twice byte-identical and unchanged from the committed file.

Fixed in this run:
- **QA-4 (copy):** after the driver approves a change the receipt no longer says "Recovered automatically" or "Nothing changes until you approve it". The run heading reads "Approved by you and applied" and the narrative says "You approved this change, so it was applied" (stored data unchanged; derived when the receipt is built). Regression: `tests/unit/recoveryCopy.test.ts` and an assertion in `recoveryDriver.spec.ts`.
- **QA-5 (copy):** an early-departure explanation now names the new departure ("Your departure moved to 06:00 ...") instead of the event time. Regression: `recoveryCopy.test.ts`.
- **QA-6:** the Bryntum Port column is 200 px wide (the clipped-text sweep passes). Screenshots still not visually inspected by the agent.
- Bryntum licence: registry metadata and lockfile evidence recorded in `docs/LICENSE_AND_SECRETS_CHECKLIST.md`; the in-package LICENSE file was not read (deny rule, not circumvented).
- Docs: `ARCHITECTURE.md` (late/orphan authorizations, fingerprint), `MIGRATIONS.md`, `README.md` and evidence counts, new `docs/DEPLOYMENT_RUNBOOK.md` (prepared, not executed).

Unchanged by design: the Kolkata-style half-hour browser-zone tick residual (documented, 2 expected-failure tests), the Bryntum vendor axe findings, and QA-2 (an anonymous caller can briefly lock the operator login; forged forwarding headers cannot bypass the limiter).

Checkpoints NOT executed by this run (NEEDS USER APPROVAL): live Gemini call, PayPal Sandbox transactions, any Neon connection or migration, deployment. (Later, owner-approved steps are recorded in `docs/EXTERNAL_PREFLIGHT.md`.)

## Addendum, 2026-11-10: post-UI QA closure

A later certification run on base `2a9985d` plus the QA-closure changes (I1, I2, I3, I9 and accessibility fixes) is recorded in `docs/QA_CLOSURE.md`: Vitest 968 passed, 12 skipped; real PostgreSQL 46 passed, 1 skipped, plus the restart run 12 passed; migration CLI PASS; benchmark byte-identical twice; build, release scan and npm audit PASS; Playwright 126 passed, 0 failed, 6 skipped. The figures above in this file describe the earlier tree and are kept for history.
