# PayPal + AI evidence (independent QA)

Scope of this document: what was independently re-verified locally (MOCK provider, in-memory database), and the exact procedure for the provider-backed evidence that only the owner may run. No PayPal order, checkout, buyer approval or webhook was created or sent by this QA.

## Independently verified locally

| Property | Evidence | Result |
|---|---|---|
| Accepted offer integrity: the amount is recomputed from the stored offer, terms are immutable after acceptance (DB trigger) | `independent-security.test.ts` (price update rejected), `paymentSafety.test.ts`, `termsHashStability.test.ts` | PASS |
| Authorization semantics: capacity is committed only after provider-confirmed authorization; late authorization is voided | `paymentSafety.test.ts` | PASS |
| Capture/void state machine: no capture after void, no exit from terminal states, capture requires delivery | `payments.test.ts`, `independent-security.test.ts` (0 provider capture calls after void or before delivery) | PASS |
| No duplicate financial operation: repeated and concurrent settle = exactly 1 provider capture, 1 CAPTURE operation, 0 VOID | `independent-security.test.ts` | PASS |
| Webhook integrity: unverified = 401 and no write; oversized = 413; verified duplicate processed once; a hostile "capture completed" event cannot create CAPTURED | `independent-security.test.ts` | PASS |
| Provider reconciliation after timeout / ambiguous result | `reconciliationSweep.test.ts`, `paymentSafety.test.ts` | PASS |
| No AI payment tool: the recovery tool allowlist has none; a model asking for one is refused and the gateway is not called | `recoveryTools.test.ts`, `independent-agent-evidence.test.ts` | PASS |
| Actual-energy settlement: capture or void follows the delivered-energy ledger, not the forecast | `recoveryShortfall.test.ts` | PASS |
| Fault attribution: only an operator-injected outage voids automatically; any other shortfall is escalated to the operator with a stored deadline and moves no money; agreements from before the policy keep the earlier rule | `settlementPolicy.test.ts`, `outdatedSettlement.test.ts` | PASS |
| Recovery never raises the price | benchmark: price unchanged in every applied recovery; `routes` and terms-hash tests | PASS |
| FlexReceipt accuracy: receipt amount, delivered energy and payment state match the reservation view; MOCK is labelled | screenshot `evidence/14-flexreceipt.png` (MOCK payment, SYNTHETIC charging badges; $13.03 paid, 30.02 kWh) | PASS |

Not verified by this QA (documented by earlier work, no independent evidence): live PayPal Sandbox capture and void, live signed webhooks, live Gemini output. Status: NOT TESTED here; NEEDS USER APPROVAL to certify.

## Findings relevant to this track

- QA-4 (Low, copy accuracy): the reservation page labels a run whose consent was given by the driver as "Recovered automatically" (`src/components/recoveryCopy.ts`, `COMMITTED: "Recovered automatically"`) while the same card says "so it needs your approval. Nothing changes until you approve it." After approval the sentence is stale and the label misdescribes the consent method. The FlexReceipt detail does record "Approved by you". Recommended: label by consent method (auto within pre-approved bounds vs approved by driver) and use past tense after approval. Visible in `evidence/14-flexreceipt.png`.
- QA-1 relevance: the app now refuses to start against an external database that lacks migrations 003-005. The existing Neon database already holds 001-005 (read-only inspection, 2026-11-10); for any other database run `npm run db:migrate` (dry run, then `--apply`) on a branch first.

## Controlled sandbox certification (owner only; NEEDS USER APPROVAL)

Goal: one provider-verified capture and one provider-verified void, with real Sandbox money only. Only provider read-backs count as evidence.

Prerequisites
1. A Neon branch (not the production branch) migrated deliberately: `npm run db:migrate -- --confirm-target=<host/db> --expect-latest=005_sweep_checked_at` (dry run), then add `--apply` after reading the pending list.
2. Sandbox merchant and a Sandbox personal buyer account. `PAYMENT_MODE=paypal_sandbox`, `PAYPAL_ENV=sandbox`, `PAYPAL_EXPECTED_MERCHANT_ID` set. No `DEMO_TOOLS`.
3. HTTPS tunnel, `APP_BASE_URL` set to it, `TRUST_PROXY=true`, a registered webhook with `PAYPAL_WEBHOOK_ID` (event list in `docs/PAYPAL_CERTIFICATION.md` section 3). Use `npm run build && npm start`, never `npm run dev`.
4. `npm run payment:preflight -- --night-a <future night> --night-b <future night>` prints READY.

Transaction A: authorization -> capture
1. Driver wizard on the tunnel URL: Port A, 30 kWh, spend cap $20, accept the flexible offer, tick consent, approve in the PayPal Sandbox window with the buyer account (manual; never automated).
2. Confirm the reservation shows "Authorized, not captured".
3. Operator console: run the synthetic delivery. Expect one capture.
4. Evidence: `npm run paypal:order -- <ORDER_ID>` (read-only provider read-back) shows capture COMPLETED and amount equal to the accepted amount; `WEBHOOK_VERIFIED` events for approved, authorized, capture completed; FlexReceipt shows provider-confirmed capture.

Transaction B: authorization -> void
1. Same flow on Port B. After authorization, operator console: Inject outage.
2. Expect delivery 0 kWh, one void, no capture, $0 collected.
3. Evidence: provider read-back authorization status VOIDED; verified `PAYMENT.AUTHORIZATION.VOIDED` webhook; receipt shows no charge.

Stop conditions: any amount mismatch, any second provider operation for one reservation, any CAPTURED label without a provider read-back. Teardown: delete the webhook, stop the tunnel, clear `PAYPAL_WEBHOOK_ID`, restore `APP_BASE_URL`, unset `TRUST_PROXY`. Redact IDs before sharing.

Claim rule: write "PayPal Sandbox capture/void verified" in the submission only after both read-backs exist. Until then the honest statement is "MOCK provider and signed-webhook logic verified locally; Sandbox certification pending".
