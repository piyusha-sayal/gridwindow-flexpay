# Award evidence: Bryntum, Agentic Commerce, PayPal + AI

Status labels: **PASS** (verified by a test run in this repository), **FAIL**, **BLOCKED** (needs a credential, a license or a service), **NOT TESTED** (not run in the session that wrote this file), **NEEDS USER APPROVAL** (requires the owner's explicit go-ahead, for example a live paid or money-moving call).

Mock tests are not live validation. A PASS in MOCK mode shows the code path works with a scripted model and an in-process provider. It does not show a real Gemini decision or a real PayPal Sandbox settlement.

Scope of this document: the recovery engine on branch `feature/recovery-engine`, written 2026-11-09. The status column reflects the session in which this file was written. Playwright was excluded from that session because another engineer was using the same port and CPU, so no browser evidence is claimed here.

---

## 1. Best Use of Bryntum

| Item | Detail |
|---|---|
| Claim | The operator schedule at `/operator/schedule` renders persisted schedule versions and pending recovery proposals on a Bryntum Scheduler Community 8.0.0 timeline. The chart is read-only: nothing dragged on it is saved. Proposals are a separate hatched lane. |
| Where in code | `src/app/operator/schedule/ScheduleBoard.tsx`, `scheduleModel.ts`, `chartEvents.ts`, `useScheduleView.ts`, `ScheduleTable.tsx` (accessible table equivalent); server read model `src/server/services/scheduleView.ts`; route `src/app/api/schedule/route.ts`. |
| Packages | `@bryntum/scheduler-community` 8.0.0 and `@bryntum/scheduler-react-community` 8.0.0 (see `docs/LICENSE_AND_SECRETS_CHECKLIST.md`). |
| How to verify | Run the app in MOCK mode, open `/operator/schedule`, record a disturbance on a session, let recovery commit, then reload. The new schedule version should appear on the timeline. |
| Test evidence | No Bryntum-specific unit test exists. Read model and schedule logic are covered by `tests/unit/scheduleModel.test.ts`, `tests/unit/heroSchedule.test.ts` and `tests/integration/scheduleRecovery.test.ts`. E2E: `tests/e2e/recoveryScheduler.spec.ts` (persistence, live update, Pixel 7 and iPad) passed on 2026-11-09 with one worker. Time mapping: `tests/unit/scheduleTimeZone.test.ts` (both DST nights, station-zone labels, table equals chart). |
| Status | Build and browser behavior: **NOT TESTED** in this session. Schedule and read-model unit and integration tests: **PASS** in the full vitest run of 2026-11-09. |
| Known limits | axe reports three serious violations inside Bryntum's own grid DOM (see `docs/BRYNTUM_NOTES.md`). The app's own time mapping is verified in station time (epoch-based, both DST nights). The Bryntum axis time zone is **NOT VERIFIED** (see `docs/BRYNTUM_NOTES.md`). The timeline is a display of persisted state, not an editor. |

## 2. Best Use of Agentic Commerce

| Item | Detail |
|---|---|
| Claim | A model may choose among candidates that the server has already validated. The server owns the schedule and the money. The agent has no payment tools. Changes outside the buyer's agreed terms need the buyer's approval. |
| Where in code | Orchestrator `src/server/services/recoveryOrchestrator.ts` (bounded loop, leases, fencing, deterministic completion). Tool allowlist and phase checks `src/server/services/recoveryTools.ts`. Consent boundary `src/domain/recoveryConsent.ts`. Commit with transaction and version check `commitScheduleVersion` in `src/server/services/scheduleService.ts`. Prompt `recoveryPrompt.ts`; narrative grounding `recoveryNarrative.ts`. Gemini adapter `src/server/ai/geminiLlm.ts`. |
| Safety model | Model input is server-assigned candidate ids only (`c1`, `c2`, ...). Model output is parsed by a schema. Unknown tools, extra arguments, out-of-phase calls and unlisted ids are rejected and written to the trace. A rejected model call falls back to the deterministic path. Every write is checked again by the validators. Price cannot rise. Energy already delivered cannot change. Departure cannot move later. |
| How to verify | `tests/unit/recoveryTools.test.ts` (tool allowlist and rejection codes), `tests/unit/recoveryConsent.test.ts` (consent decision), `tests/integration/recoveryOrchestrator.test.ts` (fencing, takeover, bounded attempts, scripted model). Benchmark: `docs/RECOVERY_BENCHMARK.md`. |
| Test evidence | Unit and integration tests run with a scripted model (MOCK). Full vitest run 2026-11-09: 526 passed, 10 skipped, 0 failed (`plans/PROGRESS.md`). |
| Status | Scripted-model and deterministic tests: **PASS** when the full vitest run passes. Real Gemini recovery decisions: **NEEDS USER APPROVAL** (a live paid model call). Not claimed: that the model chooses well. The deterministic path is the reference; the model only selects among validated options. |
| Known limits | Recovery benchmark uses the deterministic path only (no model). Auto-commit can raise the operator's energy cost against the agreed plan; see the OPEN decision in `docs/ARCHITECTURE.md`. |

## 3. Best Use of PayPal + AI

| Item | Detail |
|---|---|
| Claim | Money follows delivered energy, also when a disturbance changes the plan. Recovery never moves money. A session that can no longer be honored is voided only if no energy was delivered. Partial delivery goes to operator resolution with no capture and no void. The AI has no access to PayPal. |
| Where in code | Outdated-session classification and decision (pure) `src/domain/outdatedSession.ts`. Sweep and settlement routing `src/server/services/outdatedSessionService.ts`. Keyed void and capture `src/server/services/settlementService.ts`. Sandbox and mock gateways `src/payments/`. Scheduled sweep wiring `src/server/runtime.ts`. |
| How to verify | `tests/unit/outdatedSession.test.ts` (classification and action table), `tests/integration/outdatedSettlement.test.ts` (sweep against the database, void and operator flag). Existing payment safety tests in `tests/integration/paymentSafety.test.ts`. |
| Test evidence | MOCK provider only. Included in the full vitest run of 2026-11-09 (526 passed, 10 skipped, 0 failed). |
| Status | MOCK settlement tests: **PASS** when the full run passes. PayPal Sandbox recovery (authorize, then void or capture after a disturbance): **NEEDS USER APPROVAL** (live Sandbox money-moving calls, and the Sandbox credentials are not in this repository). Historical Sandbox proofs (standalone smoke, 2026-10-30, $1.23 capture COMPLETED and $1.23 void VOIDED) are recorded in `docs/EVIDENCE.md` and are not evidence for the recovery path. |
| Settlement policy | New agreements use `OPERATOR_FAILURE_FULL_VOID_V1`: an operator-attributable, unrecoverable failure is a full void with zero charge, including partial physical delivery. Nothing is captured partially. Early departure and non-conclusive outcomes go to operator resolution. Legacy agreements keep the earlier rules. See `docs/ARCHITECTURE.md`. |

## 4. Supporting evidence: synthetic recovery benchmark

| Item | Detail |
|---|---|
| Claim | Under seeded synthetic disturbances, deterministic recovery serves more sessions on time than leaving the agreed plan unchanged. It also has real costs: more sessions need driver approval, some finish later and some cost the operator more energy. |
| Where | `scripts/recoveryBenchmarkRun.ts`, `scripts/recovery-benchmark.ts`, `npm run benchmark:recovery`, output `docs/RECOVERY_BENCHMARK.md`. |
| Status | Determinism and accounting tests (`tests/unit/recoveryBenchmark.test.ts`): **PASS**. Numbers are **SYNTHETIC and modeled**, not measured. |
| Headline (200 seeds, 5,789 applicable scenarios) | Satisfied on time: static 1,112, auto-commit only 1,168, with driver approval 1,814. Auto-commit changed 71 schedules without approval. Approval-required changes: 768, of which 706 met the target. |
| Known problems | Recovery delivered less energy than the static plan in 1 auto-commit scenario and 3 approval scenarios (replay under realized base load; root cause NOT VERIFIED, suspected forecast-versus-realized load gap). The benchmark reports this instead of hiding it. |

---

## What is not claimed

- No claim of real grid benefit, real charger behavior or real vehicles.
- No claim that a live Gemini model makes good recovery decisions.
- No claim of PayPal Sandbox recovery settlement.
- No claim of Bryntum accessibility compliance for the timeline.
- No screenshot of the recovery UI is claimed; the existing screenshots in `docs/screenshots/` predate this branch.
