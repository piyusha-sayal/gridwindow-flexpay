# Skipped tests inventory

- Date: 2026-11-09, counts rechecked on the submitted code on 2026-11-11 (Vitest 12 skipped, Playwright 6 skipped)
- Scope: the submitted code on `main`
- Method: static inspection of `tests/`, `vitest.config.ts`, `playwright.config.ts`, plus the final combined-tree runs reported in the last section. No test was un-skipped or modified for this inventory.

## Summary

| Runner | Skipped (static count, no env vars) | Documented figure | Match | Mechanism |
|---|---|---|---|---|
| Vitest | 12 | 12 (docs/JUDGES.md; docs/AWARD_EVIDENCE.md; docs/EVIDENCE.md) | Yes | 11 tests under `describe.skipIf(!TEST_DATABASE_URL)` plus 1 `it.skipIf(!TEST_PG_RESTART_CMD)` nested in it |
| Playwright | 6 | 6 (docs/JUDGES.md; docs/AWARD_EVIDENCE.md) | Yes | `test.beforeEach` calling `test.skip` for non-desktop projects, in `tests/e2e/qa.spec.ts` only |

Notes on the counts:
- All 12 Vitest skips are in one file, `tests/integration/postgres.test.ts`, and are gated on `TEST_DATABASE_URL` or `TEST_PG_RESTART_CMD`. With no env vars set, all 12 are skipped. With `TEST_DATABASE_URL` set and `TEST_PG_RESTART_CMD` unset, 1 is skipped (the restart test).
- The count was 10 before the two migration guard tests were added (tests 3 and 4 in the table below).
- The Playwright 6 are 3 tests in the `keyboard-only journeys` describe, run on the `mobile` and `tablet` projects (both `testMatch` include `qa.spec.ts`), 3 x 2 = 6. The `desktop` project runs them.
- No `.todo`, `.fixme`, `.only`, `xit`, `xdescribe` or unconditional `.skip` exists anywhere in the repository outside `node_modules`.

## What changed from 10 to 12 Vitest skips

Two migration guard tests were added to the gated `describe` in `tests/integration/postgres.test.ts`:

- `an unmigrated external database is refused on open by default and gets no ledger`: checks that an external database whose schema is not migrated is refused with `SchemaNotReadyError` and that no ledger is created.
- `once the migrator has applied the list, the default open succeeds without auto-migrating`: checks that after the migrator runs, the default open succeeds without auto-migrating.

Both are gated like the rest of the describe, so they add to the skip count only when `TEST_DATABASE_URL` is unset.

## Itemized skips

| # | File:line | Test name | Runner | Skip mechanism | Condition | Reason | Env/design classification | Bryntum demo | Agentic Commerce demo | PayPal + AI demo |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | tests/integration/postgres.test.ts:36 | real PostgreSQL > fresh migration, repeated migration and concurrent migrators leave one consistent schema | Vitest | `describe.skipIf` (applies to 11 tests, lines 54, 64, 75, 86, 96, 107, 123, 131, 141, 152, 187) | `!PG_URL` where `PG_URL = process.env.TEST_DATABASE_URL` | Header comment: runs only with TEST_DATABASE_URL on an isolated throwaway server | by design (env-gated) | No: no scheduler path | Yes: checkout and settlement invariants on real PG unverified | No: mock provider only |
| 2 | tests/integration/postgres.test.ts:64 | real PostgreSQL > a dedicated migration URL applies pending migrations and the runtime pool then finds nothing to do | Vitest | same describe | same | same | by design (env-gated) | No | No | No |
| 3 | tests/integration/postgres.test.ts:75 | real PostgreSQL > an unmigrated external database is refused on open by default and gets no ledger | Vitest | same describe | same | same | by design (env-gated) | No | Yes: schema refusal on real PG unverified | No |
| 4 | tests/integration/postgres.test.ts:86 | real PostgreSQL > once the migrator has applied the list, the default open succeeds without auto-migrating | Vitest | same describe | same | same | by design (env-gated) | No | Yes: post-migration open on real PG unverified | No |
| 5 | tests/integration/postgres.test.ts:96 | real PostgreSQL > double-click acceptance across connections creates one reservation, one order operation and one provider order | Vitest | same describe | same | same | by design (env-gated) | No | Yes: concurrent acceptance on real PG unverified | No |
| 6 | tests/integration/postgres.test.ts:107 | real PostgreSQL > simultaneous capacity commitments never overbook a port or the station cap | Vitest | same describe | same | same | by design (env-gated) | No | Yes: capacity race on real PG unverified | No |
| 7 | tests/integration/postgres.test.ts:123 | real PostgreSQL > parallel settlement workers on separate connections produce exactly one capture | Vitest | same describe | same | same | by design (env-gated) | No | Yes: single-capture guarantee on real PG unverified | Yes: capture idempotency on real PG unverified (mock provider) |
| 8 | tests/integration/postgres.test.ts:131 | real PostgreSQL > an expired lease from a crashed worker is taken over by exactly one of many workers | Vitest | same describe | same | same | by design (env-gated) | No | Yes: lease takeover unverified on real PG | No |
| 9 | tests/integration/postgres.test.ts:141 | real PostgreSQL > the app's own transaction connection dropped while idle rejects that transaction without crashing or poisoning the pool | Vitest | same describe | same | same | by design (env-gated) | No | Yes: connection-drop handling unverified | No |
| 10 | tests/integration/postgres.test.ts:152 | real PostgreSQL > a backend killed mid-transaction leaves no partial writes, and accepted terms stay immutable | Vitest | same describe | same | same | by design (env-gated) | No | Yes: atomicity and terms immutability on real PG unverified | No |
| 11 | tests/integration/postgres.test.ts:187 | real PostgreSQL > financial invariants hold across everything above | Vitest | same describe | same | same | by design (env-gated) | No | Yes: global invariants on real PG unverified | Yes: capture/void exclusivity on real PG unverified |
| 12 | tests/integration/postgres.test.ts:170 | real PostgreSQL > server restart: the pool reconnects and recovery finishes an interrupted settlement exactly once | Vitest | `it.skipIf` (nested inside the describe in #1 to #11) | `!process.env.TEST_PG_RESTART_CMD` | Header comment: restart drops all connections, set the command only when running this file alone | by design (env-gated) | Yes: recovery after restart unverified (recovery engine) | Yes: interrupted settlement recovery unverified | Yes: interrupted capture recovery unverified (mock provider) |
| 13 | tests/e2e/qa.spec.ts:54 | keyboard-only journeys > driver: request, offers, explanation, terms, mock checkout, reservation, FlexReceipt | Playwright | `test.beforeEach` calls `test.skip` (line 52) | `info.project.name !== "desktop"`; skips on `mobile` and `tablet` | Stated: "keyboard journeys run on desktop" | by design (other): project-scoped, viewport coverage | No | Yes: mobile/tablet checkout keyboard path not run | No: mock checkout only |
| 14 | tests/e2e/qa.spec.ts:121 | keyboard-only journeys > driver: invalid input moves focus to the first invalid field with an announced error | Playwright | same beforeEach | same | same | by design (other) | No | Yes: mobile/tablet validation focus not run | No |
| 15 | tests/e2e/qa.spec.ts:138 | keyboard-only journeys > operator > operator: sign-in, demo seed, timeline, details, permitted action, reset confirmation | Playwright | same beforeEach (nested describe) | same | same | by design (other) | Partial: operator timeline keyboard path on mobile/tablet not run; no scheduler-specific check | No | No |

Line numbers for the Playwright rows are from the earlier inventory and were not re-checked against this tree.

Playwright skip counts by project: `mobile` 3 skipped, `tablet` 3 skipped, `desktop` 0 skipped.

Note on Playwright #13 to #15 and the `mobile` and `tablet` projects: `playwright.config.ts` restricts these projects with `testMatch`, so `qa.spec.ts` runs on both. The desktop project has no `testMatch` and runs every spec.

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
- `TEST_DATABASE_URL`: gates the `describe` (tests #1 to #11). When set, `assertDisposableTestUrl` (from `tests/integration/dbGuard.ts`) is run on it first.
- `TEST_PG_RESTART_CMD`: gates test #12 only. It runs a shell command that restarts the server.

Run on the combined tree, on a disposable local PostgreSQL 18.1 server, in a separate verification run: 11 passed, 1 skipped (the restart test, because `TEST_PG_RESTART_CMD` was not set). Those are the real-PostgreSQL results. Which server instance was used is not recorded here; the local Windows service below was not verified as the one used.

Local environment, checked without connecting to any database:
- `psql`: found at `C:\Program Files\PostgreSQL\18\bin\psql.exe`
- `pg_ctl`: found at `C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe`
- `postgres`: found at `C:\Program Files\PostgreSQL\18\bin\postgres.exe`
- `docker`: found at `C:\Program Files\Docker\Docker\resources\bin\docker.exe` (presence only; no daemon status checked, no containers started)
- Windows service `postgresql-x64-18`: status Running (from `Get-Service`)

Observations:
- A PostgreSQL 18 server is running locally as a Windows service. Its database, role and data directory were not inspected, so whether it is an isolated throwaway server is not verified. The real-PG suite must not be pointed at it unless it is confirmed disposable.

## Not verified

- Whether Vitest reports each child of a skipped `describe` as a separate skipped test. The 12 figure assumes it does, which matches the combined-tree run reported above.
- Whether the running local PostgreSQL service is isolated or disposable.
- Whether `TEST_DATABASE_URL` or `TEST_PG_RESTART_CMD` is set in any environment. Not checked (no `.env*` reads permitted, and no environment dump).
- Whether any test is skipped indirectly through a helper that calls `test.skip` dynamically. The grep covered all `skip(` and `skipIf(` patterns under `tests/`, and none were found outside the entries above.
- Coverage of `scripts/` smoke tests: `scripts/ai-smoke.ts`, `scripts/paypal-smoke.ts` and `scripts/recovery-live.ts` are not Vitest or Playwright tests, and their live gates were not inspected in depth.
