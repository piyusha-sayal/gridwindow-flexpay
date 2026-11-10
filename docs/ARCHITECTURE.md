# Architecture

GridWindow FlexPay sells overnight EV charging flexibility. The engine decides what is feasible and profitable; PayPal holds and settles the money; the AI only talks.

```
 Driver request ──► /api/quotes ──► allocator ──► validator ──► economics ──► signed terms (hash)
                       │              (kW cap,     (independent   (driver > 0,     │
                       │               port ≠ flow) recompute)     operator ≥ min)  ▼
 AI (optional, no tools)                                              /api/checkout accept
   parse text → form fields                                           server recomputes amount
   explain backend offers                                                    │
   answer own-reservation Q&A                                                ▼
   (grounding filter)                                          PayPal Orders v2: create (idempotent)
                                                                          │ buyer approves on PayPal
                                                                          ▼
                                                              authorize  (AUTHORIZED ≠ captured)
                                                                          │
                                                          synthetic overnight run (simulator)
                                                              ┌───────────┴───────────┐
                                                        delivered                  failed/outage
                                                              ▼                        ▼
                                                   capture once (CAS + unique    void authorization
                                                   settlement index)
                                                              ▼                        ▼
                                              provider read-back = CAPTURED     provider read-back = VOIDED
                                                              └────► FlexReceipt ◄─────┘
```

## Layers

| Layer | Path | Role |
|---|---|---|
| Domain (pure, deterministic) | `src/domain/` | Integer units (cents, W, Wh). `allocator` (24 kW aggregate cap, per-port power, 92 % efficiency), `validator` (independent recompute), `economics`, `quotes`/`terms` (hash, expiry, approval deadline), `simulator`, `paymentState` (CAS transitions), `dealAgent`, `benchmark`. |
| Payments | `src/payments/` | `PaymentGateway` contract; `PayPalSandboxGateway` (sandbox host hard-coded); `MockGateway` (labeled MOCK). |
| Services | `src/server/services/` | quote, checkout, order creation (crash-safe, leased), settlement, reconcile, recovery sweep, webhook, views. |
| AI | `src/server/ai/` | `geminiLlm` (Google Gen AI SDK), `llm` (Anthropic adapter), `assistant` (driver Q&A, no tools), `dealAgent` (server-orchestrated, read-only), `grounding`. |
| Persistence | `src/server/db/` | PostgreSQL via `DATABASE_URL`, else embedded PGlite in `.data/`. Append-only events and energy tables; triggers freeze accepted terms. External databases are never migrated at startup (see Migrations below). |
| UI | `src/app/`, `src/components/` | Next.js App Router: `/drive`, `/reservations/[id]`, `/operator`, `/operator/schedule`, `/impact-lab`, `/how-it-works`. |

## Trust boundaries

1. **Money**: only the backend computes amounts, from the stored offer. The model never supplies a price; the grounding filter rejects numbers it was not given and capture claims unless state is `CAPTURED` with a provider proof.
2. **Consent**: the buyer accepts an unexpired `offer_id` with exact merchant, amount, window; PayPal OAuth is not consent.
3. **Truth**: `CAPTURED`/`VOIDED` are written only after provider read-back (verified webhook or API). Webhooks are verified against the raw body, deduplicated by event id, and retried (503) when the provider is unreachable.
4. **Failure**: uncertain financial outcomes go to `NEEDS_RECONCILIATION`. Settlement policy `OPERATOR_FAILURE_FULL_VOID_V1` (carried in the hashed terms of every new agreement; agreements stored without the field are `LEGACY` and keep the legacy rules):
   > An operator-attributable, unrecoverable failure to deliver the agreed energy by the deadline is eligible for a FULL authorization void and ZERO customer charge. This may include partial physical energy delivery.

   Under this policy, the sweep voids in full only when the recovery engine has conclusively established an operator failure (run `INFEASIBLE`, or `FAILED` on every attempt), no driver-requested early departure is recorded, and the session's fault attribution is `OPERATOR` (confirmed). A driver-requested early departure, a non-conclusive outcome (no run, a rejected or expired proposal, a recovery still within its attempts, or no delivery evidence after departure) goes to `OPERATOR_RESOLUTION_REQUIRED` with a stored resolution deadline (24 h, then `OPERATOR_RESOLUTION_OVERDUE`). Nothing is ever captured automatically from a partial delivery, and nothing is captured because a deadline passed. A pending driver approval that can still resolve blocks any void. Provider-expired authorizations are reconciled against the provider, never reauthorized, and move to `NEEDS_RECONCILIATION` if the provider does not confirm them live. The modeled operator remedy cost (`FAILED_SERVICE_REMEDY_CENTS`, default 200 ¢, MODELED: an operator cost assumption, not a customer fee and not real money) is recorded with each void decision under this policy. Legacy agreements keep the earlier rules: zero delivered is voided, any delivered energy goes to operator resolution, and their voids keep the same remedy record. See "Recovery" below.

   **Delivered energy vs forecast.** A capture decision compares the synthetic ledger's delivered battery energy (`simulation_runs`, from the realized replay) with the agreed `targetBatteryWh` exactly; the terms define no tolerance (`src/domain/deliveredEnergy.ts`). A forecast that meets the target is labelled "planned" in consent, proposals and receipts and is never shown as delivered. Any actual shortfall is shown in Wh on the receipt, reservation status and recovery details, labelled SYNTHETIC.

   **Fault attribution** (`src/domain/faultAttribution.ts`). Each recorded disturbance carries `OPERATOR | DRIVER | EXTERNAL | UNKNOWN`. The operator may supply it on `POST /api/recovery/events` as `attribution`; a value not allowed for the type is refused (`INVALID_ATTRIBUTION`, 400). Without a supplied value the documented default applies:

   | Disturbance | Allowed values | Default |
   |---|---|---|
   | `EARLY_DEPARTURE` | DRIVER, UNKNOWN | DRIVER |
   | `SITE_CAP_REDUCTION` | OPERATOR, EXTERNAL, UNKNOWN | EXTERNAL |
   | `CHARGER_POWER_REDUCTION` | OPERATOR, DRIVER, EXTERNAL, UNKNOWN | UNKNOWN |
   | `CHARGER_FAILURE` | OPERATOR, DRIVER, EXTERNAL, UNKNOWN | UNKNOWN |

   `OPERATOR` is the only confirmed operator cause. A session is `OPERATOR` only when every disturbance on it is; otherwise the most restrictive value applies (DRIVER, then UNKNOWN, then EXTERNAL). Under this policy only `OPERATOR` can auto-void. `DRIVER` routes to operator resolution as an early departure does. `EXTERNAL` and `UNKNOWN` route to operator resolution (`OPERATOR_RESOLUTION_REQUIRED` with its deadline). Neither ever auto-captures or auto-voids, and neither records a remedy. The attribution is stored in the `DISRUPTION_RECORDED` event payload, so no migration was needed. A disturbance with no recorded attribution (including any recorded before this change) reads as `UNKNOWN`.
5. **Environment**: startup refuses anything but `PAYPAL_ENV=sandbox`; demo tools exist only in MOCK mode.

## Payment states

`QUOTE_ACCEPTED → ORDER_CREATED → BUYER_APPROVED → AUTHORIZED → (CAPTURE_PENDING) → CAPTURED | CAPTURE_DECLINED | VOIDED`, plus `CANCELLED`, `FAILED`, `NEEDS_RECONCILIATION`. Transition table: `src/domain/paymentState.ts`.

## Recovery (disturbance re-planning)

A synthetic disturbance (charger power reduction, site cap reduction, early departure, charger failure) is recorded append-only against one reservation. Recovery then re-plans only that session's energy from the disturbance's effective slot onward. Everything before the slot, every other session, the price and the agreed terms are inputs that never change.

```
 Operator records disturbance (POST /api/recovery/events)
   │  validateDisturbance (pure) · insert disruption_events (append-only, idempotent by eventId)
   ▼
 recoveryHook ──► orchestrateRecovery (one recovery_runs row per event, lease-fenced)
   │   claim (insert or lease takeover, max 3 attempts)
   │   snapshotSession: energy delivered before the slot, replayed by the simulator
   │   deterministic candidates: recoverSession over the three offer presets (pure allocator)
   │   optional model loop: Gemini picks tool calls over candidate ids only (max 8 steps, 45 s budget)
   │   deterministic completion: validate every candidate, pick, then commit or request approval
   ▼
 Consent (pure, recoveryConsent.ts)
   ├─ AUTO_COMMIT        commitScheduleVersion ──► schedule_versions row (version >= 2), run COMMITTED
   ├─ NEEDS_DRIVER_APPROVAL  run NEEDS_APPROVAL (30 min TTL); driver approve/reject on the reservation page
   └─ NOT_ALLOWED / no candidate  run INFEASIBLE with a binding constraint
   ▼
 Settlement sweep (outdatedSessionService, every 5 min from runtime.ts)
   classify (RECOVERY_PENDING | AWAITING_DRIVER_APPROVAL | RECOVERABLE_DELAY | PERMANENTLY_INFEASIBLE)
   Policy OPERATOR_FAILURE_FULL_VOID_V1 (new agreements): WAIT · VOID (conclusive operator failure, keyed void, any delivered energy) · OPERATOR_RESOLUTION (flag with deadline, no money move)
   Legacy agreements: WAIT · VOID (zero delivered energy) · OPERATOR_RESOLUTION (delivered energy, flag only)
   Also: settles interrupted runs via the recovery path, reconciles provider-expired authorizations, flags unsimulated sessions past departure
```

**Safety model.**
- The model selects only among server-assigned candidate ids (`c1`, `c2`, ...). It receives no payment tool and no price input. Unknown tools, extra arguments, out-of-phase calls and unlisted ids are rejected and traced. A model failure ends the loop and the deterministic path finishes the run.
- The server owns the schedule and the money. `commitScheduleVersion` runs inside a serialized transaction. It checks the expected version, that energy before the slot is unchanged, the fence (run still `RUNNING`, same attempt, lease not expired), and the whole station-night under the disturbed envelope.
- Consent boundary: auto-commit only if the FORECAST plan reaches the agreed battery energy (a planned figure, never proof of delivery), the price does not rise, the departure does not move later, charging stays in the plugged-in window, past energy is unchanged and other sessions are unchanged. Later finish, earlier departure or a changed price need driver approval.
- Fencing: every trace append and commit is conditional on the current lease. A worker that lost its lease cannot write a version.
- Narrative text is generated from facts; model prose is accepted only if it passes the grounding check (no numbers or claims outside the facts).

**Tables.**

| Table | Role | Constraints |
|---|---|---|
| `disruption_events` | Recorded synthetic disturbances | Append-only trigger; `event_id` unique; `provenance` fixed to `SYNTHETIC`; type checked |
| `recovery_runs` | One run per disturbance: status, trace, proposal, expiry, lease, attempts, outcome, explanation | `disruption_event_id` unique; status checked; status changes by compare-and-set |
| `schedule_versions` | Committed revisions of one session's per-slot plan (version 1 is the agreed `terms.powerW`) | Primary key `(reservation_id, version)`; `version >= 2`; append-only trigger |

Migrations `003_recovery_engine`, `004_recovery_orchestrator` and `005_sweep_checked_at` (adds `reservations.sweep_checked_at`) in `src/server/db/migrations.ts`.

**Provenance labels.** Every recovery run and disturbance shows where its decision came from. The label is derived from the persisted run record (`src/server/services/recoveryProvenance.ts`), not from the UI:

| Label | Meaning |
|---|---|
| `MODEL_DECISION` | A model selected the tool calls, and the server validated them. Shown with the model name. |
| `DETERMINISTIC_FALLBACK` | No model decision: no key, a model failure, or a rejected output. The deterministic path decided. |
| `SIMULATED_EVENT` | The disturbance was injected by the operator as a synthetic event. It is not a real charger fault. |
| `MOCK MODEL (test fixture)` | A scripted model used in tests. Never shown as a live decision. |

In MOCK payment mode the payment step says "MOCK PAYMENT PROVIDER". It is not PayPal.

**Migrations and schema refusal.** Migrations run on PGlite on open, in the disposable test helpers, and only when `GW_AUTO_MIGRATE=true`. An external database is never migrated at startup. `openPostgres` throws `SchemaNotReadyError` when the ledger has pending, unknown or drifted migrations, and the runtime serves errors until the schema matches. The apply path is `npm run db:migrate` with `--status`, `--plan` and `--apply --confirm-database <fingerprint>`. See [MIGRATIONS.md](MIGRATIONS.md). Migrations 003 to 005 are not yet applied to the hosted Neon database.

**Services map (`src/server/services/`).**

| File | Responsibility |
|---|---|
| `scheduleService.ts` | Disturbance recording (idempotent), night envelope, version commit with fence, driver approve and reject |
| `recoveryOrchestrator.ts` | Run lifecycle: claim, lease, bounded model loop, deterministic completion, restart sweep (`resumeStuckRuns`) |
| `recoveryTools.ts` | Pure tool set and phase checks; trace sanitizing; deterministic pick |
| `recoveryPrompt.ts`, `recoveryNarrative.ts` | Model prompt and schema; fact-grounded explanation text |
| `recoveryRuns.ts`, `recoveryReceipt.ts`, `recoveryService.ts`, `recoveryHook.ts` | Run persistence views, receipt, service entry points, post-record hook |
| `scheduleView.ts` | Read model for `/api/schedule` and the operator timeline |
| `outdatedSessionService.ts` | Outdated-session classification, settlement routing (void or operator flag), overdue marking, provider-expiry reconciliation |

**Routes.**

| Route | Purpose |
|---|---|
| `POST /api/recovery/events` | Operator records a disturbance (operator session and Origin check) |
| `GET /api/recovery/runs/[id]` | Run view, with trace and candidate summaries |
| `POST /api/recovery/runs/[id]/approve` | Driver approves the exact proposal version |
| `POST /api/recovery/runs/[id]/reject` | Driver declines the proposal |
| `GET /api/schedule` | Persisted schedule read model for the operator timeline |
| Page `/operator/schedule` | Bryntum Scheduler Community 8.0.0 timeline (read-only) plus accessible table |

**Policy decisions (status).**

| Decision | Status |
|---|---|
| Settlement policy `OPERATOR_FAILURE_FULL_VOID_V1`: operator-attributable unrecoverable failure is a full void with zero charge, including partial physical delivery; nothing is captured partially; early departure and non-conclusive outcomes go to operator resolution | Implemented for new agreements (see trust boundary 4); legacy agreements unchanged. The policy text is the owner's decision as specified. The remedy cost is MODELED. |
| Auto-commit may raise the operator's energy cost relative to the agreed plan (the consent boundary protects the driver's terms, not operator cost) | Observed in the benchmark (56 auto cases, see `docs/RECOVERY_BENCHMARK.md`). Resolved: every automatic commit must still satisfy the operator economics constraint in `docs/08_ECONOMICS.md` (contribution improvement of at least 1 c against the immediate baseline, enforced in `evaluateCandidate`); all 56 do, the lowest at exactly 1 c. Higher electricity cost versus the agreed plan is allowed when that constraint holds. Analysis: `docs/RECOVERY_BENCHMARK_FINDINGS.md`. |
| Recovery plans on the forecast base load; replay uses realized base load | Known gap. The benchmark shows cases where recovery delivers less than the static plan under realized load (root cause NOT VERIFIED). |

## Evidence map

| Claim | Test / artifact |
|---|---|
| Physics and cap never violated | `tests/unit/physics.test.ts`, benchmark `violations=0` |
| Both parties win on every published offer | `tests/unit/economics.test.ts`, benchmark `validatorFailures=0` |
| Payment safety, recovery, idempotency | `tests/integration/{paymentSafety,recovery,lifecycle,certification}.test.ts` |
| AI cannot inject prices or capture claims | `tests/unit/assistant.test.ts`, `tests/integration/dealAgent.test.ts` (scripted model offline; one genuine Gemini run is summarized in `docs/EVIDENCE.md`) |
| Genuine PayPal Sandbox authorize→capture and authorize→void | [EVIDENCE.md](EVIDENCE.md) (standalone smoke, 2026-10-30) |
| Recovery never changes energy already delivered, price or other sessions; consent boundary | `tests/unit/recovery.test.ts`, `tests/unit/recoveryConsent.test.ts`, `tests/integration/scheduleRecovery.test.ts` |
| Recovery is fenced, bounded and resumable | `tests/integration/recoveryOrchestrator.test.ts`, `tests/unit/recoveryScheduler.test.ts` |
| Outdated-session settlement never captures an invalid plan | `tests/unit/outdatedSession.test.ts`, `tests/integration/outdatedSettlement.test.ts` |
| Recovery benchmark (SYNTHETIC) | `docs/RECOVERY_BENCHMARK.md`, `tests/unit/recoveryBenchmark.test.ts` |

## Reconciliation sweep

The periodic sweep (`OUTDATED_SWEEP_INTERVAL_MS`, plus one pass at boot) in `outdatedSessionService.ts` examines at most 50 reservations per pass. It selects authorized reservations, and unresolved reservations (`NEEDS_RECONCILIATION`) that hold a provider reference and whose authorization has not expired. Expired authorizations stay with the expired-authorization path, so they are not flipped back and forth.

- Unresolved rows are reconciled through `reconcileReservation`. If that leaves an authorized reservation awaiting capacity, the existing `commitCapacityOrVoid` runs, as the boot path does. No new payment call is introduced.
- Fairness: `reservations.sweep_checked_at` (migration `005_sweep_checked_at`) is stamped after each examination, and rows are selected least recently checked first. A backlog of unresolvable rows therefore rotates instead of starving later rows.
- Concurrency: an in-process guard coalesces overlapping sweeps into the one in flight. Across instances, safety rests on the payment-state CAS and the per-reservation settlement operation claims.
- Failures are isolated per reservation and logged by error name only.
