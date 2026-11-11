# PayPal Sandbox certification through the real app (owner runbook)

Status: **prepared, nothing executed.** No order, quote row, tunnel or webhook has been created. The standalone smoke results (capture PASS and void PASS, 2026-10-30) stay as historical evidence and are not repeated.

Words: PASS / FAIL / BLOCKED / NOT TESTED / NEEDS APPROVAL. Everything below that touches PayPal is NEEDS APPROVAL.

## 0. Historical smoke evidence: read-only audit (2026-11-09)

Source: `E:\GridWindow\artifacts` (the original checkout, git-ignored; not part of this worktree). Nothing was sent to PayPal for this audit.

| File | Mode | Run start (`startedAt`) | Run end (`ranAt`) |
|---|---|---|---|
| `paypal-smoke-capture-only-smoke_1793370835421.progress.json` and `.json` | capture-only | 2026-10-30T14:33:55.418Z | 2026-10-30T14:34:27.549Z |
| `paypal-smoke-void-only-smoke_1793372411617.progress.json` and `.json` | void-only | 2026-10-30T15:00:11.617Z | 2026-10-30T15:00:31.817Z |
| `paypal-smoke.json`, `paypal-smoke-progress.json` | capture-only | same as the capture pair | same as the capture pair |

- `paypal-smoke.json` and `paypal-smoke-progress.json` are byte-identical to the capture-only pair (`cmp`). Their names do not follow the script's `paypal-smoke-<mode>-<runId>` scheme, so how they were produced is not shown by the files.
- Host and environment (all files): `environment` = `sandbox`, `apiBase` = `https://api-m.sandbox.paypal.com`.
- Amounts (all files): order, authorization and, for the capture run, capture all show 123 cents, USD. This is USD 1.23.
- Two separate orders, one per run. Neither run's reference (`smoke_<ms>_<flow>`) names an application reservation.

Provider status progression, from the `.progress.json` steps (`at` is the time the response was recorded):

| Step | Capture run | Void run |
|---|---|---|
| Order created | status `PAYER_ACTION_REQUIRED` at 14:33:56.650Z | status `PAYER_ACTION_REQUIRED` at 15:00:12.789Z |
| Buyer approval | not a recorded step. The evidence file shows order status `APPROVED` before authorize. The approval time is not recorded. | same as capture |
| Authorization | `CREATED` at 14:34:25.028Z; `expiresAt` 2026-11-28T14:34:24Z | `CREATED` at 15:00:30.607Z; `expiresAt` 2026-11-28T15:00:30Z |
| Capture or void | capture `COMPLETED` at 14:34:27.196Z (evidence: `authorizationMatches` true) | authorization `VOIDED` at 15:00:31.816Z (read back with GET after the void) |

- The operations lists in the evidence files match the script's order: create order, poll order, authorize, then capture and read the capture (capture run) or void and read the authorization (void run).
- Order status `CREATED` is not what the artifacts record. The B.7 table in `docs/EXTERNAL_PREFLIGHT.md` has been corrected to match.

Request IDs: no artifact records a `PayPal-Request-Id`. The script derives IDs as `<ref>:CREATE_ORDER`, `:AUTHORIZE`, `:CAPTURE`, `:VOID` (`scripts/paypalSmokeFlow.ts`), and the header is set only when an ID is passed (`src/payments/paypalSandbox.ts:155`). The header values actually sent are NOT VERIFIED by these files.

Redaction: provider order, authorization and capture IDs, and the payee merchant ID, appear as `…` plus the last 6 characters. The key names in all files are: `ranAt`, `startedAt`, `environment`, `apiBase`, `clientFingerprint`, `mode`, `evidence`, `steps`, and per-step fields `flow`, `kind`, `id`, `status`, `at`, `order`, `authorization`, `capture`, `void`, `operations`, `reservationRef`. No token, client secret, client ID, approval URL or access token field appears. `clientFingerprint` is a 12-character fingerprint; it is not the client ID.

What the artifacts prove: sandbox host; USD 1.23 orders; a fully approved order before authorize (status `APPROVED` recorded); authorization `CREATED`, capture `COMPLETED` (capture run); authorization `VOIDED` after a void (void run). Each capture or void was read back from PayPal.

What they do NOT prove: who approved the order or that a human did (the script says approval is manual, but no approval identity is recorded); PayPal webhook delivery for either run; any reconciliation; any link to a GridWindow reservation or the recovery engine; any PENDING or DECLINED capture; the `PayPal-Request-Id` values sent.

Recovery linkage: none. These are the 2026-10-30 standalone smoke runs. No new sandbox evidence linked to the recovery work exists. The sandbox order in section 1 below (USD 12.43) has not been executed.

### 0a. Standalone smoke runs of 2026-11-10 (owner-run; validated from redacted artifacts, no order created by the agent)

| Flow | Artifact | Checks | Result |
|---|---|---|---|
| Capture | `paypal-smoke-capture-only-smoke_1794310608818.json` | sandbox host; order `APPROVED`, 123 USD; authorization `CREATED`, 123 USD; capture `COMPLETED`, 123 USD, `authorizationMatches` true; `requestIds` for createOrder, authorize, capture | PASS (provider-confirmed COMPLETED, USD 1.23) |
| Void | `paypal-smoke-void-only-smoke_1794310747785.json` | sandbox host; order `APPROVED`, 123 USD; authorization `CREATED`, 123 USD; `void.authorizationStatusAfter` `VOIDED`; `requestIds` for createOrder, authorize, void | PASS (artifact-validated; the owner also reported success) |

These runs record `requestIds`, which the 2026-10-30 runs lack. Still not shown: webhook delivery, reconciliation, any link to a GridWindow reservation or the recovery engine. Recovery-linked Sandbox evidence stays NOT TESTED. The agent read only the redacted files and did not query PayPal.

## 1. Proposed transactions (computed from the real backend quote)

Produced by `npm run payment:preflight -- --night-a 2026-11-12 --night-b 2026-11-15` (read-only; Neon opened in a READ ONLY transaction; no quote row, no PayPal call). Both nights have no reservation in Neon, so the price is not shifted by other sessions.

| | A: successful charging | B: charging outage |
|---|---|---|
| Night / port | 2026-11-12, Port A | 2026-11-15, Port B |
| Request | plug in 19:00, leave 07:00, 30 kWh to battery, spend cap $20.00 | same |
| Offer chosen | Lowest-cost window, charges 00:00-03:00 | same |
| Immediate list price | $16.80 | $16.80 |
| **Order amount = maximum Sandbox authorization** | **$12.43 USD (1243 cents)** | **$12.43 USD (1243 cents)** |
| Driver discount (modeled, synthetic tariff) | $4.37 | $4.37 |
| Merchant | the sandbox business account in `PAYPAL_EXPECTED_MERCHANT_ID`; the order is not authorized unless PayPal names it as payee | same |
| Quote validity | 10 minutes from the moment offers are shown | same |
| Approve on PayPal before | Nov 13, 2026 12:00 AM PT (first charging slot) | Nov 16, 2026 12:00 AM PT |
| Expected PayPal transitions | order CREATED, then APPROVED (buyer), authorization CREATED, capture COMPLETED | order CREATED, then APPROVED, authorization CREATED, authorization VOIDED |
| Expected app states | AUTHORIZED, then CAPTURED (after synthetic DELIVERED) | AUTHORIZED, then VOIDED (after operator outage, run FAILED) |
| Money that can move | capture of exactly $12.43 (sandbox funds) | none: void, no capture |

Worst case for the whole certification: two authorizations of $12.43 each, $24.86 of sandbox funds, of which at most $12.43 is captured. The server recomputes the amount from the stored offer; the model supplies no amount. Rerun the preflight on the day: the figures can only change if another session occupies the same night or the quote engine changes.

Caveats: the order is created only after the driver ticks consent and presses approve, so a wrong quote can be rejected before anything exists. The nights are in the future relative to the run, but the delivery is a synthetic simulation executed immediately; no EV is charged.

## 2. Exact steps for the combined run (2 orders, covers app lifecycle AND webhooks)

Doing the webhook certification in the same two orders avoids creating extra Sandbox transactions.

1. Approve this runbook (section 7).
2. Open a tunnel to `http://localhost:3000` (section 4). Note the HTTPS URL `H`.
3. In `.env.local` set `APP_BASE_URL=H` and `TRUST_PROXY=true`. Leave `PAYMENT_MODE=paypal_sandbox`, `PAYPAL_ENV=sandbox`. Do not set `DEMO_TOOLS`.
4. `npm run build` then `npm start` (never `npm run dev` through a tunnel).
5. PayPal developer dashboard, Sandbox REST app, Webhooks, **Add webhook**: URL `H/api/webhooks/paypal`; event types exactly the seven in section 3. Copy the **Webhook ID** into `PAYPAL_WEBHOOK_ID`; restart `npm start`.
6. Re-run `npm run payment:preflight -- --night-a 2026-11-12 --night-b 2026-11-15`: every row is PASS and it prints READY with exit code 0. Any FAIL row (public HTTPS `APP_BASE_URL`, `PAYPAL_WEBHOOK_ID`, `TRUST_PROXY=true`) makes it print NOT READY and exit 1; do not create orders until it is READY.
7. Browser on `H` only (the session cookie is per origin; start and finish on the tunnel URL). Scenario A: `/drive`, Port A, night 2026-11-12, plug-in 19:00, ready by 07:00, 30 kWh, spend cap $20.00. Confirm the offer shows $12.43, tick consent, approve, sign in on PayPal Sandbox as the **Personal buyer** account, approve. The reservation should read "Authorized, not captured". Press "Run the synthetic overnight charge": FlexReceipt says capture confirmed by provider.
8. Scenario B: Port B, night 2026-11-15, same request. After authorization, sign in at `H/operator`, open the reservation, **Inject outage**. The driver page should say the authorization was voided and no payment was collected.
9. Evidence to keep: reservation IDs, the operator detail panel (events, `WEBHOOK_VERIFIED` rows, provider proofs), `npm run paypal:order -- <ORDER_ID>` for each order (read-only provider read-back), the preflight artifact. Redact IDs before sharing: keep at most a short, non-identifying fragment.
10. Teardown: delete the webhook in the dashboard, stop the tunnel, clear `PAYPAL_WEBHOOK_ID`, restore `APP_BASE_URL`, unset `TRUST_PROXY`.

## 3. Webhook subscriptions required by this implementation

The handler ignores `event_type` for decisions: any verified event whose `resource.id` or `supplementary_data.related_ids` matches a stored order, authorization or capture ID triggers a provider read-back (`recoverReservation`). Financial state always comes from the PayPal API, never from the payload. Subscribe to:

| Event | Why |
|---|---|
| `CHECKOUT.ORDER.APPROVED` | buyer approved; lets the app authorize without the browser return |
| `PAYMENT.AUTHORIZATION.CREATED` | authorization exists |
| `PAYMENT.AUTHORIZATION.VOIDED` | void confirmed |
| `PAYMENT.CAPTURE.COMPLETED` | capture final |
| `PAYMENT.CAPTURE.PENDING` | non-final capture |
| `PAYMENT.CAPTURE.DENIED` | capture failed |
| `PAYMENT.CAPTURE.DECLINED` | capture declined |

Check the exact spelling against the dashboard list. Do not subscribe to refund, dispute or subscription events: they are not handled.

## 4. Recommended HTTPS setup

Webhooks and the buyer return both need a stable public HTTPS origin, and the whole app is reachable through it.

- **Preferred: ngrok with a free static domain** (one account, stable URL, so `APP_BASE_URL`, the registered webhook and cookies never change during the run): `ngrok http --url=<your-static-domain> 3000` (older ngrok versions call the flag `--domain`; check `ngrok http --help`).
- **Alternative, no account: Cloudflare quick tunnel** `cloudflared tunnel --url http://localhost:3000`. The URL changes every start, so keep the process running for the whole certification; restarting it forces a new `APP_BASE_URL` and a new webhook.
- Never use a production domain or a shared host for this; use it for one session and stop it.
- `TRUST_PROXY=true` makes the rate limiter key on the last `X-Forwarded-For` hop. Whether each tunnel appends the client address as the last hop was not verified. Because of that, operator login also has a global cap of 30 attempts per minute across all callers (`rateLimitGlobal`), so forged or rotated `X-Forwarded-For` values cannot make brute force unbounded. If the tunnel does not append, all callers share one per-client bucket and a stranger could lock the owner out of the 5-per-minute login for a minute at a time; keep the tunnel URL private and short-lived.
- `X-Forwarded-Proto` and `X-Forwarded-Host` are never read: the cookie `Secure` flag and the allowed origin come only from `APP_BASE_URL`, and a unit test fails if source code starts reading those headers. State-changing routes need `Origin` equal to `APP_BASE_URL` (or the request's own origin) and a same-origin `Sec-Fetch-Site`; the session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` under an `https://` `APP_BASE_URL`.
- A durable judge-facing deployment is a separate decision (infrastructure spend); this runbook is for the certification session only.

## 5. What was checked in the webhook path (static review plus existing tests)

| Property | Result | Where |
|---|---|---|
| Raw body preserved | PASS: route reads `req.text()` once and passes those bytes to verification; the verify request embeds the bytes verbatim | `src/app/api/webhooks/paypal/route.ts`, `PayPalSandboxGateway.verifyWebhook`; `tests/unit/payments.test.ts` "verifies webhooks by sending the raw body verbatim and fails closed" |
| Authentic signature | PASS: PayPal `verify-webhook-signature` with the five transmission headers and the configured webhook ID; fail closed on missing ID, header, bad JSON or error | same |
| Correct webhook ID | PASS by design: `PAYPAL_WEBHOOK_ID` only; unset means every delivery is rejected. NOT TESTED live | `runtime.ts` |
| Correlation | PASS: resource ID and related IDs matched to order, authorization or capture ID; uncorrelated events are acknowledged and recorded, never acted on | `webhookService.ts` |
| Durable dedupe | PASS: primary key on `event_id`; an event is a duplicate only after `processed_at` is set; an unprocessed redelivery is reprocessed | `webhookService.ts`; lifecycle "de-duplicates replayed events", "#3" |
| Out-of-order / stale | PASS: state comes from the provider read-back, transitions are compare-and-set, final states never downgrade | lifecycle "stale events…", "out-of-order authorization webhook…" |
| Invalid / duplicate / forged | PASS: 413 over 64 KiB, 400 bad shape, 401 unverified with no database write, 200 DUPLICATE | lifecycle "rejects unverified webhooks…", "#5" |
| Reconciliation after errors | PASS: provider unreachable gives 503 (PayPal redelivers) with the inbox row left unprocessed; a database error gives 500; the restart sweep also re-drives stuck reservations | lifecycle "#3", recovery "lookup timeout…" |
| Note | If PayPal's verification API itself is down, the delivery is answered 401 (not 503); PayPal retries non-2xx deliveries, so nothing is lost, but it is logged as rejected | `verifyWebhook` catch |

## 6. Environment and data safety (checked by `npm run payment:preflight`, values never printed)

PASS today: sandbox-only guard, `PAYMENT_MODE=paypal_sandbox`, `PAYPAL_ENV=sandbox`, PayPal client credentials and a well-formed `PAYPAL_EXPECTED_MERCHANT_ID`, `SESSION_SECRET` 32+ characters, `OPERATOR_PASSPHRASE` 12+ characters, `DATABASE_URL` set, demo tools closed, test-isolation variable unset. Mandatory live-certification rows (`src/server/liveCertification.ts`, each FAIL exits 1): `APP_BASE_URL` must be an `https://` origin with a public DNS name (no localhost, IP, `.local`, credentials, path or query); `PAYPAL_WEBHOOK_ID` must be set and look like a PayPal webhook ID; `TRUST_PROXY` must be exactly `true`. Order creation uses `intent=AUTHORIZE` (unit test `payments.test.ts`), and the payee is compared with `PAYPAL_EXPECTED_MERCHANT_ID` before authorization (lifecycle tests). Mock approval, demo reset/seed and mock capture routes answer 404/409 outside MOCK mode; fault injection and the operator console need the operator cookie.

- Live money: the only PayPal host in the code is `api-m.sandbox.paypal.com`; any other `PAYPAL_ENV` stops startup.
- Exposed test or admin surfaces: demo reset and seed need `DEMO_TOOLS=true` AND mock mode AND no `DATABASE_URL`, so they are closed in this setup; `/api/mock-provider/approve` returns 404 outside mock mode; `/api/operator/*` needs the operator cookie, and the operator login is rate limited. The operator console is publicly reachable through the tunnel and protected only by the passphrase.
- Neon: the run adds two new reservations and their quotes, proofs and events. The 27 existing MOCK records are not read or changed by the app for these nights. Nothing is deleted or reset.
- The merchant check added during this preflight (tracker G23) is exercised for the first time against live Sandbox in this run. If PayPal omits the payee on the approved order, the app stops before authorizing (NEEDS_RECONCILIATION) and the order remains unauthorized. Evidence from the 2026-10-30 void smoke says the payee is reported.

## 7. Owner approvals needed

1. Create exactly two Sandbox orders: A $12.43 on 2026-11-12 (Port A) and B $12.43 on 2026-11-15 (Port B), the Personal buyer account, no live money.
2. Open a temporary HTTPS tunnel and register one Sandbox webhook with the seven events above, then tear both down.
3. Set `APP_BASE_URL`, `TRUST_PROXY` and `PAYPAL_WEBHOOK_ID` in `.env.local` yourself (the agent does not read or write that file).
4. Either run steps 7-8 yourself or authorize the agent to drive the app (approval clicks on PayPal remain yours).

## 8. Planned smoke re-run (NOT EXECUTED; needs separate approval)

This is a different, non-recovery run from sections 1-2. It uses the standalone smoke script, not the app.

- Two orders, USD 1.23 each (`SMOKE_AMOUNT_CENTS` = 123): one authorize then capture, one authorize then void. Command: `npm run paypal:smoke -- --approve-sandbox-orders`. Single-path runs: `--capture-only` or `--void-only`, one order each.
- Sandbox host only (`https://api-m.sandbox.paypal.com`). The run stops on any other host.
- Manual buyer approval at PayPal's sandbox checkout for each order. The script prints the link and never approves or logs in.
- `PayPal-Request-Id` fixed per write (`<ref>:CREATE_ORDER`, `:AUTHORIZE`, `:CAPTURE`, `:VOID`). No retries. A failed run is not re-run blindly.
- Resume: `--resume-order <ORDER_ID>` finishes one existing smoke order without creating another. It refuses orders the script did not create and orders that already have an authorization.
- Redacted artifacts only: `artifacts/paypal-smoke-<mode>-<runId>.progress.json` after each response, and `.json` on pass. Both are created with `wx` and never overwritten.
- Reconciliation: each capture or void is re-read from PayPal (`GET` capture or authorization). Webhook delivery is not part of this run and is not checked by it.
- Not to be executed without a separate, explicit approval from the owner.

## Note, 2026-11-10

The QA-closure changes did not modify payment, checkout, settlement, webhook or PayPal client code (`src/payments`, `src/app/api` and the checkout and settlement services are unchanged). No PayPal Sandbox call was made for this closure, so the PayPal evidence in this file was not re-run and still describes its original dates. Configuration loading now treats empty or whitespace-only values as absent.
