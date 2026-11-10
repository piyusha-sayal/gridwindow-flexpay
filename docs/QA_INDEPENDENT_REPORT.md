# Independent QA Report (Satyam V2 workstream)

- Date: 2026-11-09
- Branch: `feature/combined-release-V2`, from baseline `f1ac53c` (verified identical to `feature/combined-release`)
- Environment: Windows 11, Node v24.20.0, npm 11.19.0, Playwright 1.63.0 (Chromium), embedded PGlite
- Isolation: every command ran with `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` blanked, `PAYMENT_MODE=mock`, `GW_ISOLATED_DB=true`. No external service, PayPal order, Gemini call or hosted database was contacted.
- Status vocabulary: PASS / FAIL / BLOCKED / NOT TESTED / NEEDS USER APPROVAL. All energy and money figures are SYNTHETIC.

## 1. Independent baseline (commands actually run)

| Gate | Result | Evidence |
|---|---|---|
| `npm ci` | PASS (466 packages, 28 s) | clean install from lockfile |
| `npx tsc --noEmit` | PASS | exit 0 |
| `npx eslint .` | PASS | exit 0 |
| `npx vitest run` (baseline) | PASS: 622 passed, 10 skipped (632) | 60 files passed, 1 skipped; 60 s |
| `npx vitest run` (with V2 tests) | PASS: 648 passed, 10 skipped (658) | +26 independent tests |
| `npx playwright test --workers=1` | PASS: 87 passed, 6 skipped, 0 failed | 4.1 min; desktop, mobile, tablet projects |
| `npm run build` | PASS | exit 0 |
| `npm run release:scan` | PASS | `.next/static` and `.env.example` clean |
| `npm audit --omit=dev` | PASS: 0 vulnerabilities | |
| `npm run benchmark:recovery` x2 | PASS: byte-identical output (same SHA-256) | 200 seeds, 5,820 scenarios |
| Real PostgreSQL suite (9 tests) | NOT TESTED | no local PostgreSQL, Docker or `TEST_DATABASE_URL`; `docs/SKIPPED_TESTS.md` lists these as env-gated |
| Live Gemini / PayPal sandbox | NOT TESTED / NEEDS USER APPROVAL | not attempted, per instructions |

The reported historical numbers (622/10, all Playwright specs passing with 6 skipped) were reproduced exactly.
The 6 Playwright skips are the desktop-only keyboard journeys on the mobile and tablet projects (by design).

## 2. New independent tests

| File | Tests | Purpose |
|---|---|---|
| `tests/unit/independent-benchmark.test.ts` | 6 | Recomputes benchmark claims from raw scenario records |
| `tests/integration/independent-security.test.ts` | 20 | Route-guard sweep, operator/driver boundaries, settlement idempotency, webhook intake, migration upgrade |

No production code, existing test or benchmark was modified.

## 3. Security findings

No exploitable defect was found in the areas tested. Confirmed-by-test controls:

- Every state-changing route except the signature-verified PayPal webhook calls `assertSameOrigin`. Every `/operator/*` route except login calls `requireOperator`. (static sweep, PASS)
- Anonymous and driver callers get 401 on operator simulate, mock-capture, reconcile and dashboard, and no provider call is made. (PASS)
- A driver cannot read or simulate another driver's reservation (404), cannot inject an outage (403), and a smuggled `outage` body field is ignored. (PASS)
- Concurrent and repeated settlement produce exactly one provider capture. After an operator-attributable void, capture never reaches the provider. Capture before delivery never reaches the provider. (PASS)
- Unverified webhook: 401, no inbox row, no event, no state change. Oversized body: 413 before verification. Malformed verified body: 400. Verified duplicate: processed once. A hostile "capture completed" webhook cannot produce CAPTURED. (PASS)
- Migrations 003-005 contain no drop/truncate/delete; legacy rows (including terms) survive the upgrade from a persisted 001-002 database; reopening is idempotent; the terms-immutability trigger still rejects a price change. (PASS)

Findings and observations, by severity:

### QA-1: Automatic migration of whatever `DATABASE_URL` points to (Medium; release-blocking under the brief's rule)
- Path: `src/server/runtime.ts:32`, `src/server/db/client.ts` (`openPostgres` calls `migrate` unconditionally).
- Reproduction: set `DATABASE_URL` to any PostgreSQL server and start the app, e.g. `npm run dev`. The first request that calls `getRuntime()` applies all pending migrations.
- Expected: migrations on an external database need an explicit opt-in (for example `RUN_MIGRATIONS=true` or a separate `MIGRATION_DATABASE_URL`-only path).
- Actual: they run automatically. The working copy has a non-empty `DATABASE_URL` in the untracked `.env`, so `npm run dev` here would migrate that database. This QA run avoided it by blanking the variable.
- Recommendation: add an explicit opt-in flag. Not changed here (production code is out of scope).

### QA-2: Rate-limit key is shared when `TRUST_PROXY` is not `true` (Low)
- Path: `src/server/http.ts` `clientKey`.
- Behavior: all callers share one bucket per route. The operator-login limit is 5/min, so any client can lock the operator out of login by sending 5 bad attempts per minute. It fails closed by design; the cost is a denial-of-service lever.
- Recommendation: document that production must set `TRUST_PROXY=true` behind a trusted proxy, or key the login limit on something harder to exhaust.

### Observations (no action required)
- `/api/operator/demo` answers 404, not 401, when demo tools are disabled. This hides the tool and is correct.
- The mock-provider approve route has no operator check, but it returns 404 unless the mock gateway is active.
- Prompt injection, Gemini tool permissions, lease fencing, stale schedule versions and approval expiry are covered by existing tests that pass in the baseline (`recoveryTools`, `commitFencing`, `routes`, `scheduleRecovery`). Not re-implemented here.
- Evidence category for every AI test is MOCK_GEMINI or DETERMINISTIC_FALLBACK. There is no REAL_GEMINI evidence in this run, and deterministic fallback must not be presented as a live model decision.

## 4. Charging and economics (SYNTHETIC)

| Claim | Result |
|---|---|
| Seeds 91, 134, 152 are the only seeds where recovery delivers less than static | PASS |
| Seed 91 shortfall 50 Wh (auto and approval) | PASS |
| Seed 134 shortfall 3 Wh (approval) | PASS |
| Seed 152 shortfall 15 Wh (approval) | PASS |
| 56 auto-applied recoveries raised energy cost | PASS (counted independently: 56) |
| All 56 keep operator margin >= 1 c vs the immediate baseline | PASS |
| No applied change in any column falls below the minimum margin | PASS |
| Benchmark is deterministic (200 seeds, two runs) | PASS |

Unfavorable aggregates, reported as measured (applicable scenarios: 5,789 of 5,820):
- Target energy missed: static 4,677, auto 4,621, approval 3,975. Recovery helps but most severe disturbances still miss the target.
- Auto recovery infeasible in 3,882 scenarios; 1,350 need driver approval; auto never finishes later than agreed (0).
- The cost-raising recoveries are accepted by policy while the margin constraint holds. This is a policy choice, not a defect, but the summary should state it plainly.

## 5. Bryntum, UX, accessibility

Independently executed (Playwright, desktop/mobile/tablet, axe): `recoveryScheduler.spec.ts` renders the Bryntum scheduler, checks the table matches, injects a disturbance and sees it without reload and after reload, runs keyboard and axe checks (no serious/critical violations), and checks mobile and tablet overflow. All PASS in this run.
Package: `@bryntum/scheduler-community` 8.0.0, license field `MIT` (package metadata, not legal advice).
Time-zone mapping: `tests/unit/scheduleTimeZone.test.ts` PASS. A live browser DST-transition check: NOT TESTED.
Screenshots from this run are in `artifacts/screenshots/` (git-ignored). A manual keyboard and screen-reader pass beyond axe: NOT TESTED.

## 6. Agentic Commerce and PayPal + AI

- Deterministic pipeline and tool gating: PASS (existing + baseline run).
- Live Gemini: NEEDS USER APPROVAL (previous attempt returned HTTP 504; not retried).
- PayPal sandbox capture and void certification: NEEDS USER APPROVAL. Procedure, to be run by Satyam only: (1) fresh sandbox buyer, (2) `payment:preflight`, (3) create one order and approve it manually in the PayPal sandbox UI, (4) deliver and capture once, (5) repeat for one void, (6) confirm webhook and reconciliation, (7) record redacted evidence under `artifacts/` (git-ignored).

## 7. Remaining blockers

1. Real-PostgreSQL concurrency tests: BLOCKED (no PostgreSQL available locally).
2. QA-1 needs a decision from the owner before any run with a real `DATABASE_URL`.
3. Live Gemini and PayPal sandbox evidence: NEEDS USER APPROVAL.
4. Demo video and Devpost submission: NEEDS USER APPROVAL (existing drafts: `docs/DEMO_SCRIPT.md`, `docs/DEVPOST.md`).

---

# Update 2 (2026-11-09, final award certification)

Head before this update: `f089afc` (QA-1 fix). Same isolation rules as above (all external-service variables blanked, MOCK provider, throwaway databases).

## Final regression (all executed; logs in `artifacts/qa/final/`, git-ignored)

| Gate | Result | Evidence |
|---|---|---|
| `npm ci` | PASS | clean install |
| `npx tsc --noEmit` | PASS | exit 0 |
| `npx eslint .` | PASS | exit 0 |
| `npx vitest run` | PASS: 668 passed, 10 skipped (678) | 66 files passed, 1 skipped (env-gated real PostgreSQL) |
| `npx playwright test --workers=1` | PASS: 99 passed, 6 skipped, 0 failed | 4.4 min; the 6 skips are desktop-only keyboard journeys on mobile/tablet; 4 of the passes are intentional expected-fail (`test.fail`) tests that document QA-3 |
| `npm run build` | PASS | exit 0 |
| `npm run release:scan` | PASS | `.next/static` and `.env.example` clean |
| `npm audit --omit=dev` | PASS: 0 vulnerabilities | |
| `npm run benchmark:recovery` x2 | PASS: identical SHA-256 | c1e21454...6f3a |
| Real PostgreSQL integration (9 tests) | NOT TESTED | no PostgreSQL available locally; PGlite (embedded PostgreSQL) integration passes |
| Secret scan of the diff | PASS | no key, token or connection-string shapes |
| Licenses (128 production packages from the lockfile) | PASS with review items | MIT 68, Apache-2.0 27, BSD-3-Clause 12, ISC 4, others 17; 14 optional `@img/sharp-*` binaries are LGPL-3.0-or-later (installed by Next image optimization, not copied into the repository; see `docs/THIRD_PARTY.md`); Bryntum MIT text verified, owner to confirm edition |

Tests added in this update (all new files, no existing test changed or weakened): `tests/unit/migrationSafety.test.ts` (12), `tests/integration/independent-ratelimit.test.ts` (4), `tests/integration/independent-agent-evidence.test.ts` (3), `tests/unit/independent-benchmark-breakdown.test.ts` (1), `tests/e2e/independent-bryntum-tz.spec.ts`, `independent-bryntum-a11y.spec.ts`, `independent-recovery-evidence.spec.ts`.

## QA-1: RESOLVED (commit f089afc)
- Red first: `tests/unit/migrationSafety.test.ts` run on the unmodified code failed 11 of 12 tests; the decisive failure was `openPostgres(<hosted url>)` resolving instead of refusing and sending DDL (`create table ... schema_migrations`).
- Fix (`src/server/db/client.ts`, `src/server/runtime.ts`): a non-loopback database is verified read-only at startup and never migrated; pending migrations raise `SchemaNotReadyError` (mapped to a configuration error) naming what is missing and the deliberate command; a migration URL is ignored at startup. Loopback databases keep automatic migration (all existing tests unchanged).
- Deliberate command: `npm run db:migrate -- --confirm-target=<host/db> --expect-latest=<migration id> [--apply]`. Dry run by default; refuses a mismatched target, a mismatched build version, or a database newer than the build; no credentials printed; reads the URL from the process environment only.
- Green: 12 of 12 new tests; full suite 668 passed. The CLI refusals were also exercised against a fake non-resolvable hosted URL (mismatch and missing flags both exit 1 before any connection).
- Not done by design: no connection to the real Neon database, no migration applied anywhere external.
- Operational consequence: an external database must be migrated deliberately before the app will start against it.

## QA-2: REPRODUCED, correction proposed (not applied: outside the authorized scope)
- Test: `tests/integration/independent-ratelimit.test.ts`. Without `TRUST_PROXY`, five wrong guesses from five different addresses make the real operator's correct passphrase return 429 (shared bucket). The lockout lasts one 60 s window. With `TRUST_PROXY=true` an attacker's address no longer blocks another address, but the global 30/min login cap still lets any caller who sends 30 attempts a minute keep the operator out.
- Impact: availability only (operator console login). Brute force stays bounded either way.
- Minimal correction: (1) document and enforce `TRUST_PROXY=true` for any deployed environment; (2) count only failed attempts against the per-client limit so a correct passphrase from an unthrottled client is not refused, and keep the global cap on failures only. Needs separate authorization.

## New findings
| ID | Severity | Finding | Evidence |
|---|---|---|---|
| QA-3 | Medium (demo/UX) | Bryntum time axis follows the browser zone; the table and labels use the station zone. Bars are correct; tick labels disagree for an operator outside Pacific time | `docs/BRYNTUM_EVIDENCE.md`, `evidence/bryntum-axis-by-browser-zone.json`, four `test.fail` tests |
| QA-4 | Low (copy accuracy) | After the driver approves a recovery, the card is titled "Recovered automatically" and still says "Nothing changes until you approve it" | `evidence/14-flexreceipt.png`, `src/components/recoveryCopy.ts` |
| QA-5 | Info | Proposal text says "An earlier departure at 18:00" where 18:00 is the disturbance's effective time, not the new departure (06:00) | `evidence/recovery-trace.json` outcome reason |
| QA-6 | Info | Resource labels clipped in the Bryntum port column ("Port A (3.6 k") | `evidence/05-updated-bryntum-schedule.png` |

No critical or high-severity security or payment defect was found. Confirmed by test: operator and driver boundaries, single capture, no capture after void, webhook forgery/duplicates, lease fencing, hostile model output, stale and expired approvals, migration data preservation.

## Status by area
| Area | Status |
|---|---|
| Recovery correctness (event -> run -> validation -> consent -> commit -> Bryntum -> persistence) | PASS (two browser journeys, structured traces) |
| Bryntum sponsor readiness | PASS with QA-3 and vendor a11y findings disclosed |
| Agentic Commerce readiness | PASS for DETERMINISTIC_FALLBACK and MOCK_GEMINI; REAL_GEMINI NOT TESTED / NEEDS USER APPROVAL |
| PayPal + AI readiness | PASS locally (MOCK provider); Sandbox capture/void NEEDS USER APPROVAL |
| Benchmark and impact | PASS (reproduced and broken down; synthetic only) |
| Real PostgreSQL concurrency | NOT TESTED (no server available) |
| Demo video, Devpost submission | NEEDS USER APPROVAL |

## Documents produced
`docs/BRYNTUM_EVIDENCE.md`, `docs/AGENTIC_COMMERCE_EVIDENCE.md`, `docs/PAYPAL_AI_EVIDENCE.md`, `docs/IMPACT_SUMMARY.md`, `docs/ARCHITECTURE_SUMMARY.md`, `docs/FINAL_DEMO_SCRIPT.md`, `docs/DEMO_RUNBOOK.md` (includes the shot checklist), `docs/DEVPOST_FINAL.md`, and `docs/evidence/` (screenshots and JSON traces).

---

# Update 3 (2026-11-09, evidence finalization; no production code changed)

- **Impact reconciliation** (`tests/unit/independent-benchmark-breakdown.test.ts`, now 6 tests): 56 + 648 + 3,832 + 136 = 4,672 disjoint; the 1,455 charger failures are a subset of the 3,832; the raw infeasible flag (3,882) = 3,832 + 3 pre-existing misses + 47 scenarios that met the target; +2.64 % is over all 5,789 applicable scenarios (+3.49 % over the 4,672 disturbed). New finding: of the 704 repaired scenarios, 592 reach the energy target only by finishing after the agreed ready-by (consent required), 112 do not. `docs/IMPACT_SUMMARY.md`, `docs/DEVPOST_FINAL.md` and `docs/FINAL_DEMO_SCRIPT.md` were corrected to say "reached the energy target after rescheduling", not "restored the schedule".
- **Operator form verified in a real browser** (`tests/e2e/independent-operator-form.spec.ts`, PASS): the demo's injection path (Night of -> Load -> Recovery engine -> Inject SYNTHETIC disturbance) works, shows "Source FALLBACK" and a "DETERMINISTIC (NO AI)" badge, and leads to the driver consent card. Screenshot `docs/evidence/20-operator-form-injection.png`. Earlier evidence runs injected through the API.
- **Bryntum Community typings contain no `timeZone` option**, so the QA-3 correction is a station-zone header renderer, not a prop (`docs/QA_FINDINGS_AND_FIX_SPECS.md`).
- **Local `.env` sets `GEMINI_MODEL=gemini-3.8-flash`**, the model of the HTTP 504 run; the intended retry uses `gemini-3.6-flash` (`docs/LIVE_CERTIFICATION_HANDOFF.md`).
- New documents: `QA_FINDINGS_AND_FIX_SPECS.md`, `DEMO_RECORDING_PACKAGE.md`, `LIVE_CERTIFICATION_HANDOFF.md`, `FINAL_INTEGRATION_CHECKLIST.md`; Devpost placeholders resolved to evidence-free wording with a claims audit and an owner-decision checklist.
- Only the two touched test files were run (both PASS, typecheck and lint clean). The full baseline was deliberately not repeated; it is gate G1 to G4 of `docs/FINAL_INTEGRATION_CHECKLIST.md` on the final commit.

| Item | Status |
|---|---|
| QA-2, QA-3, QA-4, QA-5, QA-6 | NOT FIXED (specified; need authorization) |
| Real PostgreSQL concurrency | BLOCKED |
| Live Gemini, PayPal Sandbox | NEEDS USER APPROVAL |
| Integrated release | NOT TESTED (no integrated commit yet) |
