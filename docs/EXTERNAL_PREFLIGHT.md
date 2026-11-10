# External Test Preflight

Scope: read-only preflight for the three external test tracks (Gemini live recovery, PayPal Sandbox, Neon migrations 003 and 004). This document was produced without any external call. Nothing was migrated, no model was called, no PayPal order was created, and no `.env*` file was read.

## Required approvals

Nothing below has been executed on the combined release. Each needs the owner's explicit go-ahead.

1. **Gemini retry**: one live recovery run with `gemini-3.6-flash`, the model with earlier successful responses (section A.5). The owner sets the model in `.env.local`. The agent does not read that file.
2. **PayPal Sandbox**: two orders (section B and the runbook in `docs/PAYPAL_CERTIFICATION.md`), with Sandbox buyer approval on PayPal's page. Covers an authorize and capture and an authorize and void.
3. **Neon migrations 003 to 005**: take a backup branch first, then follow the ordered procedure in `docs/MIGRATIONS.md`. The agent must not run `--apply` against Neon.

Status key: PASS / FAIL / BLOCKED / NOT TESTED. Claims not confirmed by an executed check are labelled NOT VERIFIED.

| Track | Status | Reason |
|---|---|---|
| A. Gemini retry | BLOCKED (live recovery FAIL on last run) | 504 DEADLINE_EXCEEDED, model not used; retry needs operator approval and a `.env.local` edit |
| B. PayPal Sandbox | PASS (historical); dry run PASS | Capture and void PASSed on 2026-10-30; no new run needed |
| C. Neon 003/004 | NOT TESTED | No database access in this preflight; backup not taken; uncommitted 005 needs a decision |

---

## A. GEMINI RETRY

### A.1 Evidence from the last live run

Source: `artifacts/recovery-live-2026-11-09T19-13-09-066Z.json` (sanitized; no key, prompt or model text).

| Field | Value |
|---|---|
| Model recorded | `gemini-3.8-flash` |
| Model served (`servedModels`) | `[]` (no response) |
| Requests sent / limit | 1 / 6 |
| Provider response | none (`providerResponses: 0`) |
| Error category | `UNAVAILABLE` |
| HTTP status | 504 |
| Provider status | `DEADLINE_EXCEEDED` |
| Latency | 18,796 ms |
| Tokens | 0 in, 0 out |
| Estimated meter cost | $0.02999 (planning rate, not billing) |
| Run outcome | `COMMITTED`, `aiUsed: false`, `mode: FALLBACK`, `explanationSource: DETERMINISTIC` |
| Fallback reasons | `UNAVAILABLE`, `UNAVAILABLE` |
| Verdicts | `modelOnlyAllowedTools` BLOCKED (model named no tools); `noPaymentToolCalls` PASS; `chosenCandidatePassedValidation` PASS; `consentRespected` PASS; `requestCapEnforced` PASS; `modelFailureFallsBack` PASS; `invalidOrInjectedOutputFallsBack` NOT TESTED |

Reading: the 504 arrived at 18.8 s, before the client-side 20 s limit, so the provider returned `DEADLINE_EXCEEDED` itself. The run therefore did not exercise the model at all. The deterministic fallback did the work. This run does not count as a live model pass.

No artifact in `artifacts/` shows a successful `gemini-3.8-flash` call.

### A.2 Timeouts and caps (from code)

| Setting | Value | Location |
|---|---|---|
| Client timeout (SDK `httpOptions.timeout` and race timer) | 20,000 ms, hard-coded, no env override | `src/server/ai/geminiLlm.ts:15`, used at lines 39, 43 and 55 |
| SDK retries | `attempts: 1` (no retry) | `geminiLlm.ts:43` |
| Thinking | `ThinkingLevel.LOW` | `geminiLlm.ts:68` |
| Output cap sent to Gemini | `req.maxTokens + 1,024` headroom | `geminiLlm.ts:67` |
| Recovery step output cap | `STEP_MAX_TOKENS = 512`, so 1,536 sent | `src/server/services/recoveryOrchestrator.ts:25` |
| Recovery loop budget | `LOOP_BUDGET_MS = 45,000` (per-step `withTimeout` uses remaining budget) | `recoveryOrchestrator.ts:24`, `:242-245` |
| Recovery tool steps | `MAX_TOOL_STEPS = 8`; `MAX_ATTEMPTS = 3` | `recoveryOrchestrator.ts:20-21` |
| recovery-live request cap / budget | 6 requests; $0.25 cap at planning price $10 in / $50 out per M tokens | `scripts/recovery-live.ts:28-31` |
| ai-smoke request cap / budget | `AI_SMOKE_MAX_REQUESTS` default 8; `AI_SMOKE_BUDGET_USD` default $0.50; per-request `max_tokens` <= 2,048 | `scripts/ai-smoke.ts:17,39-40`; `scripts/aiSmokeFlow.ts:96` |
| ai-smoke timeout | Comment says 20 s; the value used is the 20 s in `geminiLlm.ts` | `scripts/ai-smoke.ts:6` |

Is 20 s reasonable? For a 1,536-token cap with LOW thinking, 20 s is normal for Flash models. The successful `gemini-3.6-flash` calls in the 2026-11-05 certification took 0.96 to 2.02 s each (`artifacts/ai-smoke-gemini-2026-11-05T23-08-03-654Z.json`). The 20 s limit therefore has a wide margin for the 3.6 model. For 3.8 there is no successful latency sample, so whether 20 s is enough for it is NOT VERIFIED.

### A.3 Model selection and what the artifacts prove

Model ids with evidence in `artifacts/` (sanitized files, read only):

| Model id | Successful response in an artifact | Evidence |
|---|---|---|
| `gemini-3.6-flash` | Yes | `ai-smoke-gemini-2026-11-05T23-08-03-654Z.json` (certified): metadata preflight `available: true, supportsGenerateContent: true`; 5 requests, 5 provider responses; `servedModels: ["gemini-3.6-flash"]`; per-call latency 963, 1,272, 1,366, 1,415, 2,019 ms; tokens 2,063 in / 548 out. `ai-smoke-gemini-run1-2026-11-05.json` (not certified, earlier run): `servedModels: ["gemini-3.6-flash"]`; 4 successful, 1 UNAVAILABLE; the five recorded latencies were 1,375 to 3,747 ms (one of them belongs to the UNAVAILABLE call, which the file does not identify). |
| `gemini-3.8-flash` | No | `recovery-live-2026-11-09T19-13-09-066Z.json`: 1 request, 0 provider responses, `servedModels: []`, HTTP 504, `DEADLINE_EXCEEDED`, 18,796 ms, 0 tokens. No other artifact in `artifacts/` mentions it. |

**VERIFIED MODEL: `gemini-3.6-flash`** (the only id with a successful response in the artifacts).

**VERIFIED MODEL for `gemini-3.8-flash`: unknown.** The artifacts show one failed call and no success. Nothing else is proven about it.

Where the 3.8 value came from: `scripts/recovery-live.ts` reads `GEMINI_MODEL` from `.env.local` first, then from the shell, then uses `DEFAULT_GEMINI_MODEL`. The artifact proves 3.8 was the value used. That `.env.local` set it is NOT VERIFIED (the file was not read, by design).

Code default: `DEFAULT_GEMINI_MODEL = "gemini-3.6-flash"` (`src/server/ai/geminiLlm.ts:14`). The artifacts prove 3.6 works and do not prove the default is wrong, so **no default was changed**.

Metadata-only check for 3.8 (`models.get`, no generation, no tokens). Documented here, NOT RUN. It needs `GEMINI_API_KEY` exported in the shell (not read from `.env.local`; never printed):

```
npx tsx -e "import { GeminiLlm } from './src/server/ai/geminiLlm.ts'; (async () => { for (const m of ['gemini-3.6-flash', 'gemini-3.8-flash']) console.log(m, JSON.stringify(await GeminiLlm.checkModelAccess(process.env.GEMINI_API_KEY ?? '', m))); })();"
```

Expected: `available: true, supportsGenerateContent: true` for each id. A `false` result with a sanitized `diagnostic` is a stop signal for that id. This check cannot show quota or billing tier.

### A.4 Timeout, thinking budget and likely cause (analysis, no defaults changed)

| Question | Finding | Status |
|---|---|---|
| Did our 20 s timer fire? | No. The 504 arrived at 18,796 ms, before the 20,000 ms client timer (`geminiLlm.ts:15`). The provider's own `DEADLINE_EXCEEDED` answered the call. | PROVEN (from the artifact's latency and status) |
| Is the 3.8 failure caused by the thinking budget? | Unlikely to be the difference. The thinking setting is the same `ThinkingLevel.LOW` (`geminiLlm.ts:68`) used by the successful 3.6 calls, and the recovery step asks for less output (512 + 1,024 headroom = 1,536 sent) than the 3.6 certification calls (up to 2,048 + 1,024 = 3,072 for explain). | PROVEN that the config is the same code path; the cause is NOT VERIFIED |
| Is 20 s reasonable for 3.6? | Yes. The slowest recorded 3.6 call was 3,747 ms; 20 s is more than 5x that. | PROVEN for 3.6 only |
| Is 20 s reasonable for 3.8? | NOT VERIFIED. There is one failed sample and no successful one. | UNKNOWN |
| Most likely cause of the 504 | 3.8 was slow or under load on that request. A single sample cannot separate that from a provider-side problem with the id. | HYPOTHESIS, NOT VERIFIED |

Proposed parameters for one retry (NOT EXECUTED). All values already exist in code; nothing new is introduced:

| Parameter | Value | Where it is set |
|---|---|---|
| Model id | `gemini-3.6-flash` (set `GEMINI_MODEL=gemini-3.6-flash` in `.env.local`, or remove the key to use the default) | `.env.local` (`scripts/recovery-live.ts`), default in `geminiLlm.ts:14` |
| Requests | One recovery run. The model loop stops at the first provider failure (`recoveryOrchestrator.ts`, `skipModel`, line 248), so a failed retry costs one request. Hard cap 6 requests. | `scripts/recovery-live.ts:28` |
| SDK retries | None (`attempts: 1`) | `geminiLlm.ts` (`retryOptions`) |
| Max output tokens | 512 requested + 1,024 thinking headroom = 1,536 sent | `recoveryOrchestrator.ts` (`STEP_MAX_TOKENS`), `geminiLlm.ts` |
| Client timeout | 20,000 ms | `geminiLlm.ts:15` |
| Budget cap | $0.25 at the planning rate of $10 in / $50 out per million tokens (the free tier is priced at $0 in the meter; the paid tariff was not verified) | `scripts/recovery-live.ts:29-32` |

If the 3.6 retry also ends in TIMEOUT or UNAVAILABLE, the next step is a separate decision, not an automatic change: raising the client timeout to 30,000 ms (stays below `LOOP_BUDGET_MS` of 45,000 ms) and updating `tests/unit/geminiLlm.test.ts`.

### A.5 Retry: exact steps (NOT EXECUTED, needs your separate authorization)

This retry has not been run. Running `--approve-gemini-calls` is the authorization step, and it needs your separate go-ahead.

1. In `.env.local` (values never pasted or printed) set `GEMINI_MODEL=gemini-3.6-flash`, or remove the `GEMINI_MODEL` line. Only `GEMINI_API_KEY` and `GEMINI_MODEL` are read by the script. A value in `.env.local` overrides a shell `GEMINI_MODEL`.
2. Optional metadata check (A.3 command). No generation call.
3. Dry run, no model call and `.env.local` not opened:
   ```
   npx tsx scripts/recovery-live.ts
   ```
   It must report at least 2 usable candidates before the live step is allowed.
4. Live call, one recovery run, at most 6 requests, no SDK retries, payments MOCK, in-memory PGlite (Neon not used):
   ```
   npx tsx scripts/recovery-live.ts --approve-gemini-calls
   ```

Evidence file: `artifacts/recovery-live-<ISO timestamp>.json`. It is git-ignored by the rule `artifacts/recovery-live*.json` in `.gitignore`, which was confirmed with `git check-ignore`. It contains sanitized values only: no key, no prompt, no model text, no `DATABASE_URL`. The `run.mode` field is now the derived decision (`MODEL_DECISION` or `DETERMINISTIC_FALLBACK`), and `run.provenance` gives the label.

### A.6 Tool boundary

- Model output may name only tools in `TOOL_NAMES` (`src/server/services/recoveryTools.ts:53`): read-only state tools and the recovery tools (`requestRecoveryCandidates`, `validateRecoveryPlan`, `proposeRecovery`, `commitPermittedRecovery`). The rehearsal trace shows these names.
- No payment tool is in the set. `noPaymentToolCalls` checks that the gateway was called 0 times during the run (it was, in the 2026-11-09 run).
- Gemini is called with no tools, no function calling and no search grounding (`geminiLlm.ts` header).
- The grounding filter and backend recomputation still apply to any model answer.

### A.7 Pass criteria for the retry

A run is a live model pass only when every row below holds. A fallback result is never a live model pass, even when its verdicts show PASS.

| Criterion | Pass |
|---|---|
| Model answered | at least one `calls[]` entry has `responded` true and `ok` true, and `servedModels` contains `gemini-3.6-flash` |
| Model decided | `run.mode` is `MODEL_DECISION`: `run.aiUsed` is true AND the trace holds a GEMINI `OK` step for `proposeRecovery`, `commitPermittedRecovery` or `requestDriverApproval`. The label is `MODEL_DECISION · Gemini (live model)` |
| Fallback reported honestly | if the model did not decide, `run.mode` is `DETERMINISTIC_FALLBACK` and `fallbackReasons` says why |
| `modelOnlyAllowedTools` | PASS (model named at least one tool, all inside the tool set) |
| `noPaymentToolCalls` | PASS (0 gateway calls during the run) |
| `requestCapEnforced` | PASS (6 or fewer requests) |
| `consentRespected` | PASS |
| `invalidOrInjectedOutputFallsBack` | NOT TESTED by this script. It needs a separate adversarial probe. The unit and integration tests in `tests/integration/recoveryAgentBoundary.test.ts` cover the fallback path with scripted fixtures, not the live model. |

### A.8 Evidence files and redaction

- Written: `artifacts/recovery-live-<ISO timestamp>.json`. Redaction is enforced by the script: no key, no prompt, no model text, no `DATABASE_URL`. Only tool names, verdicts, digests, latencies, counts and provider error categories are written (`scripts/recovery-live.ts:6`).
- Git status of these artifacts: NOT VERIFIED (`artifacts/` ignore rules not read).
- Existing ai-smoke evidence: `artifacts/ai-smoke-gemini-2026-11-05T23-08-03-654Z.json` (certified) and `artifacts/ai-smoke-gemini-run1-2026-11-05.json` (not certified).

---

## B. PAYPAL SANDBOX

### B.1 Status

- Capture-only and void-only smoke PASSED on 2026-10-30 (`docs/EXTERNAL_INTEGRATION.md` section 1a, "DONE ... do not repeat"). Historical; NOT linked to the recovery work; no recovery-linked sandbox evidence exists. Audit of the artifacts (2026-11-09): `docs/PAYPAL_CERTIFICATION.md` section 0. Evidence: `artifacts/paypal-smoke-capture-only-smoke_1793370835421.json` (capture COMPLETED, amount 123 cents, authorization matches) and `artifacts/paypal-smoke-void-only-smoke_1793372411617.json` (authorization VOIDED). `artifacts/paypal-smoke.json` has the same content as the capture-only run (same `ranAt`). IDs in those files are already redacted (`…` plus the last 6 characters).
- No PayPal call was made in this preflight.

### B.2 Dry run executed in this preflight

Pre-check: `scripts/paypal-smoke.ts` reads `process.argv` and exits before `sandboxSetup()` when `--approve-sandbox-orders` is absent. `scripts/paypalSmokeFlow.ts` and `scripts/paypalSandboxCli.ts` only define functions and constants at module level; `src/payments/paypalSandbox.ts` only defines a constant URL (`PAYPAL_SANDBOX_API`) and schemas. `.env.local` is opened only in `sandboxSetup()`, which the dry run never reaches. The dry run therefore makes no network call and reads no `.env*` file.

Command: `npm run -s paypal:smoke`

Exact output (exit 0):

```
PayPal Sandbox smoke plan (https://api-m.sandbox.paypal.com):
  capture: create AUTHORIZE order USD 1.23 → you approve on PayPal → authorize → capture once → re-read capture
  void: create AUTHORIZE order USD 1.23 → you approve on PayPal → authorize → void once → re-read authorization
  Orders created: 2
  Writes are sent once each with a fixed PayPal-Request-Id; nothing is retried. Any mismatch stops the run.

Dry run only. Re-run with --approve-sandbox-orders to send these sandbox requests.
```

Result: PASS (dry run). Result of a real run: not run.

### B.3 Commands

| Purpose | Command | Orders created |
|---|---|---|
| Dry run (no network) | `npm run -s paypal:smoke` | 0 |
| Capture path only | `npm run paypal:smoke -- --approve-sandbox-orders --capture-only` | 1 |
| Void path only | `npm run paypal:smoke -- --approve-sandbox-orders --void-only` | 1 |
| Both paths | `npm run paypal:smoke -- --approve-sandbox-orders` | 2 |
| Finish an existing order (no new order) | `npm run paypal:smoke -- --approve-sandbox-orders --resume-order <ORDER_ID>` | 0 |

`--capture-only`, `--void-only` and `--resume-order` cannot be combined (`selectSmokeFlows`, `scripts/paypalSmokeFlow.ts:239-245`). `--resume-order` accepts only letters and digits, 10 to 30 characters.

Amount and currency: `SMOKE_AMOUNT_CENTS = 123` (USD 1.23) per order, `scripts/paypalSmokeFlow.ts:9`. Each order is `intent AUTHORIZE`.

### B.4 Environment key names (values never printed, never pasted)

From `scripts/paypalSandboxCli.ts` and `src/server/env.ts`:

| Key | Required for smoke | Notes |
|---|---|---|
| `PAYMENT_MODE` | Yes | must equal `paypal_sandbox` |
| `PAYPAL_ENV` | Yes | must equal `sandbox` |
| `PAYPAL_CLIENT_ID` | Yes | shell value overrides `.env.local`; a warning is printed if they differ |
| `PAYPAL_CLIENT_SECRET` | Yes | never printed |
| `PAYPAL_EXPECTED_MERCHANT_ID` | Yes | run refuses to start without it |
| `PAYPAL_WEBHOOK_ID` | No for smoke | used by webhook verification in the app |
| `PAYPAL_SMOKE_APPROVAL_MINUTES` | No | integer 1 to 180; default 30 |
| `GW_DATA_DIR`, `DATABASE_URL`, `MIGRATION_DATABASE_URL` | No for smoke | smoke does not use the database |

`loadEnv` in `src/server/env.ts` parses the whole environment. Whether it requires `SESSION_SECRET` or `OPERATOR_PASSPHRASE` for the smoke path is NOT VERIFIED (the schema lists them as optional strings; the app checks them at its own startup).

### B.5 Human buyer-approval steps

1. The script prints one `https://www.sandbox.paypal.com/...` approval link per order (any other host stops the run).
2. Open the link in a browser and sign in as the sandbox buyer account yourself. The script never logs in or approves.
3. Approve within the window (default 30 minutes; `PAYPAL_SMOKE_APPROVAL_MINUTES` to change). After the window the run stops and the order remains unapproved.
4. Return to the terminal. The script then authorizes once, and captures or voids once.
5. Before any approval link is shown, the script checks that the payee on the created order equals `PAYPAL_EXPECTED_MERCHANT_ID` (merchant ID format `^[A-Z0-9]{10,20}$`). A wrong payee stops the run.

### B.6 Idempotency

- Each write uses a fixed `PayPal-Request-Id` derived from the run reference (`${ref}:CREATE_ORDER` in `scripts/paypalSmokeFlow.ts:153`; the other writes use their own fixed IDs). The header is sent only when a request ID is passed (`src/payments/paypalSandbox.ts:155`).
- Writes are sent once and never retried in code.
- Re-running the whole command creates NEW orders with new request IDs. It does not replay the old ones.

### B.7 What is checked at PayPal after each step

| Step | PayPal call | Checked |
|---|---|---|
| Create order | `POST /v2/checkout/orders` | amount 1.23 USD, custom_id matches the run reference, payee = expected merchant. No status is asserted here; the 2026-10-30 artifacts record `PAYER_ACTION_REQUIRED` at this step |
| Buyer approval | `GET /v2/checkout/orders/{id}` (poll) | status APPROVED (or COMPLETED) |
| Authorize | `POST /v2/checkout/orders/{id}/authorize` | authorization returned, amount and currency match |
| Capture path | `POST /v2/payments/authorizations/{id}/capture`, then `GET /v2/payments/captures/{id}` | capture COMPLETED, amount match |
| Void path | `POST /v2/payments/authorizations/{id}/void`, then `GET /v2/payments/authorizations/{id}` | authorization VOIDED |

The 2026-10-30 artifacts list these operations as performed in that order.

### B.8 Avoid extra orders after a failure

- The script prints "Nothing was retried. Do not re-run blindly" on failure. Follow that message.
- Read the progress file first: `artifacts/paypal-smoke-<mode>-<runId>.progress.json` (written after every provider response; IDs redacted).
- To finish an existing order, use `--resume-order <ORDER_ID>` with the ID printed by the failed run. This creates no order.
- An unapproved order cannot be charged (script message on SIGINT). Leave it or finish it with `--resume-order`; do not start a new run to replace it.
- Do not run the full command (2 orders) to "retry" a single failed path. Use the single-path flag.

### B.9 Evidence and redaction

- Written per run: `artifacts/paypal-smoke-<mode>-<runId>.json` (only when the run passes) and `.progress.json` (after every response). Both are created with `wx` (never overwritten). Both are git-ignored, according to `docs/EXTERNAL_INTEGRATION.md` (ignore rules NOT VERIFIED in this preflight).
- Redaction: IDs as `…` plus the last 6 characters; the client ID is a 12-character SHA-256 fingerprint; no secret printed.

---

## C. NEON MIGRATIONS 003 AND 004

### C.1 Migration list (entries in `src/server/db/migrations.ts`, in array order)

| Id | Status in the file | Contents |
|---|---|---|
| `001_core` | committed | Tables: `quote_sets`, `reservations`, `payment_operations`, `provider_proofs`, `webhook_inbox`, `simulation_runs`, `energy_records`, `events`, `mock_provider_objects`. Index `reservations_station_night`, unique partial index `payment_operations_one_settlement` (CAPTURE/VOID per reservation), index `events_reservation`. Function `gw_forbid_mutation()`. Triggers `events_append_only` and `energy_records_append_only`. |
| `002_operation_recovery` | committed | `alter table payment_operations add column` for `lease_until`, `attempts` (not null default 0), `request` (jsonb), `terms_hash`, `amount_cents`. Function `gw_forbid_terms_change()`. Trigger `reservations_terms_immutable` (BEFORE UPDATE on `reservations`). |
| `003_recovery_engine` | committed | Tables `disruption_events` (check constraints on type and effective_slot; `provenance` check = SYNTHETIC), `recovery_runs` (status check, unique `disruption_event_id` FK to `disruption_events(event_id)`), `schedule_versions` (composite PK `(reservation_id, version)`, version >= 2, FK `reservation_id` and `recovery_run_id`). Index `disruption_events_reservation`. Triggers `disruption_events_append_only` and `schedule_versions_append_only` (both use `gw_forbid_mutation`). |
| `004_recovery_orchestrator` | committed | `alter table recovery_runs add column`: `attempts` integer not null default 0 with check >= 0; `ai_used` boolean not null default false; `outcome` jsonb; `explanation` jsonb. No index, no trigger. |
| `005_sweep_checked_at` | committed in `feature/combined-release` (HEAD f1ac53c); not in the original preflight list | `alter table reservations add column sweep_checked_at timestamptz` (nullable). Additive. Decide whether it is in scope before applying. |

Note on 005: `npm run db:migrate -- --plan` lists it with 003 and 004 when it is pending. It cannot be applied without an explicit `--apply`.

### C.2 Idempotency (precise)

- The SQL uses plain `create table`, `create index`, `create function`, `create trigger` and `alter table ... add column`, all without `IF NOT EXISTS`.
- An applied migration is skipped because its id is in `schema_migrations`. Re-running the SQL by hand, or on a database that has the objects but not the ledger row, fails with "already exists" and that migration's transaction rolls back.
- Each migration runs in its own transaction under the advisory lock `gridwindow:migrations`. A failing migration is rolled back and not recorded; earlier ones stay applied and recorded. Concurrent runners serialize on the lock and re-check the ledger inside it.

### C.3 Runner and recording (updated)

- `src/server/db/migrator.ts`, `applyPending(db)`, per migration in array order: inside one transaction under the lock, create the ledger if needed, skip if recorded, otherwise run its SQL and insert `(id, checksum)`.
- `checksum` is SHA-256 of the migration SQL. The ledger gained this column; rows written before it existed are reported as "applied before checksums were recorded" and get their checksum on `--apply`.
- Before applying, the runner refuses a database with unknown ids or a checksum that differs from this build.
- 001 and 002 are ordinary entries in the same list. Whether they are applied on Neon is UNKNOWN (see C.6); `--status` shows it.

### C.4 Is migration implicit on boot? (changed: no)

- Before this change, `openPostgres` migrated Neon on first use. It no longer does.
- Now `openPostgres` (`src/server/db/client.ts`) reads the ledger and throws `SchemaNotReadyError` unless the schema matches this build exactly. The runtime then serves errors instead of traffic against a mismatched schema. Nothing is written.
- `GW_AUTO_MIGRATE=true` restores boot-time migration. It is for disposable databases only and must not be set for Neon.
- PGlite (local `.data/pglite`) still migrates on open.

### C.5 Risk assessment

| Risk | Detail | Assessment |
|---|---|---|
| Append-only triggers | `disruption_events` and `schedule_versions` (003), plus existing `events` and `energy_records` (001), use `gw_forbid_mutation`. Rows cannot be UPDATE or DELETE-d. | Expected behaviour. Rollback by DELETE is impossible without first dropping the trigger. |
| Immutable terms trigger | 002 adds `reservations_terms_immutable` on every UPDATE of `reservations`. It raises only when terms, amount, currency, offer or session change. | Existing rows are not affected by the migration itself. The trigger fires on every reservation update, which matters only if other code changes terms. |
| ALTER TABLE ADD COLUMN | 004 adds `not null default` columns to `recovery_runs`, and 002 adds one to `payment_operations`. On PostgreSQL 11 and later a constant default is a metadata change, but the statement still takes an ACCESS EXCLUSIVE lock briefly. | Low for small tables. The lock behaviour on the Neon version is NOT VERIFIED. |
| Check constraint on add column | 004's `attempts` check is validated against existing rows during the ALTER. | Low; defaults are 0. |
| 003 foreign keys | `schedule_versions` and `recovery_runs` reference `reservations` and `recovery_runs`. `disruption_events` references `reservations`. | Created with the tables; no existing rows are touched. |
| 005 | Adds a nullable column to `reservations`. | Low risk. Additive; see C.1. |
| Pooled connection | Migrations through a transaction pooler are not recommended here. | Use `MIGRATION_DATABASE_URL` (direct) as `docs/EXTERNAL_INTEGRATION.md` section 0b says. |

### C.6 What is known and unknown about the Neon schema

Known (from artifacts and docs):

- `artifacts/payment-preflight-2026-11-06T20-44-18-548Z.json` (latest) ran a read-only query on `reservations` with `DATABASE_URL` set. Its `dbNotes` say "night 2026-11-08 already has 2 reservation(s) in the database (0 still hold capacity)". So the `reservations` table existed and was readable on that date.
- That preflight queries only `reservations` and the `committedPlans` helper. It does not query `schedule_versions`, `recovery_runs` or `disruption_events`. It cannot show whether 003 or 004 are applied.
- Earlier preflight artifacts (2026-11-05 and 2026-11-06, 13 files) show configuration PASS rows and, in two files, a single FAIL on `TRUST_PROXY`. None shows a schema error.
- The message `relation "schedule_versions" does not exist` is not present in any file under `artifacts/` (searched). It was reported in conversation only, so it is NOT VERIFIED in the repo. If it is true, it shows that 003 was not applied at that time, and nothing more.
- The Neon preflight night (2026-11-08) is in the past as of 2026-11-09, so the artifact's plans are stale.

Unknown (cannot be determined without database access, which this preflight did not use):

- Whether `schema_migrations` exists on Neon, and which ids it holds.
- Whether 001 and 002 are applied.
- Whether any 003/004 object exists partially (a partial state is possible only if objects were created outside the runner).
- The Neon PostgreSQL major version (affects lock behaviour and `pg_dump` compatibility).

Operator query for the first point (read-only; run in your own session, not by the agent): `select id, applied_at from schema_migrations order by applied_at;`. If the table is missing, the database has never been migrated by this code.

### C.7 Backup plan (before migrating)

1. In the Neon console, create a branch from the current production-equivalent branch, or confirm point-in-time restore is available for the window before the migration. NOT VERIFIED: the plan tier and retention window.
2. Schema-only dump to a local file. Use a connection string from your own shell environment variable (for example `MIGRATION_DATABASE_URL`, the direct URL) without echoing it:

   ```
   pg_dump --schema-only --no-owner --file "$HOME/gridwindow-schema-before-003.sql" "$MIGRATION_DATABASE_URL" > /dev/null 2>&1
   ```

   Do not run with `set -x` or `echo` of the variable. If it fails, check the exit code only; do not paste the error if it contains a URL. The `pg_dump` major version must match the server (NOT VERIFIED).
3. A schema dump does not hold data. The Neon branch or PITR is the data backup.

### C.8 Rollback plan (manual, untested)

- There is no down migration. The runner only applies up steps.
- Preferred rollback: restore the Neon branch or PITR point taken in C.7.
- Manual SQL rollback is possible but untested, and it destroys recorded data. Only after a data check, in this order, inside one transaction, with the append-only triggers dropped first:
  - drop triggers `schedule_versions_append_only` and `disruption_events_append_only`, if you must delete rows;
  - `drop table schedule_versions; drop table recovery_runs; drop table disruption_events;` (in that order, because of foreign keys);
  - for 004 alone (no table drop): `alter table recovery_runs drop column attempts, drop column ai_used, drop column outcome, drop column explanation;`
  - `delete from schema_migrations where id in (...)` for each rolled-back id.
- Do not run any of this without a verified backup. The 002 terms trigger and its function must stay in place unless 002 is also rolled back.

### C.9 Exact ordered procedure (the owner runs it; the agent does not)

The full procedure, rollback and recovery are in `docs/MIGRATIONS.md`. In short, with `MIGRATION_DATABASE_URL` (direct URL) set in `.env.local`:

1. Take a Neon branch or confirm the point-in-time restore window (C.7). Record the branch name, not the URL.
2. `npm run db:migrate -- --status`. Note the printed `target fingerprint` and the pending list. Stop if the output shows unknown ids or a checksum change.
3. `npm run db:migrate -- --plan`. Review the objects.
4. `npm run db:migrate -- --apply --confirm-database <fingerprint from step 2>`.
5. `npm run db:migrate -- --status`. Expect `schema ready for this build: yes` and exit code 0.
6. App smoke check: `npm run build`, `npm start`, load the home page and the operator console. The server log must show no `SchemaNotReadyError`.
7. Record the result in `plans/PROGRESS.md`.

NOT RUN. The migration of the real Neon database needs separate authorization.

### C.10 Status

NOT TESTED against Neon. The migration command was tested only against PGlite and a disposable local PostgreSQL (see `docs/MIGRATIONS.md`). Reasons: no database access was used; no backup has been taken; the Neon state is unknown.

---

## Operator actions (summary)

1. Gemini: edit `GEMINI_MODEL` in `.env.local` to `gemini-3.6-flash` (or remove it), then run the command in A.5 once. Read the evidence before any repeat.
2. PayPal: nothing needed for the smoke track (PASSed 2026-10-30). Do not re-run it.
3. Neon: decide on 005; check `schema_migrations` with `npm run db:migrate -- --status` (C.9); take the backup in C.7; then run the ordered procedure in C.9. Record the result in `plans/PROGRESS.md`.

## Gemini live attempts of 2026-11-10: offline diagnosis (no provider calls)
Three bounded live attempts returned no model response: `gemini-3.8-flash` HTTP 504 (2026-11-09), then `gemini-3.6-flash` HTTP 503 after 4,081 ms and HTTP 504 DEADLINE_EXCEEDED after 19,311 ms (2026-11-10). Findings from reading the code and capturing one request with the network blocked (dummy key, SDK base URL on a closed local port, `fetch` replaced; nothing left the machine):
- **Timeout source.** Our configured 20 s (`TIMEOUT_MS` in `geminiLlm.ts`) is applied twice client-side (SDK `httpOptions.timeout`, plus an `AbortController` race) and is also sent to the provider as the header `x-server-timeout: 20`. A client-side abort would be reported as `TIMEOUT`; the 19.3 s failure was an `ApiError` 504 with provider status DEADLINE_EXCEEDED, so it was returned by the provider, against the deadline we asked for. The 503 at 4 s is provider-originated. Why the provider did not answer a tiny request within 20 s is UNKNOWN from our side.
- **Request size.** `POST /v1beta/models/gemini-3.6-flash:generateContent`, 1,839 body characters, about 415 estimated input tokens (system 1,167 chars, user 258, response schema 235), no tools, `thinkingLevel: LOW`, `maxOutputTokens` 1,536, JSON response mode. This is not a size problem. Earlier successful `gemini-3.6-flash` calls (2026-11-05) took 0.96 to 2.02 s.
- **Other deadlines.** Model-loop budget 45 s (`LOOP_BUDGET_MS`), run lease 60 s (`LEASE_MS`, renewed each step), at most 3 attempts per run, at most 8 model steps. None fired; the first failed request ends the loop and the deterministic path completes the run.
- **Request cap.** The model returns one JSON "tool call" per request (no native function calling). A model-chosen outcome (`MODEL_DECISION`) needs the model to choose `proposeRecovery`, `commitPermittedRecovery` or `requestDriverApproval`, which in practice takes about four requests (candidates, validate, propose, commit or ask for approval). `--max-requests=1` can show at most one tool call, never a completed model-driven decision; the default cap of 6 is sufficient.
- **Model access** cannot be confirmed without a provider call (`checkModelAccess` is a metadata request). Not run.
- Flags: `--model=<id>` (wins over `.env.local`) and `--max-requests=N` (can only lower the cap of 6) are covered by `tests/unit/recoveryLiveFlow.test.ts`; 503/504/client-timeout classification by `tests/unit/geminiDiagnostics.test.ts`.
