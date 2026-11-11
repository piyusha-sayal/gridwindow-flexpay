# Award evidence: Bryntum, Agentic Commerce, PayPal + AI

Scope: the combined release on branch `feature/combined-release` (recovery engine, operator schedule, consent, fault attribution, provenance, migrations and sweep).

Status labels:
- **PASS**: verified by an executed check on the final combined tree.
- **FAIL**: an executed check found a violation (stated where it applies).
- **BLOCKED**: needs a credential, a license, a service or a fix that is not in place.
- **NOT TESTED**: not run, or run only in a different setup.
- **NEEDS USER APPROVAL**: needs the owner's explicit go-ahead (live model call, money-moving Sandbox call, public webhook, or migration of a persistent database).

Evidence kinds: **MOCK** means the built-in MOCK payment provider, a scripted model, or a seeded synthetic run. **Provider** means a real PayPal Sandbox or Gemini call. MOCK results are not live validation.

Final combined-tree results used below: TypeScript 0 errors; ESLint 0; Vitest 806 passed, 12 skipped (the 12 are the gated real-PostgreSQL tests in `tests/integration/postgres.test.ts`; with `TEST_DATABASE_URL` set on a disposable local PostgreSQL 18.1 they ran and 11 passed, 1 skipped for the restart test); Playwright 16 spec files run one at a time with one worker and isolated data: 0 failed, 6 skipped (keyboard-journey tests on mobile and tablet by design); both production builds pass; `release:scan` PASS; `npm audit --omit=dev` 0 vulnerabilities; the recovery benchmark is deterministic across two runs.

---

## 1. Best Use of Bryntum

Claim: the operator schedule at `/operator/schedule` draws persisted schedule versions and pending recovery proposals on Bryntum Scheduler Community 8.0.0. The chart is read-only. Proposals are a separate lane, and the accessible table is built from the same model.

| Claim | Status | Evidence kind | Evidence and pointers |
|---|---|---|---|
| Chart and table read persisted allocations, versions and proposals only | PASS | MOCK | `src/app/operator/schedule/scheduleModel.ts`, `tests/unit/scheduleModel.test.ts`, `tests/unit/scheduleProposal.test.ts`, `tests/integration/scheduleRecovery.test.ts`; e2e `tests/e2e/recoveryScheduler.spec.ts` (combined run, 0 failed) |
| Proposals are shown as "proposed, not committed" and excluded from committed lanes and current kWh | PASS | MOCK | `tests/unit/scheduleProposal.test.ts`; `docs/BRYNTUM_NOTES.md` item 4 |
| Timeline updates after a recovery event without reload (polling about 3 s) | PASS | MOCK | `tests/e2e/recoveryScheduler.spec.ts` test 1 (combined run, 0 failed) |
| Original plan / Current (recovered) comparison | PASS for data; PARTIAL for layout | MOCK | Chart shows one lane at a time through a toggle. Side-by-side drawing is **not implemented**. `tests/unit/scheduleProposal.test.ts` ("before and after"). |
| Table equals chart (same model; current kWh equals the sum of burst energy) | PASS | MOCK | `tests/unit/scheduleTimeZone.test.ts` |
| Axis labels show station time (America/Los_Angeles) in UTC, Kolkata and Pacific browsers on a winter night | PASS | MOCK (browser) | `tests/e2e/recoveryScheduler.spec.ts` "axis labels are station time in every browser zone"; `src/app/operator/schedule/scheduleAxis.ts` |
| Spring-forward and fall-back nights in a Pacific browser | PASS | MOCK (browser) | `tests/e2e/recoveryScheduler.spec.ts` "spring-forward night" and "fall-back night"; `tests/unit/scheduleAxis.test.ts`, `tests/unit/scheduleTimeZone.test.ts` |
| Fall-back night in UTC and Kolkata browsers | NOT TESTED | n/a | `docs/BRYNTUM_NOTES.md` |
| Tick boundaries follow station hours in every zone | NOT VERIFIED (residual) | n/a | Bryntum places ticks on browser-local hours. Labels are station time, so a Kolkata browser shows half-hour ticks (`6:30 PM`). |
| Manual drag or resize in the chart saves changes | Not offered | n/a | Disabled (`readOnly`); no server endpoint exists. Nothing dragged is saved. |
| Accessibility of the Bryntum timeline | FAIL (vendor DOM) | MOCK (axe, `.b-scheduler` scope, 2026-11-09 scoped scan) | `aria-required-children` (critical, 2 nodes), `color-contrast` (serious, 2), `scrollable-region-focusable` (serious, 1). App code cannot fix these without overriding Bryntum internals, which was not done. See `docs/BRYNTUM_NOTES.md`. |
| Accessible equivalent | PASS | MOCK | The HTML table beside the chart (`ScheduleTable`) and the text summary. Keyboard reachability of the lane toggle is covered by e2e test 2. |
| Bryntum Community license is MIT | PARTIAL | n/a | npm registry metadata and the Bryntum features page say MIT. The in-package LICENSE text is **NOT VERIFIED** (`node_modules` not read). Owner review required before public release. See `THIRD_PARTY_NOTICES.md`. |
| Bryntum time-zone option on the project or component | Not available | n/a | Rejected by the Community 8.0.0 typings. The app uses a header renderer instead (`scheduleAxis.ts`). |

---

## 2. Best Use of Agentic Commerce

Claim: a model may choose only among candidates the server has already validated, using server-assigned ids. The server owns the schedule and the money. The agent has no payment tool and no price input. Changes outside the buyer's agreed terms need the buyer's approval.

| Claim | Status | Evidence kind | Evidence and pointers |
|---|---|---|---|
| Model input is candidate ids only; unknown tools, extra arguments, out-of-phase calls and unlisted ids are rejected and traced | PASS | MOCK (scripted model) | `tests/unit/recoveryTools.test.ts`, `tests/unit/recoveryAgentContract.test.ts`, `tests/integration/recoveryAgentBoundary.test.ts` |
| The agent has no payment tool and no price input | PASS | MOCK | `src/server/services/recoveryTools.ts`; `tests/unit/recoveryTools.test.ts` |
| Model failure, timeout or invalid output falls back to the deterministic path | PASS | MOCK (scripted model) | `tests/integration/recoveryOrchestrator.test.ts`; `src/server/services/recoveryOrchestrator.ts` (bounded loop, 8 tool steps, 45 s budget) |
| Consent boundary: auto-commit only inside pre-approved bounds (price not up, departure not later, inside plugged-in window, delivered energy and other sessions unchanged) | PASS | MOCK | `src/domain/recoveryConsent.ts`, `tests/unit/recoveryConsent.test.ts`, `tests/integration/scheduleRecovery.test.ts` |
| Fencing: stale or duplicate workers cannot commit; attempts are bounded (3) | PASS | MOCK | `tests/integration/recoveryOrchestrator.test.ts` (fencing, takeover, bounded attempts) |
| Schedule version commit is checked again (version, past energy, fence, station-night envelope) | PASS | MOCK | `commitScheduleVersion` in `src/server/services/scheduleService.ts`; `tests/integration/scheduleRecovery.test.ts` |
| Operator economics constraint holds for every automatic commit (at least 1 c against the immediate baseline) | PASS | MOCK (benchmark, synthetic) | `evaluateCandidate` in `src/domain/recovery.ts`; `tests/unit/recoveryShortfall.test.ts`; `docs/RECOVERY_BENCHMARK_FINDINGS.md` |
| **Live Gemini recovery decision (MODEL_DECISION)** | BLOCKED, NEEDS USER APPROVAL | Provider | One live attempt with `gemini-3.8-flash` returned HTTP 504 DEADLINE_EXCEEDED; the deterministic fallback ran. No successful live recovery decision exists. A retry with `gemini-3.6-flash` (the model with earlier successful responses) has **not** been executed and needs separate approval. See `docs/EXTERNAL_PREFLIGHT.md`. |
| The model chooses well | NOT CLAIMED | n/a | The deterministic path is the reference. The model only selects among validated options. |
| Live prompt-injection and invalid-output handling in recovery | NOT TESTED live | MOCK only | Covered with a scripted model in `tests/unit/recoveryAgentContract.test.ts` and `tests/integration/recoveryAgentBoundary.test.ts`. |
| Provenance labels come from the persisted run record (MODEL_DECISION, DETERMINISTIC_FALLBACK, SIMULATED_EVENT, MOCK MODEL test fixture) | PASS | MOCK | `src/server/services/recoveryProvenance.ts`, `tests/unit/recoveryProvenance.test.ts` |
| Recovery benchmark (200 seeds, 5,789 applicable scenarios) is deterministic and reports unfavorable and infeasible cases | PASS (determinism) | Synthetic | `tests/unit/recoveryBenchmark.test.ts`; two runs identical. Numbers are SYNTHETIC and modeled, not measured. See `docs/RECOVERY_BENCHMARK.md`. |
| Assistant (driver Q&A and request parsing) has no tools and cannot set prices | PASS | MOCK (scripted model) | `tests/unit/assistant.test.ts`, `tests/integration/dealAgent.test.ts`. One earlier live Gemini run (2026-11-05, `gemini-3.6-flash`, pre-recovery feature) is summarized in `docs/EVIDENCE.md`. |

---

## 3. Best Use of PayPal + AI

Claim: money follows delivered energy, also when a disturbance changes the plan. Recovery never moves money. The capture or void decision uses the synthetic delivered-energy ledger, not the forecast. A new agreement can be fully voided with zero charge only on a conclusive, operator-attributed failure. The AI has no access to PayPal.

| Claim | Status | Evidence kind | Evidence and pointers |
|---|---|---|---|
| Capture or void decided from the delivered-energy ledger; forecast shown as "planned" only | PASS | MOCK | `tests/unit/recoveryConsent.test.ts`, `tests/unit/recoveryShortfall.test.ts`; `docs/ARCHITECTURE.md` (delivered energy vs forecast) |
| Shortfall shown in Wh and labelled SYNTHETIC; never captured partially | PASS | MOCK | `tests/unit/recoveryShortfall.test.ts`; `docs/ARCHITECTURE.md` trust boundary 4 |
| Settlement policy `OPERATOR_FAILURE_FULL_VOID_V1`: full void with zero charge only for a conclusive operator failure; early departure and non-conclusive outcomes go to operator resolution with a deadline | PASS | MOCK | `src/domain/outdatedSession.ts`, `tests/unit/outdatedSession.test.ts`, `tests/integration/outdatedSettlement.test.ts`, `tests/integration/attributionSettlement.test.ts` |
| Fault attribution (OPERATOR, DRIVER, EXTERNAL, UNKNOWN); only a confirmed OPERATOR auto-voids; default UNKNOWN | PASS | MOCK | `src/domain/faultAttribution.ts`, `tests/unit/faultAttribution.test.ts`, `tests/integration/attributionSettlement.test.ts` |
| Legacy agreements keep the earlier rules | PASS | MOCK | `tests/integration/outdatedSettlement.test.ts`; `docs/ARCHITECTURE.md` |
| Remedy cost (200 c default) is recorded as a MODELED operator assumption, not a fee | PASS (recorded) | MOCK | `FAILED_SERVICE_REMEDY_CENTS` in config; not a PayPal fee and not a customer charge |
| Keyed capture and void; capture after void impossible; idempotent side effects | PASS | MOCK | `tests/integration/paymentSafety.test.ts`, `tests/integration/outdatedSettlement.test.ts`; `src/server/services/settlementService.ts` |
| Real PostgreSQL: concurrency, migrations, lease takeover, dropped connection, backend killed mid-transaction | PASS on a disposable local PostgreSQL 18.1 | Local real database (separate verification run) | `tests/integration/postgres.test.ts`: 11 passed, 1 skipped (restart test needs `TEST_PG_RESTART_CMD`). Not run against Neon. |
| Migration guard: unmigrated external database refused; no ledger created; default open succeeds once migrated | PASS on a disposable local PostgreSQL | Local real database | `tests/integration/postgres.test.ts` (two gated guard tests); `tests/unit/migrator.test.ts`; `docs/MIGRATIONS.md` |
| Neon schema readiness (migrations 001 to 005) | PASS (read-only inspection 2026-11-10) | Neon (read-only) | 001 to 005 applied, 0 pending, 0 unknown, 0 writes. Ledger checksums UNVERIFIED (legacy format). Migration replay and app startup against Neon NOT TESTED. See `docs/EXTERNAL_PREFLIGHT.md`. |
| Reconciliation sweep (every 5 minutes, at most 50 reservations per pass, least recently checked first) | PASS | MOCK | `src/server/services/outdatedSessionService.ts`; migration `005_sweep_checked_at`; `tests/integration/outdatedSettlement.test.ts`. No UI trigger exists. |
| PayPal Sandbox recovery settlement (authorize, then void or capture after a disturbance) | NOT TESTED, NEEDS USER APPROVAL | Provider | Would move Sandbox money. Sandbox credentials are not part of this check. Plan in `docs/PAYPAL_CERTIFICATION.md`. |
| Historical PayPal Sandbox evidence (standalone smoke, 2026-10-30, USD 1.23) | PASS (historical, not repeated) | Provider | `docs/EVIDENCE.md` and `docs/PAYPAL_CERTIFICATION.md` section 1a record both capture and void as PASS. The void half is not re-verified in this check; the owner should confirm it against the stored artifact. These are not evidence for the recovery path. |
| Historical PayPal Sandbox through the app (2026-11-06 capture; 2026-11-07 void, pre-recovery) | PASS (historical) | Provider | `docs/EVIDENCE.md`. Predates the recovery settlement policy. Not evidence for the recovery path. |
| The AI cannot call PayPal or set payment state | PASS | MOCK | Recovery tool allowlist (`src/server/services/recoveryTools.ts`); assistant has no tools (`tests/unit/assistant.test.ts`) |

---

## Known limits (all three tracks)

- Charging, building load, tariffs, forecasts and delivery are synthetic. No vehicle is charged. No real grid benefit or savings is measured.
- Recovery plans on forecast base load; the replay uses realized base load. Some recovered plans deliver less than the static plan (benchmark: 1 auto-commit scenario and 3 approval scenarios). Root cause is a suspected forecast-versus-realized load gap; NOT VERIFIED beyond the analysis in `docs/RECOVERY_BENCHMARK_FINDINGS.md`.
- Auto-commit may raise the operator's energy cost against the agreed plan, within the 1 c operator constraint.
- An ambiguous authorize that races a deadline failure can leave no authorization id for the sweep to find (residual).
- Real-PostgreSQL concurrency for the migration and sweep was checked only on a disposable local cluster.
- The 2027 DST fall-back night was not browser-tested in UTC or Kolkata browsers.
- Bryntum timeline accessibility is not compliant (vendor DOM findings above).

## What is not claimed

- No claim of real grid benefit, real charger behavior or real vehicles.
- No claim that a live Gemini model makes good recovery decisions, or that a live model decision has happened in the recovery flow.
- No claim of PayPal Sandbox recovery settlement.
- No claim of Bryntum accessibility compliance for the timeline.
- No claim of a recorded demo video or a hosted live demo URL. None exists.
- No screenshot of the recovery UI is claimed; the screenshots in `docs/screenshots/` predate this release.

## Update, 2026-11-10

Post-UI QA closure (operator capacity semantics, provider-mode badges, OpenRouter test isolation, accessibility fixes) and its full test matrix: `docs/QA_CLOSURE.md`. The schedule capacity chart now matches the validator's limit (cap minus headroom, with forecast base load) and excludes released sessions.
