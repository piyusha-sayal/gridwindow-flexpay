# Live certification handoff (Gemini and PayPal Sandbox)

Nothing in this document has been executed. No Gemini request, PayPal order, checkout, webhook registration or buyer approval was made by the QA workstream. Each section needs the owner's separate approval. Only provider-verified outcomes count as evidence.

---

## Part 1. Gemini recovery tool-use (REAL_GEMINI)

### What the previous attempt proved
Source: `docs/EXTERNAL_PREFLIGHT.md` A.1 (the sanitized artifact `artifacts/recovery-live-2026-11-09T19-13-09-066Z.json` is git-ignored and is not in this clone, so it was not re-read).

| Field | Value |
|---|---|
| Model used | `gemini-3.8-flash` |
| Provider response | none: HTTP 504, `DEADLINE_EXCEEDED` after 18.8 s, 0 tokens |
| Run outcome | `COMMITTED` by the deterministic path, `aiUsed: false`, mode FALLBACK |
| `modelOnlyAllowedTools` | BLOCKED (the model named no tool) |

This is not a live model decision and must never be described as one. The deterministic fallback worked as designed.

### Configured model and the intended retry
- The local `.env` in this working copy sets `GEMINI_MODEL=gemini-3.8-flash`, the same model that returned the 504. The only recorded successful live model is `gemini-3.6-flash` (the earlier ai-smoke certification, on request parsing, offer explanation and Q&A, not on recovery tools); that evidence file is also git-ignored and was not re-read here.
- Intended retry: one run with `GEMINI_MODEL=gemini-3.6-flash`. `scripts/recovery-live.ts` prefers a value from `.env.local` over the shell, so change or remove it there, or ensure the shell value is the only one. The script does not read `.env` (the file that currently holds the 3.8 setting), so the shell variable is the reliable control: set it in the same shell session and confirm the printed model name before approving.

### Exact commands (run by the owner)
```
# 1. dry run: deterministic rehearsal, no model call, no key read
npx tsx scripts/recovery-live.ts
# 2. live run, only after approving one paid model session
$env:GEMINI_MODEL="gemini-3.6-flash"; $env:GEMINI_API_KEY="<your key>"
npx tsx scripts/recovery-live.ts --approve-gemini-calls
```
Do not run the second command from a shell where `DATABASE_URL` is set; the script uses its own in-memory database and mock payments, and the key must not be pasted into any file or chat.

### Limits and safety (from the code, `docs/EXTERNAL_PREFLIGHT.md` A.2, A.6)
| Control | Value |
|---|---|
| Requests | at most 6, no retries |
| Budget | $0.25 at a conservative planning price (not a billing figure) |
| Client timeout | 20 s per request (hard-coded); recovery loop budget 45 s; at most 8 tool steps; at most 3 attempts |
| Output cap | 512 tokens per step plus headroom |
| Thinking | LOW |
| Database and payments | in-memory PGlite; MOCK gateway; no Neon, no PayPal |
| Allowed tools | `requestRecoveryCandidates`, `validateRecoveryPlan`, `proposeRecovery`, `commitPermittedRecovery`, `requestDriverApproval`, `explainRecoveryOutcome` and read-only state tools; no payment tool exists; Gemini is called with no function calling or search grounding |

### Expected successful trace
Trace actors read `GEMINI` for model steps: `requestRecoveryCandidates` -> `validateRecoveryPlan <id>` -> `proposeRecovery <id>` -> either `commitPermittedRecovery` (inside pre-approved bounds) or `requestDriverApproval` -> `explainRecoveryOutcome`; the explanation source is `MODEL` only if the grounding filter accepted it. The mock equivalent is in `docs/evidence/agent-paths.json`.

### Pass criteria (all required, from A.7)
Model answered and `servedModels` contains the requested model; `run.aiUsed` is true and mode is MODEL; `modelOnlyAllowedTools` PASS; `noPaymentToolCalls` PASS (0 gateway calls); `requestCapEnforced` PASS; `consentRespected` PASS. `invalidOrInjectedOutputFallsBack` remains NOT TESTED live (needs a separate adversarial probe; covered offline by the mock tests). A run with `aiUsed: false` is a fallback result, whatever the verdicts say.

### Timeout behavior to expect
A 504 or timeout produces `UNAVAILABLE` or `TIMEOUT`, the run completes on the deterministic path, and the label is DETERMINISTIC_FALLBACK. Do not retry in a loop. After one failure, stop and read the sanitized artifact.

### Evidence capture format
Keep `artifacts/recovery-live-<ISO>.json` (sanitized: tool names, verdicts, digests, latencies, token counts, provider error categories; no key, prompt, model text or database URL). Record: model id, date, request count, tokens, cost from the provider's own pricing page, verdict table. Copy a redacted summary into `docs/AGENTIC_COMMERCE_EVIDENCE.md` and change the REAL_GEMINI row only if every pass criterion holds.

---

## Part 2. PayPal Sandbox capture and void

Source runbook: `docs/PAYPAL_CERTIFICATION.md` (still current), plus the corrections below. Nothing here creates an order.

### Prerequisites checklist
- [ ] Sandbox only: `PAYMENT_MODE=paypal_sandbox`, `PAYPAL_ENV=sandbox` (any other value stops startup; the only PayPal host in code is `api-m.sandbox.paypal.com`), Sandbox client id and secret, `PAYPAL_EXPECTED_MERCHANT_ID` = the Sandbox business account id (checked on the approved order)
- [ ] A Sandbox Personal buyer account; the buyer approval is done by the owner in PayPal's window. It is never automated
- [ ] **New since QA-1:** the database the app uses must already hold migrations 003 to 005, or the app refuses to start. (The existing Neon database was found at 001-005 by a read-only inspection on 2026-11-10, so it needs no migration.) For any other database, use a branch, never the main branch: `npm run db:migrate -- --confirm-target=<host/db> --expect-latest=005_sweep_checked_at` (dry run, read the pending list), then add `--apply`
- [ ] HTTPS tunnel; `APP_BASE_URL` set to it; `TRUST_PROXY=true`; one Sandbox webhook registered with the seven events listed in `docs/PAYPAL_CERTIFICATION.md` section 3; `PAYPAL_WEBHOOK_ID` set
- [ ] `npm run build` and `npm start` (not `npm run dev`); no `DEMO_TOOLS`
- [ ] `npm run payment:preflight -- --night-a <future night> --night-b <future night>` prints READY (prices in the older runbook, $12.43, are examples; re-run, since quotes depend on the night)

### Transaction A: authorization then capture
1. `/drive` on the tunnel URL only (the session cookie is per origin). Port A, 19:00 to 07:00, 30 kWh, spend cap $20. Tick consent, approve. The owner signs in as the Sandbox buyer and approves.
2. Reservation shows "Authorized, not captured" (authorization handling: capacity is committed only after provider-confirmed authorization).
3. Operator console: run the delivery. One capture.
4. Evidence: `npm run paypal:order -- <ORDER_ID>` shows the capture COMPLETED with the accepted amount and currency; reservation has one CAPTURE operation and no VOID; `WEBHOOK_VERIFIED` events for approved, authorization created and capture completed, each processed once (replaying one returns DUPLICATE); FlexReceipt shows provider-confirmed capture and delivered energy.

### Transaction B: authorization then void
1. Same flow on Port B. After authorization, operator console **Inject outage**.
2. Expect 0 kWh delivered, one void, no capture, $0 collected.
3. Evidence: provider read-back authorization VOIDED; verified `PAYMENT.AUTHORIZATION.VOIDED` webhook; FlexReceipt shows no charge and the void reason.

### Idempotency and reconciliation evidence to collect
Operation rows (`payment_operations`: one per kind per reservation, idempotency key recorded, status SUCCEEDED); no second provider call after a page refresh or a webhook replay; if a provider timeout occurs, the reservation moves to reconciliation and the read-back decides (local tests: `paymentSafety.test.ts`, `reconciliationSweep.test.ts`).

### Stop conditions
Amount or currency mismatch; payee mismatch; more than one provider operation for one reservation; any CAPTURED or VOIDED label without a provider read-back; a webhook that is verified but does not correlate.

### Teardown
Delete the webhook in the PayPal dashboard, stop the tunnel, clear `PAYPAL_WEBHOOK_ID`, restore `APP_BASE_URL`, unset `TRUST_PROXY`, and delete the Neon branch if it was created for this. Redact order and capture ids before sharing.

### Claim rule
Write "PayPal Sandbox capture and void verified" only after both provider read-backs exist for this build. Until then: "MOCK provider and signed-webhook logic verified locally; Sandbox certification pending."
