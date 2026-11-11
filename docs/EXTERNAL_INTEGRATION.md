# External integration runbook (owner only)

Each step below talks to an external service. Run a step only after deciding to approve that category: **PayPal Sandbox orders**, **model API spending (Gemini or Anthropic)**, or **public webhook endpoint**. Never paste credentials into chat, screenshots or commits. `.env.local` is git-ignored.

## 0. Configure `.env.local` (no external calls)

Create `.env.local` in the repo root yourself, in an editor, and fill in your own values:

```
PAYMENT_MODE=paypal_sandbox
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=<sandbox REST app client id>
PAYPAL_CLIENT_SECRET=<sandbox REST app secret>
APP_BASE_URL=http://localhost:3000
SESSION_SECRET=<32+ random characters>
OPERATOR_PASSPHRASE=<your choice>
PAYPAL_EXPECTED_MERCHANT_ID=<Account ID of the sandbox business account that owns the REST app>
# optional
PAYPAL_WEBHOOK_ID=<only after step 3>
ANTHROPIC_API_KEY=<only for step 2>
AI_MODEL=claude-opus-5-5
```

Sandbox credentials come from developer.paypal.com → Apps & Credentials → **Sandbox** → your REST app. The buyer is a **personal sandbox account** from Sandbox → Accounts. The app refuses any `PAYPAL_ENV` other than `sandbox`.

Then check the build locally (no external calls):

```bash
npm run build && npm run release:scan   # browser assets + .env.example; prints names only
```

Expected output (exit code 0):
- `PASS .next/static: <n> files, ...`
- `PASS .env.example: placeholders only (...)`

Any `FAIL` line names a file and a variable, never a value. Any `INCOMPLETE` line names an artifact that could not be read. Both produce exit code 1. Report the line, not the value.

## 0b. Hosted PostgreSQL (Neon) settings

Add to `.env.local` (never paste the values anywhere):

```
SESSION_SECRET=<32+ random characters, generated once and kept; the app refuses to start without it>
DATABASE_URL=<Neon pooled URL, host contains -pooler>?sslmode=verify-full&channel_binding=require
MIGRATION_DATABASE_URL=<Neon direct URL, same without -pooler>   # optional, used only for schema migrations
```

- `sslmode=verify-full` validates the certificate chain and host name. pg 8 already treats `require` as `verify-full`, but a later major version will not, so write it explicitly. Keep `channel_binding=require`.
- Runtime traffic uses the pooled URL. When `MIGRATION_DATABASE_URL` is set, pending migrations are applied through that direct connection first (one connection, same advisory lock), and the pooled pool then only confirms nothing is pending. Migrations stay in `src/server/db/migrations.ts`, append-only; never edit an applied one.
- Every connection attempt is bounded at 15 s (`PG_CONNECT_TIMEOUT_MS`). A suspended or unreachable database gives HTTP 500 after at most 15 s, and the next request retries.
- Do not point `TEST_DATABASE_URL` at this database: the real-PostgreSQL suite creates schemas and truncates tables, and it needs `options=-c search_path`, which a transaction pooler rejects. Use a throwaway local server or a disposable Neon branch.

## 1. PayPal Sandbox certification (approval: "PayPal Sandbox orders")

### 1a. Standalone smoke test: USD 1.23 per order (DONE: capture PASS and void PASS; do not repeat)

```bash
npm run paypal:smoke                                                   # dry run: prints the plan, no network
npm run paypal:smoke -- --approve-sandbox-orders --capture-only        # 1 order: authorize + capture
npm run paypal:smoke -- --approve-sandbox-orders --void-only           # 1 order: authorize + void
```

- Without a flag the run makes 2 orders: one captured, one voided. `--capture-only` / `--void-only` make exactly one.
- The script prints each PayPal approval link; you sign in as the **sandbox buyer** and approve it.
- Every write is sent once and never retried. Any mismatch (merchant, amount, currency or status) stops the run.
- The run refuses to start without `PAYPAL_EXPECTED_MERCHANT_ID`.
- PayPal documents no call that names the merchant behind the credentials before an order exists. So the payee PayPal reports on order A is checked first, before you are shown any link. A wrong-merchant order is never approved and never authorized.
- Approval links must be `https://www.sandbox.paypal.com/...`; anything else stops the run.
- Evidence is written per run to `artifacts/paypal-smoke-<mode>-<runId>.json` (plus a `.progress.json`), with IDs redacted and never overwritten. Both are git-ignored.
- Do not re-run after a failure without reading the output first: a re-run creates new orders.

### 1b. Through the app UI

Run `npm start` with the `.env.local` above.

**Success path:**
1. On `/drive`, request offers and approve the exact terms.
2. Approve on PayPal's sandbox page. The reservation should show "Authorized, not captured".
3. Press **Run the synthetic overnight charge**. The FlexReceipt should say "capture confirmed by provider" and show the PayPal Sandbox label.

Approve on PayPal before the offer's first charging slot starts. A buyer return after that is refused with "Scheduled charging has already started" and no authorization is made (`APPROVAL_AFTER_DEADLINE` event). Use a night in the future for this test.

**Failure path:** use a second reservation, authorize it, then in `/operator` press **Inject outage**. The driver page should say "Authorization voided. No payment was collected".

Record the reservation IDs and the operator detail panel evidence. Do not screenshot `.env.local`.

## 2a. Gemini (free tier) smoke (approval: "external model requests")

Config in `.env.local` (values never pasted anywhere): `GEMINI_API_KEY`, optional `GEMINI_MODEL` (default `gemini-3.6-flash`), optional `AI_PROVIDER=gemini|anthropic`. Without `AI_PROVIDER`, Gemini is used when only its key is set; with both keys set, Gemini wins. The chosen provider never silently falls back to the other one; with no usable key the labeled deterministic fallback runs.

- Model ID source: Google's models and pricing pages list `gemini-3.6-flash` (stable) and `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite` (stable) as free of charge on the Gemini Developer API free tier (read 2026-11-05). `gemini-2.5-flash` is deprecated. The ID was **not** confirmed with a live call.
- `AI_PROVIDER=gemini AI_SMOKE_BUDGET_USD=0.50 npm run ai:smoke -- --approve-paid-calls` runs the same 5 synthetic cases (max 8 requests). Gemini is priced at $0 in the meter, so the cap that binds is the request count. A key with billing enabled can be charged.
- Result of the first live run (2026-11-05, 5 requests, not certified): the structured-output schemas were accepted (4 of 5 calls returned schema-valid JSON), one call failed as UNAVAILABLE, and three model answers were rejected by the grounding check. The causes were fixed before the certified run described in `docs/EVIDENCE.md`.
- The run now has a metadata-only preflight (`models.get`, no tokens) that stops before any generation if the key's project cannot see the model. It cannot show the billing tier or remaining quota: check the tier in AI Studio (API keys / Usage and billing) and the per-model limits at https://aistudio.google.com/rate-limit. A model with no free quota shows up as HTTP 429 `QUOTA_EXHAUSTED` on the first generation call.
- Certification: the command exits non-zero unless every mandatory case (parse, explain, own-reservation Q&A, injection) is a genuine model answer that passed validation. A deterministic fallback, even a safe one, is reported separately (`FALLBACK`) and does not certify. Each run writes its own `artifacts/ai-smoke-<provider>-<time>.json` (git-ignored) with request/response counts, sanitized provider error categories, HTTP status and, for rejected answers on the synthetic fixtures, the rejected text and the grounding issue.
- Still unverified: the meaning of `retryOptions.attempts: 1`, whether the response carries a provider request ID (none is read today), and your key's free-tier rate limits.
- The model has no tools, no function calling and no search grounding; the backend still computes every amount and the grounding filter still checks every number.

## 2. AI smoke (approval: "model API spending"; provider from `AI_PROVIDER` or whichever key is set, Gemini first)

```bash
npm run ai:smoke                                                   # dry run, no calls
AI_SMOKE_BUDGET_USD=0.50 npm run ai:smoke -- --approve-paid-calls  # at most 8 requests
```

- The run makes 5 calls on synthetic data: request parsing, offer explanation, own-reservation Q&A, and 2 prompt-injection probes.
- Defaults:
  - total cap $0.50 (`AI_SMOKE_BUDGET_USD`, maximum $5)
  - per request: at most 12,000 input characters, `max_tokens` of 2,048 or less (this includes thinking), and a worst case of $0.10 or less
  - no SDK retries
- Before each call, the remaining budget is checked against the worst-case estimate. These are estimates; actual usage is reported afterwards. The projected worst case for 5 calls on `claude-opus-5-5` is about $0.15.
- Results go to `artifacts/ai-smoke.json`: tokens, cost computed from reported usage, latency and per-case pass/fail. No prompts or keys are written.
- The app enables Anthropic's server-side model fallback. `servedModels` in the output lists the models that actually answered. Each call is priced at the served model's rate, and an unlisted model is priced at the highest known rate. The pre-call check uses the requested model's rate, so one fallback call can exceed its estimate by at most the price difference.
- Cases 1-3 pass only when `source` is `MODEL`: a `DETERMINISTIC_FALLBACK` answer never counts as a real model response. Case 4 (injection) checks that the injected price or capture claim never reaches the customer, whichever source answered. Case 5 records that the fault cases run offline only.

## 3. Real webhooks (approval: "public webhook endpoint")

A webhook needs a public HTTPS URL that reaches your machine, such as a tunnel you choose. The tunnel exposes the whole app, including every route besides the webhook. While it is up:
- Run in sandbox mode only (demo reset tools are disabled automatically).
- Use a strong `OPERATOR_PASSPHRASE`.
- Stop the tunnel right after testing.

Setup:
1. In the sandbox REST app, add a webhook to `https://<your-tunnel-host>/api/webhooks/paypal`. Subscribe only to the order, authorization and capture events: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`. Check the names in the dashboard list.
2. Put the webhook ID in `PAYPAL_WEBHOOK_ID` and set `APP_BASE_URL` to the tunnel URL. Restart.
3. Repeat 1b once. Each genuine delivery shows up as a `WEBHOOK_VERIFIED` event in the operator detail panel and a `webhook_inbox` row (event ID, type and SHA-256 of the raw body).

How it behaves:
- An unverified event changes nothing and gets 401.
- A redelivery gets `DUPLICATE`.
- If PayPal's API is unreachable during processing, the app answers 503 so PayPal retries.
- The simulator in the developer dashboard is useful for checking reachability, but its events are not tied to real transactions. They do not count as certification.

Cleanup: delete the webhook in the sandbox app, stop the tunnel, remove `PAYPAL_WEBHOOK_ID` and reset `APP_BASE_URL`. While the endpoint is down, PayPal retries deliveries for a period. The app still reconciles from PayPal's API on the buyer return, through operator **Reconcile** and on its startup recovery sweep, so webhooks are an accelerator, not a dependency.
