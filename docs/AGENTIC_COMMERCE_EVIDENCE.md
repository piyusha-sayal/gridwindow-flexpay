# Agentic Commerce evidence (independent QA)

All data SYNTHETIC. Payments MOCK. Every run below names its decision source; the three sources are never mixed.

| Source label | Meaning | Evidence in this repository | Status |
|---|---|---|---|
| `REAL_GEMINI` | A live Gemini model chose the tool calls | none produced by this QA; the previous live attempt returned HTTP 504 and is not evidence of a model decision | NOT TESTED / NEEDS USER APPROVAL |
| `MOCK_GEMINI` | A scripted stand-in drives the real orchestrator, tools and validators | `tests/integration/independent-agent-evidence.test.ts`, `tests/integration/recoveryOrchestrator.test.ts`, `evidence/agent-paths.json` | PASS |
| `DETERMINISTIC_FALLBACK` | No model (or the model failed); the deterministic path decides | browser runs `evidence/recovery-trace.json`, `evidence/recovery-trace-power-cut.json` (`aiUsed: false`) and the timeout case in `agent-paths.json` | PASS |

A deterministic-fallback run is a valid, validated recovery. It is not presented as a model decision anywhere in the UI (`aiUsed` is false and the explanation source is DETERMINISTIC).

## The path, with recorded evidence

`evidence/recovery-trace.json` (browser run, early departure) records, in order:

1. Event detected: `eventId qa-evidence-evt-0001`, type `EARLY_DEPARTURE`, created by `OPERATOR` (synthetic), HTTP 201, idempotent by id.
2. Durable run started: `runId` (see file), status `NEEDS_APPROVAL`, attempts and lease stored in `recovery_runs`.
3. Tool trace (actor `DETERMINISTIC`): `orchestrator started` -> `no model configured; deterministic path` -> `requestRecoveryCandidates` (2 feasible) -> `validateRecoveryPlan c1`, `c2` -> `proposeRecovery c1` -> `requestDriverApproval`.
4. Candidate selection: c1 chosen (`flex_lowest_cost`, finish 04:45, energy cost 457 c), c2 rejected as costlier (finish 06:00, 637 c), a third rejected `DUPLICATE_SCHEDULE`. Price unchanged at the agreed 1303 c.
5. Validator and consent: both candidates validated; consent `NEEDS_DRIVER_APPROVAL` because the departure moves earlier. Nothing is committed (version stays 1) until the driver approves.
6. Approved schedule commit: the driver approves the exact proposal version; run becomes `COMMITTED`; schedule version 2 (`source RECOVERY`) is written; agreed terms and terms hash are unchanged.
7. Bryntum updates without reload and persists across reload: see `docs/BRYNTUM_EVIDENCE.md`.
8. Recovery history persisted: the run, trace, outcome and versions are returned by `GET /api/reservations/:id` and appear in the FlexReceipt "Autonomous recovery" section.

`MOCK_GEMINI` (`evidence/agent-paths.json`): a scripted model calls `requestRecoveryCandidates`, `validateRecoveryPlan`, `proposeRecovery`, `commitPermittedRecovery`, `explainRecoveryOutcome`; trace actors read `GEMINI`; consent is `AUTO_WITHIN_PRE_APPROVED_BOUNDS`; delivery is simulated and capture follows.

## Failure and abuse cases (executed)

| Case | Evidence | Result |
|---|---|---|
| Model timeout/unavailable | `agent-paths.json` fallback run; `recoveryOrchestrator.test.ts` | PASS: labelled deterministic result, same validation |
| Hallucinated candidate id, unknown tool, extra fields, payment tool ("capturePayment") | `independent-agent-evidence.test.ts` hostile case | PASS: refused, 0 payment-gateway calls, payment stays AUTHORIZED |
| Malformed tool arguments / ungrounded explanation | `recoveryTools.test.ts`, orchestrator tests | PASS |
| Prompt injection in tool output | `recoveryTools.test.ts` (fenced data block) | PASS |
| Duplicate event | `routes.test.ts`, orchestrator tests | PASS: one event, one run |
| Concurrent recovery / two workers | `recoveryOrchestrator.test.ts`, `commitFencing.test.ts` | PASS: one version written |
| Stale worker lease | `commitFencing.test.ts` | PASS: refused, writes nothing |
| Expired approval (`routes.test.ts`) and stale schedule version (`routes.test.ts`, browser spec `recoveryDriver.spec.ts`) | see files | PASS |
| Another driver tries to decide | `routes.test.ts`, `recoveryDriver.spec.ts` | PASS: 404 |
| Unauthorized financial tool access | tool allowlist has no payment tool; gateway call count asserted 0 | PASS |

## Controlled REAL_GEMINI certification procedure (do not run without approval)

Cost and risk: one recovery, at most 6 model requests, fixed budget, no retries, payments MOCK, in-memory database.
Run only by Satyam, after approving the live call.

1. Confirm the previous 504 cause is addressed (try a model id that is available to the key; `GEMINI_MODEL` in the local env file; do not commit it).
2. Dry run first (no model call): `npx tsx scripts/recovery-live.ts`. It must report at least two usable candidates.
3. Live run: `npx tsx scripts/recovery-live.ts --approve-gemini-calls`. It writes a sanitized `artifacts/recovery-live-<ISO>.json` (git-ignored; no keys, prompts or model text).
4. Pass criteria (all required): provider responses received; at least one model step names a server tool; every model tool is in the allowlist; payment-gateway calls = 0; the validator accepts the chosen candidate; the run commits or requests consent correctly.
5. Label the outcome `REAL_GEMINI` only if step 4 passes with a genuine model decision. A 504, a quota error or a deterministic completion is `DETERMINISTIC_FALLBACK` and must be reported as such.
6. Record: request count, token counts, cost computed from the provider's own pricing page at the time (not assumed), model id and date.

## Limits of this evidence
- No live model decision exists in this QA. The sentence "an AI agent recovered the schedule" is true of the orchestration and tools and of the scripted model, not of a verified Gemini decision.
- The existing Devpost text cites an earlier live Gemini certification (2026-11-05). This QA did not re-run or verify it.
