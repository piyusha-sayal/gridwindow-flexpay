# PayPal Sandbox certification through the real app (owner runbook)

Status: **prepared, nothing executed.** No order, quote row, tunnel or webhook has been created. The standalone smoke results (capture PASS and void PASS, 2026-10-30) stay as historical evidence and are not repeated.

Words: PASS / FAIL / BLOCKED / NOT TESTED / NEEDS APPROVAL. Everything below that touches PayPal is NEEDS APPROVAL.

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
