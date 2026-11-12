# Award evidence: Bryntum, Agentic Commerce, PayPal + AI

Scope: the submitted code on `main`, deployed at https://gridwindow-flexpay.onrender.com. Each claim lists how it was checked.

Status:
- **PASS**: an executed check confirms it.
- **PARTIAL**: part of the claim is confirmed; the row says which part.
- **FAIL**: an executed check found a problem.
- **NOT TESTED**: not run, or only run in a different setup.
- **NOT CLAIMED**: we don't claim it.

Evidence kinds: **MOCK** is the built-in MOCK payment provider, a scripted model or a seeded synthetic run. **Provider** is a real PayPal Sandbox or Gemini call. **Live site** is a read of the deployed app. MOCK results are not live validation.

Test results on the submitted code: TypeScript 0 errors, ESLint 0 problems. Vitest: 1,023 passed and 12 skipped. The 12 are the real-PostgreSQL tests in `tests/integration/postgres.test.ts`; on a disposable local PostgreSQL 18.1 they ran with 11 passed and 1 skipped (the restart test). Playwright: 114 passed on desktop, 14 on mobile and 3 on tablet, 6 skipped (desktop-only keyboard journeys), 0 failed. Production build and `release:scan` pass. `npm audit --omit=dev` finds 0 vulnerabilities. The recovery benchmark gives identical output across runs.

---

## 1. Best Use of Bryntum

Claim: the operator schedule at `/operator/schedule` draws persisted schedule versions and pending recovery proposals on Bryntum Scheduler Community 8.0.0. The chart is read-only. Proposals get their own lane, and the accessible table is built from the same model.

| Claim | Status | Evidence kind | Evidence and pointers |
|---|---|---|---|
| Chart and table read persisted allocations, versions and proposals only | PASS | MOCK | `src/app/operator/schedule/scheduleModel.ts`, `tests/unit/scheduleModel.test.ts`, `tests/unit/scheduleProposal.test.ts`, `tests/integration/scheduleRecovery.test.ts`, `tests/e2e/recoveryScheduler.spec.ts` |
| Proposals are shown as "proposed, not committed" and left out of committed lanes and current kWh | PASS | MOCK | `tests/unit/scheduleProposal.test.ts`; [BRYNTUM_NOTES.md](BRYNTUM_NOTES.md) item 4 |
| Timeline updates after a recovery event without a reload (polling every 3 s) | PASS | MOCK | `tests/e2e/recoveryScheduler.spec.ts` test 1 |
| Any night can be opened: the console link carries the loaded night, the **Night of** picker sits above the timeline, and the night survives refresh and Back/Forward | PASS | MOCK and live site | `tests/e2e/schedule-night-navigation.spec.ts`; live check after the 2026-11-11 deploy (nights 2026-11-12 and 2026-11-14) |
| Switching nights never shows the previous night's sessions while the next one loads | PASS | MOCK and live site | same spec ("a night change never shows the previous night"); fails on the earlier code |
| Original plan / Current (recovered) comparison | PASS for data, PARTIAL for layout | MOCK | The chart shows one plan at a time through a toggle. Side-by-side drawing is not implemented. `tests/unit/scheduleProposal.test.ts` ("before and after") |
| Table equals chart (same model; current kWh equals the sum of burst energy) | PASS | MOCK | `tests/unit/scheduleTimeZone.test.ts` |
| Axis labels show station time (America/Los_Angeles) in UTC, Kolkata and Pacific browsers | PASS | MOCK (browser) | `tests/e2e/recoveryScheduler.spec.ts` "axis labels are station time in every browser zone"; `src/app/operator/schedule/scheduleAxis.ts` |
| Spring-forward and fall-back nights in Pacific, UTC and Kolkata browsers | PASS | MOCK (browser) | `tests/e2e/recoveryScheduler.spec.ts` (spring-forward and fall-back tests); [BRYNTUM_NOTES.md](BRYNTUM_NOTES.md) |
| Tick boundaries follow station hours in every zone | NOT CLAIMED | n/a | Bryntum places ticks on browser-local hours. Labels are station time, so a Kolkata browser shows half-hour ticks. Two tests mark this as an expected failure. |
| Dragging or resizing in the chart | Not offered | n/a | The chart is `readOnly` and there is no endpoint for it. Nothing dragged is saved. |
| Accessibility of the Bryntum timeline | FAIL (vendor markup) | MOCK (axe, `.b-scheduler` scope) | `aria-required-children` (critical, 2 nodes), `color-contrast` (serious, 2), `scrollable-region-focusable` (serious, 1). These come from Bryntum's own markup, and we didn't override its internals. See [BRYNTUM_NOTES.md](BRYNTUM_NOTES.md). |
| Accessible equivalent | PASS | MOCK | The HTML table under the chart (`ScheduleTable`) and the text summary. Keyboard access to the plan toggle is covered by e2e test 2. |
| Bryntum Community license is MIT | PASS | n/a | MIT text in the installed package's `LICENSE` file, plus registry metadata and Bryntum's features page. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). |

---

## 2. Best Use of Agentic Commerce

Claim: a model may choose only among candidates the server has already validated, using server-assigned IDs. The server owns the schedule and the money. The agent has no payment tool and no price input. Changes outside the buyer's agreed terms need the buyer's approval.

| Claim | Status | Evidence kind | Evidence and pointers |
|---|---|---|---|
| Model input is candidate IDs only; unknown tools, extra arguments, out-of-phase calls and unlisted IDs are rejected and traced | PASS | MOCK (scripted model) | `tests/unit/recoveryTools.test.ts`, `tests/unit/recoveryAgentContract.test.ts`, `tests/integration/recoveryAgentBoundary.test.ts` |
| The agent has no payment tool and no price input | PASS | MOCK | `src/server/services/recoveryTools.ts`; `tests/unit/recoveryTools.test.ts` |
| A model failure, timeout or invalid output falls back to the deterministic path | PASS | MOCK and Provider | `tests/integration/recoveryOrchestrator.test.ts` (bounded loop, 8 tool steps, 45 s budget). Seen live too: Gemini HTTP 503 and OpenRouter HTTP 429 both ended in the labeled fallback. |
| Consent boundary: auto-commit only inside pre-approved bounds (price not higher, departure not later, inside the plugged-in window, delivered energy and other sessions unchanged) | PASS | MOCK and live site | `src/domain/recoveryConsent.ts`, `tests/unit/recoveryConsent.test.ts`, `tests/integration/scheduleRecovery.test.ts`; live night 2026-11-12 holds a driver-approved recovery, and 2026-11-14 an automatic one |
| Fencing: stale or duplicate workers cannot commit; attempts are bounded (3) | PASS | MOCK | `tests/integration/recoveryOrchestrator.test.ts` (fencing, takeover, bounded attempts) |
| Schedule version commit is checked again (version, past energy, fence, station-night envelope) | PASS | MOCK | `commitScheduleVersion` in `src/server/services/scheduleService.ts`; `tests/integration/scheduleRecovery.test.ts` |
| Operator economics hold for every automatic commit (at least 1 c against the immediate baseline) | PASS | MOCK (synthetic benchmark) | `evaluateCandidate` in `src/domain/recovery.ts`; `tests/unit/recoveryShortfall.test.ts`; [RECOVERY_BENCHMARK_FINDINGS.md](RECOVERY_BENCHMARK_FINDINGS.md) |
| A live model makes the final recovery decision (MODEL_DECISION) | PARTIAL | Provider | Gemini 3.6 Flash drove the tool steps inside the allowlist in two live runs, and the free OpenRouter backup answered one step. Each time the provider then returned a capacity error, and the final decision was the labeled DETERMINISTIC_FALLBACK. A live model final decision has not been recorded. See [AGENTIC_COMMERCE_EVIDENCE.md](AGENTIC_COMMERCE_EVIDENCE.md). |
| The model chooses well | NOT CLAIMED | n/a | The deterministic path is the reference. The model only selects among validated options. |
| Prompt injection and invalid output in recovery | PASS with a scripted model, NOT TESTED live | MOCK | `tests/unit/recoveryAgentContract.test.ts`, `tests/integration/recoveryAgentBoundary.test.ts` |
| Provenance labels come from the stored run record (MODEL_DECISION, DETERMINISTIC_FALLBACK, SIMULATED_EVENT, MOCK MODEL test fixture) | PASS | MOCK | `src/server/services/recoveryProvenance.ts`, `tests/unit/recoveryProvenance.test.ts` |
| The operator checklist reports only recorded steps: a running run shows no decision, and a driver-approved commit shows DRIVER_APPROVED with its version | PASS | MOCK and live site | `tests/unit/recoveryDemoSteps.test.ts` (22 of its 29 tests fail on the earlier code); live check on night 2026-11-12 |
| An MCP agent can find, compare and prepare a checkout, but only the human can approve the payment | PASS | MOCK and live site | [MCP.md](MCP.md); run records in `docs/evidence/final-release-2026-11-11/09-verification/` (local MOCK booking walk, 11 checks; read-only live calls, 5 checks); no MCP tool moves money or takes a price |
| Recovery benchmark (200 seeds, 5,820 scenarios, 5,789 applicable) is deterministic and reports unfavorable and infeasible cases | PASS (determinism) | Synthetic | `tests/unit/recoveryBenchmark.test.ts`; [RECOVERY_BENCHMARK.md](RECOVERY_BENCHMARK.md). The numbers are modeled, not measured. |
| Assistant (driver Q&A and request parsing) has no tools and cannot set prices | PASS | MOCK and Provider | `tests/unit/assistant.test.ts`, `tests/integration/dealAgent.test.ts`; live Gemini answers in [EVIDENCE.md](EVIDENCE.md#gemini) |

---

## 3. Best Use of PayPal + AI

Claim: money follows delivered energy, also when a disturbance changes the plan. Recovery never moves money. The capture or void decision uses the synthetic delivered-energy ledger, not the forecast. A new agreement is fully voided with zero charge only on a conclusive failure the operator is responsible for. The AI has no access to PayPal.

| Claim | Status | Evidence kind | Evidence and pointers |
|---|---|---|---|
| Live Sandbox capture and void on the deployed build | PASS | Provider | Capture `…H62XfQtp` and void `…C2afKCrn`, USD 15.56 each, read back from the PayPal API with signature-verified webhooks. [FINAL_RELEASE_VERIFICATION_2026-11-11.md](FINAL_RELEASE_VERIFICATION_2026-11-11.md) |
| Sandbox settlement after a recovery run | PASS | Provider and live site | `…n-qKqgUM`: driver-approved recovery, schedule version 2, 30.015 kWh delivered, capture COMPLETED. `…kfgzxjBp`: operator-attributed disturbance, no feasible recovery, void. Both on 2026-11-11 with verified webhooks. Two more on the nights 2026-11-23 (driver-approved recovery, capture of $13.04) and 2026-11-25 (infeasible, attribution UNKNOWN: authorization held, nothing captured or voided). [release report](FINAL_RELEASE_VERIFICATION_2026-11-11.md#k-addendum-the-final-submitted-build-later-on-2026-11-11), [second set](EVIDENCE.md#recovery-demo-evidence-november-23-and-25-2026-reservations) |
| Capture or void decided from the delivered-energy ledger; the forecast is shown as "planned" only | PASS | MOCK | `tests/unit/recoveryConsent.test.ts`, `tests/unit/recoveryShortfall.test.ts`; [ARCHITECTURE.md](ARCHITECTURE.md) |
| The operator checklist marks the financial step Done only after PayPal confirms a capture or void; an authorization shows Waiting; declined, failed and cancelled payments show Stopped | PASS | MOCK and live site | `tests/unit/recoveryDemoSteps.test.ts`, `tests/e2e/scenarioC.spec.ts`; live check read CAPTURED, VOIDED (Done) and AUTHORIZED (Waiting) |
| Shortfall shown in Wh and labeled SYNTHETIC; never captured partially | PASS | MOCK | `tests/unit/recoveryShortfall.test.ts` |
| Settlement policy `OPERATOR_FAILURE_FULL_VOID_V1`: full void with zero charge only for a conclusive operator failure; early departure and inconclusive outcomes go to operator resolution with a deadline | PASS | MOCK and Provider | `src/domain/outdatedSession.ts`, `tests/unit/outdatedSession.test.ts`, `tests/integration/outdatedSettlement.test.ts`, `tests/integration/attributionSettlement.test.ts`; the live void `…kfgzxjBp` above followed this path |
| Fault attribution (OPERATOR, DRIVER, EXTERNAL, UNKNOWN); only a confirmed OPERATOR auto-voids; default UNKNOWN | PASS | MOCK and live site | `src/domain/faultAttribution.ts`, `tests/unit/faultAttribution.test.ts`, `tests/integration/attributionSettlement.test.ts`. Live: `…kfgzxjBp` (OPERATOR, INFEASIBLE) was voided, and `res_cg6ud43I8hjE8VfM` (UNKNOWN, INFEASIBLE) required operator resolution and moved no money ([EVIDENCE.md](EVIDENCE.md#recovery-demo-evidence-november-23-and-25-2026-reservations)) |
| Legacy agreements keep the earlier rules | PASS | MOCK | `tests/integration/outdatedSettlement.test.ts` |
| Remedy cost (200 c default) is recorded as a modeled operator assumption, not a fee | PASS | MOCK | `FAILED_SERVICE_REMEDY_CENTS`; not a PayPal fee and not a customer charge |
| Keyed capture and void; no capture after a void; idempotent side effects | PASS | MOCK | `tests/integration/paymentSafety.test.ts`, `tests/integration/outdatedSettlement.test.ts`; `src/server/services/settlementService.ts` |
| Real PostgreSQL: concurrency, migrations, lease takeover, dropped connection, backend killed mid-transaction | PASS on a disposable local PostgreSQL 18.1 | Local real database | `tests/integration/postgres.test.ts`: 11 passed, 1 skipped (the restart test needs `TEST_PG_RESTART_CMD`) |
| Migration guard: an unmigrated external database is refused; no ledger is created; startup succeeds once migrated | PASS on a disposable local PostgreSQL | Local real database | `tests/integration/postgres.test.ts`; `tests/unit/migrator.test.ts`; [MIGRATIONS.md](MIGRATIONS.md) |
| Production database schema (migrations 001 to 005) | PASS (read-only check, 2026-11-10) | Neon, read-only | 001 to 005 applied, 0 pending, 0 unknown, no writes. Ledger checksums use a legacy format and were not verified. |
| Reconciliation sweep (every 5 minutes, up to 50 reservations per pass, least recently checked first) | PASS | MOCK | `src/server/services/outdatedSessionService.ts`; migration `005_sweep_checked_at`; `tests/integration/outdatedSettlement.test.ts`. There is no button for it. |
| Earlier Sandbox evidence: standalone smoke test (2026-10-30, USD 1.23) and app capture and void (2026-11-06 and 2026-11-07) | PASS (historical) | Provider | [EVIDENCE.md](EVIDENCE.md), [PAYPAL_CERTIFICATION.md](PAYPAL_CERTIFICATION.md) |
| The AI cannot call PayPal or set payment state | PASS | MOCK and Provider | Recovery tool allowlist (`src/server/services/recoveryTools.ts`); the assistant has no tools (`tests/unit/assistant.test.ts`); 0 payment gateway calls in every recorded agent run |

---

## Known limits (all three tracks)

- Charging, building load, tariffs, forecasts and delivery are synthetic. No vehicle is charged, and no real grid benefit or saving is measured.
- Recovery plans on forecast base load, while the replay uses realized base load. Some recovered plans deliver less than the static plan (benchmark: 1 auto-commit scenario and 3 approval scenarios). See [RECOVERY_BENCHMARK_FINDINGS.md](RECOVERY_BENCHMARK_FINDINGS.md).
- An automatic commit may raise the operator's energy cost against the agreed plan, within the 1 c operator constraint.
- An ambiguous authorization that races a deadline failure can leave no authorization ID for the sweep to find.
- Real-PostgreSQL concurrency for the migration and the sweep was checked only on a disposable local cluster.
- The Bryntum timeline's markup is not accessibility-compliant (vendor findings above). The table is the accessible view.

## What we don't claim

- Real grid benefit, real charger behavior or real vehicles.
- That a live model makes good recovery decisions, or that a live model has made the final decision in a recovery run.
- Accessibility compliance for the Bryntum timeline.
- Live production payments. Everything is PayPal Sandbox or MOCK, and the app refuses to start with any `PAYPAL_ENV` other than `sandbox`.
