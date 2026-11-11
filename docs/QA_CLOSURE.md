# Post-UI release QA and defect closure

> **Note (2026-11-11):** this is a dated record. Current test counts, benchmark figures and live PayPal evidence are in `docs/FINAL_RELEASE_VERIFICATION_2026-11-11.md`.


- Date: 2026-11-10
- Base: `2a9985d` (approved UI release on `origin/main`)
- Scope: presentation, configuration and read-model fixes only. No payment, settlement, recovery orchestration or scheduling algorithm was changed. No external provider (PayPal, Gemini, OpenRouter, Neon) was called.
- Provenance of every result below: Windows, Node, Next.js production build in MOCK provider mode with an in-process or disposable local database.

## Defect status

| ID | Finding (original audit) | Status | Evidence |
|---|---|---|---|
| I1 | Playwright could not start when `.env.local` held an OpenRouter key | CLOSED | `playwright.config.ts` blanks `OPENROUTER_API_KEY` and `AI_FALLBACK_PROVIDER`. Blank and whitespace-only values are treated as absent in `loadEnv` and in `llmFactory`. `tests/unit/isolatedRun.test.ts` covers absent, empty, whitespace-only and valid keys and asserts the config. The final Playwright run was started without any shell blanking. |
| I2 | Schedule counted voided, failed and cancelled sessions as live load | CLOSED | One rule, `holdsCapacity` (`src/domain/capacity.ts`), now drives both the operator dashboard and the schedule chart. Released sessions stay in the table, flagged, and are excluded from bursts, occupancy, deadlines and capacity. `tests/unit/scheduleCapacity.test.ts`, `tests/integration/scheduleCapacityView.test.ts` (real void after a failed delivery). |
| I3 | Chart compared EV-only demand with the gross 24 kW cap | CLOSED (semantics established, no invented data) | See "Capacity semantics". |
| I9 | No provider-mode badge per reservation row | CLOSED | Each operator row shows its own provider mode. A row from the other mode is flagged and its actions are disabled, matching the server's 409. `tests/unit/providerIdentity.test.ts`, e2e in `tests/e2e/uiRefinement.spec.ts`. The AI provenance text now surfaces a provider failure in its summary line. |
| A11y-1 | Certification sweep flagged the visually hidden `h2` "Walkthrough" as clipped | CLOSED (false positive) | `.sr-only` text is clipped on purpose. The sweep now skips `.sr-only`, and a test asserts the heading remains in the heading structure. |
| A11y-2 | Impact Lab contrast on tablet | CLOSED (measurement artifact) | axe measured a fade-in mid-frame (`#9a9ea3` on `#f4f6f3`). At rest there are no contrast violations at 1440, 768 and 390. Audits now emulate `prefers-reduced-motion` (which the stylesheet honours by disabling animations) so colors are measured at rest. The contrast rules are unchanged. |
| A11y-3 | Mock checkout `.border-b` contrast | CLOSED (measurement artifact) | Same cause. At rest axe reports no violation on the mock checkout page. |

Not changed and still open (out of scope for this sprint): I4 (state and delivery columns on the Bryntum timeline), I5 (live server must be rebuilt and restarted to run the checkout-expiry sweep), I6, I7, I8, I10 (schedule page `h1` and vendor-DOM axe findings, scoped out with `.b-scheduler`), I11 to I15.

## Capacity semantics (I2 and I3)

Established from the code, not assumed:

- `validatePlans` (`src/domain/validator.ts`) requires `base load + EV demand <= stationCapW - safetyHeadroomW` in every slot. The allocator and recovery use the same expression.
- The demo station sets `stationCapW = 24 000 W` and `safetyHeadroomW = 1 000 W`, so the usable limit is 23 kW. A `SITE_CAP_REDUCTION` lowers the gross cap from its effective slot onward.
- The base load is the scenario's synthetic forecast (`scenario.forecastBaseLoadW`), the same input the validator uses. It is available to the schedule view and is labelled as a forecast. It is not a meter reading.
- The scheduler reads capacity from reservations with `slots_committed = true`. The dashboard additionally counts `CAPTURED`, `CAPTURE_PENDING` and `CAPTURE_DECLINED` sessions because their energy was delivered before the capture attempt. The chart now uses that same rule. A voided, failed, cancelled or never-committed session counts for nothing.

What changed: the chart plots scheduled EV demand stacked on forecast base load against the usable limit (cap minus headroom), counts only capacity-holding sessions, and treats a load exactly at the limit as within it. The server view gained `slotsCommitted` per session plus `safetyHeadroomW` and `forecastBaseLoadW`. No allocation, validation, quote or settlement code changed.

Decision recorded for the owner: `CAPTURE_DECLINED` sessions are still counted as load, as in the existing dashboard rule, because the charge was delivered. If the business rule is that a declined capture should release the slot, change `holdsCapacity` in one place.

Limits that remain: the chart shows the plan and a synthetic base-load forecast. It does not show measured site demand and must not be read as real-world grid data.

## Test evidence

Final certification matrix, run sequentially on 2026-11-10 against the complete working tree: base `2a9985d` plus every change in this document (including the Codex polling follow-up below). That tree is the commit that adds this file. All runs were local: MOCK provider, PGlite or a disposable local PostgreSQL 18 cluster, no `.env.local` credentials in any test process, and no external provider calls. The full Playwright run below supersedes the "NOT TESTED" full-rerun row in the follow-up section.

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | PASS, 0 errors |
| ESLint | `npx eslint . --ignore-pattern ".local-tools/**"` | PASS, 0 errors, 0 warnings (`.local-tools/` holds local-only, untracked scripts) |
| Vitest, full | `npx vitest run` | PASS: 91 files passed, 1 skipped; 968 tests passed, 0 failed, 12 skipped (PostgreSQL-gated, see `SKIPPED_TESTS.md`) |
| Real PostgreSQL 18 | `TEST_DATABASE_URL=<disposable> npx vitest run --no-file-parallelism tests/integration/{postgres,authorizationRace,integrityGaps,reconciliationSweep}.test.ts` | PASS: 4 files, 46 passed, 0 failed, 1 skipped (restart test, needs `TEST_PG_RESTART_CMD`) |
| PostgreSQL restart | same URL plus `TEST_PG_RESTART_CMD=<pg_ctl restart>`, `postgres.test.ts` alone | PASS: 12 passed, 0 failed, 0 skipped (includes the restart test) |
| Migration CLI on a fresh disposable database | `npm run db:migrate -- --status / --plan / --apply` | PASS: status "not ready"; plan lists 001 to 005; wrong fingerprint refused; apply 001 to 005; repeat apply "No pending migrations"; final status "schema ready" |
| Migration unit tests | `npx vitest run tests/unit/migrat* tests/integration/migrat*` | PASS: 3 files, 42 passed |
| Recovery benchmark, twice | `npx tsx scripts/recovery-benchmark.ts` (x2) | PASS: 200 seeds, 5820 scenarios (5789 applicable). `docs/RECOVERY_BENCHMARK.md` byte-identical between runs and identical to the committed file (SHA-256 prefix `9c1a5d386a69ffd1`). Stdout differs only in elapsed time. Satisfied on time: STATIC 1112, auto-commit 1168, with driver approval 1814 of 5789 |
| Production build | `NEXT_DIST_DIR=.next-cert npx next build` | PASS (isolated dist dir; `tsconfig.json` build drift reverted) |
| Release scan | `NEXT_DIST_DIR=.next-cert npx tsx scripts/release-scan.ts` | PASS: 37 client files, no secret shapes, sensitive names or configured values; `.env.example` placeholders only |
| npm audit | `npm audit --omit=dev` | PASS: 0 vulnerabilities |
| Playwright, full (desktop, mobile, tablet) | `NEXT_DIST_DIR=.next-cert npx playwright test` | PASS: 132 tests, 126 passed, 0 failed, 6 skipped (by design: keyboard journeys in `qa.spec.ts` on mobile and tablet), 11.8 minutes. The server booted with no shell blanking of model keys (I1). |
| Accessibility regression | included above: `certification.spec.ts` page sweep (axe WCAG 2.2 AA, clipped text, overflow) at three viewports, `qa.spec.ts` full axe report at three viewports, `recoveryScheduler.spec.ts` axe outside `.b-scheduler`, new heading and focus tests | PASS, 0 findings. Not a WCAG conformance claim: these automated checks do not cover every criterion. |

Additional fixes found during the run and verified by the matrix above:

- Nested scroll container on narrow screens: `.data-table{overflow-x:auto}` at 759px and below made the table a second, unfocusable scroll region inside its focusable wrapper (axe `scrollable-region-focusable` on Impact Lab mobile). The rule now keeps only `display:block`.
- Bottom navigation contrast: the translucent bar measured 4.3:1 for the current-page item at tablet width. Its background is now 97% opaque, not 86%.

Visual review: 42 screenshots (7 pages, light and dark, 1440, 768 and 390 wide) plus 26 sweep screenshots were captured to `artifacts/qa/final-shots/` with `INVENTORY.md` and `contact-sheet.html`. They have NOT been visually inspected by the agent, which cannot open images. Owner review is pending.

Logs for every gate: `artifacts/qa/final-shots/*.txt` (local, not committed).

## Codex follow-up: schedule polling, 2026-11-10

The full Playwright run already active at handoff was observed progressing through desktop, mobile and tablet evidence. It finished normally at 15:36:30 America/Los_Angeles; its `test-results/.last-run.json` reports `passed` and an empty failed-test list. Its stdout summary was not available, so exact pass/skip counts are not inferred. It was neither restarted nor terminated.

The run's result file, traces, screenshots and available QA reports were copied to `artifacts/qa/codex-release/existing-run/` before further browser testing. These local artifacts are not release source files.

### Confirmed I2 follow-up defect and correction

An open schedule discarded polled lifecycle changes because its revision included schedule versions, disruptions and proposals but omitted payment state, service state and `slotsCommitted`. A void could therefore leave stale charging load displayed until reload. The revision now includes those lifecycle fields. Recovery notices use a separate recovery revision, so a payment-only refresh is not presented as a recovery event. This changes presentation/polling only; payment processing, allocation and settlement rules are unchanged.

Regression evidence: `scheduleCapacity.test.ts` checks independent lifecycle transitions and stable unchanged revisions. `uiRefinement.spec.ts` feeds a voided snapshot to an already-open schedule with the same plan version and verifies zero EV demand after polling, without navigation/reload or a recovery notice. The browser regression simulates the read response; it does not certify a new payment operation.

| Check | Actual result |
|---|---|
| Affected schedule unit suites (capacity, model, proposals, time zones) | PASS: 4 files, 45 passed, 0 failed, 0 skipped |
| Production build, including TypeScript | PASS; `tsconfig.json` SHA-256 unchanged |
| ESLint on the four changed source/test files | PASS: 0 errors, 0 warnings |
| Affected Playwright specs (`uiRefinement`, `recoveryScheduler`) | PASS: 22 passed, 0 failed, 0 skipped, including operator setup; one worker, 1.2 minutes |
| Full Playwright rerun after this correction | NOT TESTED: unnecessary for this bounded presentation change after the prior full run passed and affected specs passed |

Build and affected browser checks used a local process-level guard that prevents `.env.local` reads, with MOCK payments, an isolated disposable database and no model credentials. No competing browser/database test jobs were started during this follow-up. Logs: `artifacts/qa/codex-release/schedule-unit.log`, `schedule-build.log`, `affected-playwright.log`. This is scoped regression evidence, not completion of the remaining release certification gates or approval to publish.
