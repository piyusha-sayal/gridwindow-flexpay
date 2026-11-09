# Skipped tests inventory

- Date: 2026-11-09
- Commit: 5544038 (branch feature/recovery-engine)
- Method: static inspection only. Grep over `tests/`, `vitest.config.ts`, `playwright.config.ts`. No test was run, un-skipped or modified. Counts below are derived from source, not from a runner report.

## Summary

| Runner | Skipped (static count) | Documented figure | Match | Mechanism |
|---|---|---|---|---|
| Vitest | 10 | 10 (README.md:241, docs/AWARD_EVIDENCE.md:31) | Yes | 9 tests under `describe.skipIf(!TEST_DATABASE_URL)` plus 1 `it.skipIf(!TEST_PG_RESTART_CMD)` |
| Playwright | 6 | 6 (README.md:242) | Yes | `test.beforeEach` calling `test.skip` for non-desktop projects, in `tests/e2e/qa.spec.ts` only |
| Conditional (env-gated) | 10 Vitest tests, all env-gated | n/a | n/a | see table |

Notes on the counts:
- The Vitest 10 are all in one file. With no env vars set, the outer describe skips 9 tests and the inner `it.skipIf` adds 1. With `TEST_DATABASE_URL` set and `TEST_PG_RESTART_CMD` unset, the count is 1. The tracker (`plans/SUBMISSION_TRACKER.md`) records both figures ("1 skipped" and "10 skipped").
- The Playwright 6 are 3 tests in the `keyboard-only journeys` describe, run on the `mobile` and `tablet` projects (both `testMatch` include `qa.spec.ts`), 3 x 2 = 6. The `desktop` project runs them.
- No `.todo`, `.fixme`, `.only`, `xit`, `xdescribe` or unconditional `.skip` exists anywhere in the repository outside `node_modules`.

## Itemized skips

| # | File:line | Test name | Runner | Skip mechanism | Condition | Reason | Env/design classification | Bryntum demo | Agentic Commerce demo | PayPal + AI demo |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | tests/integration/postgres.test.ts:35 | real PostgreSQL > fresh migration, repeated migration and concurrent migrators leave one consistent schema | Vitest | `describe.skipIf` (applies to 9 tests, lines 53, 63, 74, 85, 101, 109, 119, 130, 165) | `!PG_URL` where `PG_URL = process.env.TEST_DATABASE_URL` (line 22) | Header comment: runs only with TEST_DATABASE_URL on an isolated throwaway server | by design (env-gated) | No: no scheduler path | Yes: checkout and settlement invariants on real PG unverified | No: mock provider only |
| 2 | tests/integration/postgres.test.ts:35 | real PostgreSQL > a dedicated migration URL applies pending migrations and the runtime pool then finds nothing to do | Vitest | same describe | same | same | by design (env-gated) | No | No | No |
| 3 | tests/integration/postgres.test.ts:35 | real PostgreSQL > double-click acceptance across connections creates one reservation, one order operation and one provider order | Vitest | same describe | same | same | by design (env-gated) | No | Yes: concurrent acceptance on real PG unverified | No |
| 4 | tests/integration/postgres.test.ts:35 | real PostgreSQL > simultaneous capacity commitments never overbook a port or the station cap | Vitest | same describe | same | same | by design (env-gated) | No | Yes: capacity race on real PG unverified | No |
| 5 | tests/integration/postgres.test.ts:35 | real PostgreSQL > parallel settlement workers on separate connections produce exactly one capture | Vitest | same describe | same | same | by design (env-gated) | No | Yes: single-capture guarantee on real PG unverified | Yes: capture idempotency on real PG unverified (mock provider) |
| 6 | tests/integration/postgres.test.ts:35 | real PostgreSQL > an expired lease from a crashed worker is taken over by exactly one of many workers | Vitest | same describe | same | same | by design (env-gated) | No | Yes: lease takeover unverified on real PG | No |
| 7 | tests/integration/postgres.test.ts:35 | real PostgreSQL > the app's own transaction connection dropped while idle rejects that transaction without crashing or poisoning the pool | Vitest | same describe | same | same | by design (env-gated) | No | Yes: connection-drop handling unverified | No |
| 8 | tests/integration/postgres.test.ts:35 | real PostgreSQL > a backend killed mid-transaction leaves no partial writes, and accepted terms stay immutable | Vitest | same describe | same | same | by design (env-gated) | No | Yes: atomicity and terms immutability on real PG unverified | No |
| 9 | tests/integration/postgres.test.ts:35 | real PostgreSQL > financial invariants hold across everything above | Vitest | same describe | same | same | by design (env-gated) | No | Yes: global invariants on real PG unverified | Yes: capture/void exclusivity on real PG unverified |
| 10 | tests/integration/postgres.test.ts:148 | real PostgreSQL > server restart: the pool reconnects and recovery finishes an interrupted settlement exactly once | Vitest | `it.skipIf` (nested inside the describe in #1 to #9) | `!process.env.TEST_PG_RESTART_CMD` | Header comment: restart drops all connections, set the command only when running this file alone | by design (env-gated) | Yes: recovery after restart unverified (recovery engine) | Yes: interrupted settlement recovery unverified | Yes: interrupted capture recovery unverified (mock provider) |
| 11 | tests/e2e/qa.spec.ts:54 | keyboard-only journeys > driver: request, offers, explanation, terms, mock checkout, reservation, FlexReceipt | Playwright | `test.beforeEach` calls `test.skip` (line 52) | `info.project.name !== "desktop"`; skips on `mobile` and `tablet` | Stated: "keyboard journeys run on desktop" | by design (other): project-scoped, viewport coverage | No | Yes: mobile/tablet checkout keyboard path not run | No: mock checkout only |
| 12 | tests/e2e/qa.spec.ts:121 | keyboard-only journeys > driver: invalid input moves focus to the first invalid field with an announced error | Playwright | same beforeEach | same | same | by design (other) | No | Yes: mobile/tablet validation focus not run | No |
| 13 | tests/e2e/qa.spec.ts:138 | keyboard-only journeys > operator > operator: sign-in, demo seed, timeline, details, permitted action, reset confirmation | Playwright | same beforeEach (nested describe) | same | same | by design (other) | Partial: operator timeline keyboard path on mobile/tablet not run; no scheduler-specific check | No | No |

Playwright skip counts by project (from the table above): `mobile` 3 skipped, `tablet` 3 skipped, `desktop` 0 skipped.

Note on Playwright #11 to #13 and the `mobile` and `tablet` projects: `playwright.config.ts` restricts these projects with `testMatch`, so `qa.spec.ts` runs on both. The desktop project has no `testMatch` and runs every spec.

## Inert skip guards (no skip occurs)

These `test.beforeEach(... test.skip(info.project.name !== "desktop" ...))` guards are in files that the `mobile` and `tablet` projects never match (per `playwright.config.ts` testMatch). They therefore run only on desktop and never skip. They have 0 skip count today.

| File:line | Describe scope | Runner | Would skip on | Actual skips |
|---|---|---|---|---|
| tests/e2e/visual-review.spec.ts:12 | whole file | Playwright | mobile, tablet | 0 (not matched) |
| tests/e2e/rehearsal.spec.ts:11 | whole file | Playwright | mobile, tablet | 0 (not matched) |
| tests/e2e/payment-states.spec.ts:13 | whole file | Playwright | mobile, tablet | 0 (not matched) |
| tests/e2e/keyboard-datetime.spec.ts:10 | whole file | Playwright | mobile, tablet | 0 (not matched) |

## Postgres-gated tests and local DB availability

Gate variables (names only):
- `TEST_DATABASE_URL`: gates the `describe` (tests #1 to #9). When set, `assertDisposableTestUrl` (from `tests/integration/dbGuard.ts`) is run on it first.
- `TEST_PG_RESTART_CMD`: gates test #10 only. It runs a shell command that restarts the server.

Not run: the real-PostgreSQL suite was not executed for this inventory. The Vitest command was not run either.

Local environment, checked without connecting to any database:
- `psql`: found at `C:\Program Files\PostgreSQL\18\bin\psql.exe`
- `pg_ctl`: found at `C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe`
- `postgres`: found at `C:\Program Files\PostgreSQL\18\bin\postgres.exe`
- `docker`: found at `C:\Program Files\Docker\Docker\resources\bin\docker.exe` (presence only; no daemon status checked, no containers started)
- Windows service `postgresql-x64-18`: status Running (from `Get-Service`)

Observations:
- A PostgreSQL 18 server is running locally as a Windows service. Its database, role and data directory were not inspected, so whether it is an isolated throwaway server is not verified. The real-PG suite must not be pointed at it unless it is confirmed disposable. The tracker (`plans/SUBMISSION_TRACKER.md`, G12) says an earlier disposable PG 18 cluster was deleted. That cluster is not the same as this running service; this file does not establish which one this is.
- Nothing was started or stopped.

## Not verified

- Actual runner counts. Vitest and Playwright were not executed, per the task rules. The skip totals above are derived from source and match the documented figures, but a run was not used to confirm them.
- Whether Vitest reports each child of a skipped `describe` as a separate skipped test. The 10 figure assumes it does, which matches the README and tracker.
- Whether the running local PostgreSQL service is isolated or disposable.
- Whether `TEST_DATABASE_URL` or `TEST_PG_RESTART_CMD` is set in any environment. Not checked (no `.env*` reads permitted, and no environment dump).
- Whether any test is skipped indirectly through a helper that calls `test.skip` dynamically. The grep covered all `skip(` and `skipIf(` patterns under `tests/`, and none were found outside the entries above.
- Coverage of `scripts/` smoke tests: `scripts/ai-smoke.ts`, `scripts/paypal-smoke.ts` and `scripts/recovery-live.ts` are not Vitest or Playwright tests, and their live gates were not inspected in depth.
