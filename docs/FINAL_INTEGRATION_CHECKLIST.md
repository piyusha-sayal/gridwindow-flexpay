# Final integration certification checklist

> **Note (2026-11-11):** this is a dated record. Current test counts, benchmark figures and live PayPal evidence are in `docs/FINAL_RELEASE_VERIFICATION_2026-11-11.md`.


Execute on the exact integrated release commit (Satyam's V2 work merged with Piyusha's branch, as it will be submitted). Nothing below is marked PASS in advance. Record the commit SHA first; if a single file changes afterward, every gate that could be affected is re-run.

Release commit under test: `________` (filled in at execution)   Date/time: ________   Tester: ________

Environment rule for every gate: all external-service variables blanked (`DATABASE_URL`, `MIGRATION_DATABASE_URL`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`), `PAYMENT_MODE=mock`, `GW_ISOLATED_DB=true`, except in the explicitly approved live gates (G9, G10).

| # | Gate | Command or action | Pass criterion | Result |
|---|---|---|---|---|
| G1 | Clean installation | fresh clone of the commit, `npm ci` | exit 0, lockfile unchanged (`git status` clean) | NOT TESTED |
| G2 | Types and lint | `npx tsc --noEmit`; `npx eslint .` | both exit 0 | NOT TESTED |
| G3 | Full Vitest | `npx vitest run` | 0 failed; skips only the 10 documented env-gated tests (or 0 if real PostgreSQL is supplied) | NOT TESTED |
| G4 | Full Playwright | `npx playwright install chromium`; `npm run build`; `npx playwright test --workers=1` | 0 failed; skips only the 6 documented desktop-only; the four QA-3 tests are expected failures until QA-3 is fixed, then must pass without `test.fail` | NOT TESTED |
| G5 | Database migration safety | `npx vitest run tests/unit/migrationSafety.test.ts tests/integration/independent-security.test.ts`; confirm `npm run db:migrate` dry run refuses a mismatched `--confirm-target` | all pass; the app does not start against an unmigrated external database | NOT TESTED |
| G6 | Real PostgreSQL concurrency | start a disposable local PostgreSQL; `TEST_DATABASE_URL=postgres://...localhost/... npx vitest run tests/integration/postgres.test.ts` | the 9 real-PostgreSQL tests pass; the guard refuses hosted URLs | BLOCKED (no server available to the QA workstream) |
| G7 | Bryntum rendering and time zone | `npx playwright test tests/e2e/recoveryScheduler.spec.ts tests/e2e/independent-bryntum-tz.spec.ts tests/e2e/independent-bryntum-a11y.spec.ts`; manual look in a Pacific browser and one non-Pacific browser | scheduler mounts; DST nights correct; axis equals table zone once QA-3 is fixed (otherwise the limitation is disclosed); axe clean outside Bryntum | NOT TESTED |
| G8 | Recovery end to end | `npx playwright test tests/e2e/independent-recovery-evidence.spec.ts tests/e2e/independent-operator-form.spec.ts`; compare new screenshots with `docs/evidence/` | event, run, consent, version 2, Bryntum update, reload persistence, FlexReceipt | NOT TESTED |
| G9 | Gemini model execution evidence | `docs/LIVE_CERTIFICATION_HANDOFF.md` Part 1 | every A.7 criterion; `aiUsed` true | NEEDS USER APPROVAL |
| G10 | PayPal capture and void evidence | `docs/LIVE_CERTIFICATION_HANDOFF.md` Part 2 | provider read-backs for one capture and one void; verified webhooks; one operation each | NEEDS USER APPROVAL |
| G11 | Payment reconciliation | `npx vitest run tests/integration/paymentSafety.test.ts tests/integration/reconciliationSweep.test.ts tests/integration/independent-security.test.ts` (and, after G10, `npm run paypal:order -- <ORDER_ID>`) | pass; local state equals provider state | NOT TESTED |
| G12 | Security scan | `npm run release:scan`; secret scan of `git diff <base>..HEAD` and of tracked files; confirm `.env` is untracked | no secret shapes; no tracked `.env`, database or artifact | NOT TESTED |
| G13 | Dependency and license review | `npm audit --omit=dev`; license summary from the lockfile | 0 vulnerabilities; no new license class beyond `docs/THIRD_PARTY.md` (MIT, Apache-2.0, BSD, ISC, optional LGPL `sharp` binaries); Bryntum MIT text present | NOT TESTED |
| G14 | Production build | `npm run build` | exit 0 | NOT TESTED |
| G15 | Benchmark determinism and figures | `npm run benchmark:recovery` twice; `npx vitest run tests/unit/independent-benchmark.test.ts tests/unit/independent-benchmark-breakdown.test.ts` | identical output; the pinned figures (4,672 / 704 / 3,832 / 1,455 / 592 / +2.64 %, seeds 91, 134, 152) unchanged | NOT TESTED |
| G16 | Reproducible demo | follow `docs/DEMO_RECORDING_PACKAGE.md` sections A to D on a fresh database | every "Expected actual result" row observed | NOT TESTED |
| G17 | QA findings status | re-check `docs/QA_FINDINGS_AND_FIX_SPECS.md`; for each fixed item, its retest passes | each ID marked Fixed with commit, or Disclosed | NOT TESTED |
| G18 | Submission requirements | owner-decision checklist in `docs/DEVPOST_FINAL.md` | all nine items decided; no unsupported claim; video approved | NEEDS USER APPROVAL |

## Acceptance rule
- Release is **PASS** only if G1 to G5, G7, G8, G11 to G17 pass on the tested commit. G6 may remain BLOCKED only if the limitation is stated in the submission. G9 and G10 are required only for claims that depend on them; without them those claims must stay in their evidence-free form.
- Any FAIL, or any change after the run, voids the affected gates.
- The result is recorded against the SHA above, never against a branch name.
