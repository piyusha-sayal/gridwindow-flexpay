# External Test Preflight

Scope: read-only preflight for the three external test tracks (Gemini live recovery, PayPal Sandbox, Neon migrations 003 and 004). This document was produced without any external call. Nothing was migrated, no model was called, no PayPal order was created, and no `.env*` file was read.

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
| Client timeout (SDK `httpOptions.timeout` and race timer) | 20,000 ms, hard-coded, no env override | `src/server/ai/geminiLlm.ts:15`, used at lines 38 and 49-54 |
| SDK retries | `attempts: 1` (no retry) | `geminiLlm.ts:42` |
| Thinking | `ThinkingLevel.LOW` | `geminiLlm.ts:67` |
| Output cap sent to Gemini | `req.maxTokens + 1,024` headroom | `geminiLlm.ts:66` |
| Recovery step output cap | `STEP_MAX_TOKENS = 512`, so 1,536 sent | `src/server/services/recoveryOrchestrator.ts:25` |
| Recovery loop budget | `LOOP_BUDGET_MS = 45,000` (per-step `withTimeout` uses remaining budget) | `recoveryOrchestrator.ts:24`, `:242-245` |
| Recovery tool steps | `MAX_TOOL_STEPS = 8`; `MAX_ATTEMPTS = 3` | `recoveryOrchestrator.ts:20-21` |
| recovery-live request cap / budget | 6 requests; $0.25 cap at planning price $10 in / $50 out per M tokens | `scripts/recovery-live.ts:28-31` |
| ai-smoke request cap / budget | `AI_SMOKE_MAX_REQUESTS` default 8; `AI_SMOKE_BUDGET_USD` default $0.50; per-request `max_tokens` <= 2,048 | `scripts/ai-smoke.ts:17,39-40`; `scripts/aiSmokeFlow.ts:96` |
| ai-smoke timeout | Comment says 20 s; the value used is the 20 s in `geminiLlm.ts` | `scripts/ai-smoke.ts:6` |

Is 20 s reasonable? For a 1,536-token cap with LOW thinking, 20 s is normal for Flash models. The successful `gemini-3.6-flash` calls in the 2026-11-05 certification took 0.96 to 2.02 s each (`artifacts/ai-smoke-gemini-2026-11-05T23-08-03-654Z.json`). The 20 s limit therefore has a wide margin for the 3.6 model. For 3.8 there is no successful latency sample, so whether 20 s is enough for it is NOT VERIFIED.

### A.3 Model selection

| Source | Model |
|---|---|
| `DEFAULT_GEMINI_MODEL` (`geminiLlm.ts:14`) | `gemini-3.6-flash` |
| Model in the 2026-11-09 recovery artifact | `gemini-3.8-flash` |
| Model in the successful ai-smoke certification (2026-11-05 23:08) | `gemini-3.6-flash`, served `gemini-3.6-flash`, 5 of 5 calls responded, 4 of 4 mandatory cases MODEL_VALIDATED, `certified: true` |
| Model in the earlier ai-smoke run (2026-11-05 22:40) | `gemini-3.6-flash`; one UNAVAILABLE and three grounding rejections (before the fixes) |

Why the recovery run used 3.8: `scripts/recovery-live.ts` uses `fileEnv.GEMINI_MODEL ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL`. `fileEnv` comes from `.env.local` (keys allowlisted in `scripts/recoveryLiveFlow.ts:9`). The `.env.local` value therefore beats a shell `GEMINI_MODEL`. The file was not read for this preflight, so whether `.env.local` sets `GEMINI_MODEL=gemini-3.8-flash` is NOT VERIFIED. The artifact shows that 3.8 was the value used.

Known: the code, the docs (`docs/EXTERNAL_INTEGRATION.md` section 2a) and the 3.6 evidence all point to `gemini-3.6-flash` as the model with a successful live record. `gemini-3.8-flash` has no successful record in the repo.

### A.4 Likely cause and proposals (no defaults changed)

Most likely cause (NOT VERIFIED as a fact): the 3.8 model is slower or was under load when called. The 504 came inside the 20 s limit, and a model change is a cheaper explanation than a code fault.

Proposals, in order of risk:

1. Operator change only (no code): in `.env.local`, set `GEMINI_MODEL=gemini-3.6-flash` (or remove the line so the default applies), then retry. Note that a shell-level `GEMINI_MODEL` is overridden by the `.env.local` value.
2. Code proposal (not applied): raise `TIMEOUT_MS` in `src/server/ai/geminiLlm.ts` from 20,000 to 30,000 ms. This stays below `LOOP_BUDGET_MS` (45,000) and needs a unit test update in `tests/unit/geminiLlm.test.ts` (NOT VERIFIED that the test asserts 20 s). Only do this if option 1 also fails.
3. Do not raise `MAX_REQUESTS` or the budget to chase a retry. The run has no retry path, so a failed call costs one request.

### A.5 Retry command (requires your approval)

There is no npm script for recovery-live. The command is:

```
npx tsx scripts/recovery-live.ts --approve-gemini-calls
```

Run it only after you have set `GEMINI_MODEL` in `.env.local` (see A.4 option 1). It repeats the deterministic rehearsal first, then makes at most 6 requests, with no retries, payments MOCK, and an in-memory PGlite database (no Neon).

Dry run (no model call, `.env.local` not opened): `npx tsx scripts/recovery-live.ts`. Not run in this preflight.

### A.6 Tool boundary

- Model output may name only tools in `TOOL_NAMES` (`src/server/services/recoveryTools.ts:53`): read-only state tools and the recovery tools (`requestRecoveryCandidates`, `validateRecoveryPlan`, `proposeRecovery`, `commitPermittedRecovery`). The rehearsal trace shows these names.
- No payment tool is in the set. `noPaymentToolCalls` checks that the gateway was called 0 times during the run (it was, in the 2026-11-09 run).
- Gemini is called with no tools, no function calling and no search grounding (`geminiLlm.ts` header).
- The grounding filter and backend recomputation still apply to any model answer.

### A.7 Pass criteria for the retry

| Criterion | Pass |
|---|---|
| Model answered | `calls[0].responded` true, `ok` true, `servedModels` contains the requested model |
| Model used | `run.aiUsed` true, `mode: MODEL` |
| `modelOnlyAllowedTools` | PASS (model named at least one tool, all inside the tool set) |
| `noPaymentToolCalls` | PASS (0 gateway calls) |
| `requestCapEnforced` | PASS (<= 6 requests) |
| `consentRespected` | PASS |
| `invalidOrInjectedOutputFallsBack` | Still NOT TESTED after this run; it needs a separate adversarial probe |

A run where `aiUsed` is false is a fallback result and not a live model pass, even if the verdicts show PASS.

### A.8 Evidence files and redaction

- Written: `artifacts/recovery-live-<ISO timestamp>.json`. Redaction is enforced by the script: no key, no prompt, no model text, no `DATABASE_URL`. Only tool names, verdicts, digests, latencies, counts and provider error categories are written (`scripts/recovery-live.ts:6`).
- Git status of these artifacts: NOT VERIFIED (`artifacts/` ignore rules not read).
- Existing ai-smoke evidence: `artifacts/ai-smoke-gemini-2026-11-05T23-08-03-654Z.json` (certified) and `artifacts/ai-smoke-gemini-run1-2026-11-05.json` (not certified).

---

## B. PAYPAL SANDBOX

### B.1 Status

- Capture-only and void-only smoke PASSED on 2026-10-30 (`docs/EXTERNAL_INTEGRATION.md` section 1a, "DONE ... do not repeat"). Evidence: `artifacts/paypal-smoke-capture-only-smoke_1793370835421.json` (capture COMPLETED, amount 123 cents, authorization matches) and `artifacts/paypal-smoke-void-only-smoke_1793372411617.json` (authorization VOIDED). `artifacts/paypal-smoke.json` has the same content as the capture-only run (same `ranAt`). IDs in those files are already redacted (`…` plus the last 6 characters).
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
| Create order | `POST /v2/checkout/orders` | status CREATED, amount 1.23 USD, payee = expected merchant |
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
| `005_sweep_checked_at` | UNCOMMITTED (working tree only; `git diff` shows it) | `alter table reservations add column sweep_checked_at timestamptz` (nullable). Not in your list. |

Note on 005: running the app from this working tree applies 005 along with 003 and 004. Decide before migrating whether 005 is in scope. This preflight did not change the file.

### C.2 Idempotency (precise)

- The SQL uses plain `create table`, `create index`, `create function`, `create trigger` and `alter table ... add column`, all without `IF NOT EXISTS`.
- A migration therefore runs only once, because `migrate()` skips any id already present in `schema_migrations` (`src/server/db/client.ts`, around lines 34-44). Re-running the SQL by hand, or on a database that has the objects but not the `schema_migrations` row, fails with "already exists" and the whole batch rolls back.
- Partial failure: all pending migrations run in one transaction under the advisory lock `gridwindow:migrations`. A failure in 004 rolls back 003 as well, because PostgreSQL DDL is transactional. Nothing is recorded in `schema_migrations` for a failed batch. The next boot retries the whole batch.
- Concurrency: the advisory transaction lock serializes processes that start at the same time (`client.ts`, comment above `migrate`).

### C.3 Runner and recording

- `migrate(db)` in `src/server/db/client.ts`:
  1. `create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())`
  2. read applied ids
  3. for each pending id in array order: run its `sql`, then `insert into schema_migrations (id)`
- Everything runs inside one `db.tx(..., "gridwindow:migrations")`.
- Order is the array order, so 001 and 002 are applied first by the same runner when they are pending. They are not separate steps. Whether 001 and 002 are applied on Neon is UNKNOWN (see C.6).

### C.4 Is migration implicit on boot?

Yes, with the following code path (from reading the code; runtime trigger timing NOT VERIFIED beyond this):

- `src/server/runtime.ts` `openDb(env)`: if `DATABASE_URL` is set, it calls `openPostgres(env.DATABASE_URL, { migrationUrl: env.MIGRATION_DATABASE_URL })`.
- `openPostgres` (`client.ts`, around line 130): when `migrationUrl` is set, it opens a one-connection pool on the direct URL and runs `migrate()`. It then opens the pooled pool and runs `migrate()` again, which only confirms that nothing is pending.
- Without `MIGRATION_DATABASE_URL`, `migrate()` still runs once on the application connection.
- `runtime.ts` builds the runtime once (global promise), so migration happens on the first runtime use after the process starts, not in a separate command. There is no npm migrate script (`package.json` has `dev`, `build`, `start`, and the smoke and preflight scripts only).

### C.5 Risk assessment

| Risk | Detail | Assessment |
|---|---|---|
| Append-only triggers | `disruption_events` and `schedule_versions` (003), plus existing `events` and `energy_records` (001), use `gw_forbid_mutation`. Rows cannot be UPDATE or DELETE-d. | Expected behaviour. Rollback by DELETE is impossible without first dropping the trigger. |
| Immutable terms trigger | 002 adds `reservations_terms_immutable` on every UPDATE of `reservations`. It raises only when terms, amount, currency, offer or session change. | Existing rows are not affected by the migration itself. The trigger fires on every reservation update, which matters only if other code changes terms. |
| ALTER TABLE ADD COLUMN | 004 adds `not null default` columns to `recovery_runs`, and 002 adds one to `payment_operations`. On PostgreSQL 11 and later a constant default is a metadata change, but the statement still takes an ACCESS EXCLUSIVE lock briefly. | Low for small tables. The lock behaviour on the Neon version is NOT VERIFIED. |
| Check constraint on add column | 004's `attempts` check is validated against existing rows during the ALTER. | Low; defaults are 0. |
| 003 foreign keys | `schedule_versions` and `recovery_runs` reference `reservations` and `recovery_runs`. `disruption_events` references `reservations`. | Created with the tables; no existing rows are touched. |
| 005 (uncommitted) | Adds a nullable column to `reservations`. | Low risk, but it is not in the reviewed scope. |
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

### C.9 Exact command the operator would run

There is no dedicated migrate command. The operator path is to start the app with the database variables set in `.env.local`, after the backup in C.7. Commands (the values stay in `.env.local`):

```
npm run build
npm start
```

With `DATABASE_URL` (pooled) and `MIGRATION_DATABASE_URL` (direct) set, the first runtime use applies all pending ids from `migrations.ts`. Migration on boot is therefore not a separate step. Whether `npm start` alone triggers the runtime before the first request is NOT VERIFIED (it is lazy; first use triggers it). To confirm, query `schema_migrations` (C.6) after the first request.

NOT RUN in this preflight.

### C.10 Status

NOT TESTED. Reasons: no database access was used; no backup has been taken; 005 is uncommitted and needs a decision; the Neon state is unknown.

---

## Operator actions (summary)

1. Gemini: edit `GEMINI_MODEL` in `.env.local` to `gemini-3.6-flash` (or remove it), then run the command in A.5 once. Read the evidence before any repeat.
2. PayPal: nothing needed for the smoke track (PASSed 2026-10-30). Do not re-run it.
3. Neon: decide on 005; check `schema_migrations` with the read-only query in C.6; take the backup in C.7; then start the app once (C.9). Record the result in `plans/PROGRESS.md`.
