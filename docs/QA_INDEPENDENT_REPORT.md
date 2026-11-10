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
