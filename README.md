# GridWindow FlexPay

**Status:** working application (hackathon sandbox demo). Verified end-to-end with a clearly labeled **MOCK** payment provider and, separately, against the genuine **PayPal Sandbox** through the app (authorize → synthetic delivery → capture, and authorize → synthetic outage → void, with signed webhooks) and a live **Gemini** model run. The sanitized evidence and its limits are in [docs/EVIDENCE.md](docs/EVIDENCE.md). Delivery, tariffs and savings are synthetic and all PayPal money is Sandbox money.

An overnight EV driver stays plugged into one port. They state the battery energy they need, when they leave, and a spending cap. A deterministic engine finds **physically feasible**, **win-win** flexible charging windows and compares them with immediate charging. A flexible offer is published only if the driver gets a discount *and* the operator's modeled contribution improves. The driver approves one immutable offer, and PayPal Sandbox **authorizes** that exact amount. A transparent **synthetic** simulator then delivers (or fails to deliver) the energy. The app **captures once** after verified delivery, or **voids** on failure. **FlexReceipt** joins the approved terms, the synthetic delivery records and the payment states read back from the provider.

> Tariffs, fees, building load and charging are synthetic assumptions. Nothing here is a measured saving or a real-world grid benefit. A PayPal authorization is not escrow (3-day honor period, up to 29-day lifetime).

## What is real and what is simulated

| Item | Status |
|---|---|
| Charging, energy delivery, building load, tariffs, fees, forecast | **Synthetic.** A transparent simulator; no vehicle is charged and no real-world energy, grid or cost-saving benefit is claimed. |
| "Savings" and operator contribution | **Modeled** from the synthetic assumptions shown with every offer. Not measured. |
| Payments in MOCK mode (default) | **Simulated** by a labeled in-app provider ("MOCK … not PayPal"). No network call. |
| Payments in Sandbox mode | **Genuine PayPal Sandbox** API calls (Orders v2, Payments v2) with Sandbox money only. Verified live by the team: see [docs/EVIDENCE.md](docs/EVIDENCE.md). Judges reproduce it only with their own Sandbox credentials. |
| AI assistant | Optional. **Genuine Gemini** when a key is set (verified live, see EVIDENCE.md); otherwise a labeled deterministic fallback. It never touches money. |

## Quick start (mock provider, no credentials needed)

**Judges:** see [docs/JUDGES.md](docs/JUDGES.md) for a single-command MOCK demonstration (no `.env` file and no credentials), a walkthrough, and which features need sandbox credentials.

Requires Node ≥ 22. `npm ci` needs network access, and `npm run build` downloads the Geist fonts from Google Fonts once.

```bash
npm install
cp .env.example .env.local        # PAYMENT_MODE=mock by default; set SESSION_SECRET (32+ chars) and OPERATOR_PASSPHRASE (12+ chars, or the operator console stays disabled)
npm run dev                       # http://localhost:3000
```

- Driver flow: `/drive` → offers → consent → mock approval page (labeled *not PayPal*) → `/reservations/<id>` → run synthetic night → FlexReceipt.
- Operator console: `/operator` (passphrase from `OPERATOR_PASSPHRASE`). Shows the site load plan against the 33 kW cap, port occupancy vs. electrical draw, outage injection and reconciliation.
- Benchmark: `npm run benchmark` writes `artifacts/benchmark/`, which `/benchmark` displays.
- AI assistant (optional): set `GEMINI_API_KEY` (default model `gemini-3.6-flash`, override with `GEMINI_MODEL`) or `ANTHROPIC_API_KEY` (model via `AI_MODEL`); `AI_PROVIDER=gemini|anthropic` chooses explicitly. The model only fills form fields, explains backend-computed offers and answers questions about a reservation; it has no tools and never sets a price, consent, authorization, capture or void, and every number it shows is checked against backend facts. Without a key, or on any provider failure, a deterministic parser/explainer runs and is labeled as such.
- Demo tools (development only): set `DEMO_TOOLS=true` in MOCK mode to get "Seed background drivers" and "Reset demo data" in the operator console.

Data is stored in embedded PostgreSQL (PGlite) under `.data/pglite`. Set `DATABASE_URL` to use a PostgreSQL server instead (same migrations).

## PayPal Sandbox mode

1. In the PayPal Developer Dashboard, create a **sandbox** REST app and a **sandbox personal (buyer)** account.
2. In `.env.local` set `PAYMENT_MODE=paypal_sandbox`, `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_EXPECTED_MERCHANT_ID` (the sandbox business account ID; the app refuses to authorize an order whose payee differs) and `APP_BASE_URL`. Never commit or share these values.
3. Run `npm run paypal:smoke` to see the plan (no network), then `npm run paypal:smoke -- --approve-sandbox-orders`. It does one authorize→capture and one authorize→void, USD 1.23 each, against `api-m.sandbox.paypal.com`. You approve each order on PayPal's sandbox page. Nothing is retried. Redacted evidence goes to `artifacts/paypal-smoke.json`. The full runbook (UI path, AI smoke, webhooks) is in [docs/EXTERNAL_INTEGRATION.md](docs/EXTERNAL_INTEGRATION.md).
4. Optional webhooks: expose the app over HTTPS (`APP_BASE_URL` must be that public `https://` origin and `TRUST_PROXY=true` behind a tunnel or proxy), register `https://<host>/api/webhooks/paypal` in the sandbox app with the seven events listed in [docs/PAYPAL_CERTIFICATION.md](docs/PAYPAL_CERTIFICATION.md), then set `PAYPAL_WEBHOOK_ID`. `npm run payment:preflight -- --night-a <date> --night-b <date>` is a read-only check that exits non-zero until the endpoint, webhook ID and proxy settings are valid.

Startup refuses any `PAYPAL_ENV` other than `sandbox`. The API host is hard-coded to the sandbox.

## Environment variables

| Variable | Purpose |
|---|---|
| `PAYMENT_MODE` | `mock` (default) or `paypal_sandbox` |
| `PAYPAL_ENV` | must be `sandbox`; anything else stops startup |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox REST app credentials (backend only) |
| `PAYPAL_EXPECTED_MERCHANT_ID` | required in Sandbox mode; payee that every order must name |
| `PAYPAL_WEBHOOK_ID` | ID of the registered Sandbox webhook; without it every webhook is rejected |
| `APP_BASE_URL` | public origin of this app (used for return URLs, cookie `Secure`, origin checks) |
| `TRUST_PROXY` | `true` only behind a trusted proxy or tunnel (rate limiting uses the last `X-Forwarded-For` hop) |
| `SESSION_SECRET`, `OPERATOR_PASSPHRASE` | cookie signing (32+ chars) and operator sign-in (12+ chars) |
| `DATABASE_URL`, `MIGRATION_DATABASE_URL` | optional PostgreSQL server (and optional direct URL for migrations); otherwise embedded PGlite in `GW_DATA_DIR` |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_PROVIDER` | optional AI wording (see above) |
| `DEMO_TOOLS` | `true` enables seed/reset in the operator console, MOCK mode with no `DATABASE_URL` only |
| `GW_ISOLATED_DB` | set by the test runners; refuses to start if hosted services are configured |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `npm` crashes on an old global version | Use Node ≥ 22 with its bundled npm (`npm -v` ≥ 10). |
| `npm run build` fails while fetching fonts | The build downloads the Geist fonts from Google Fonts once; it needs network access. |
| Operator page says the console is not configured | `OPERATOR_PASSPHRASE` is missing or shorter than 12 characters. |
| API returns `SERVER_MISCONFIGURED` (503) | A required variable is missing or invalid; the server log names the problem (for example a missing `PAYPAL_EXPECTED_MERCHANT_ID` in Sandbox mode). Secrets are never printed. |
| `Port 3000 is already in use` | Start with `npm start -- -p 3200` and set `APP_BASE_URL` to the same origin. |
| Start over with a clean database | Stop the server and delete `.data/` (MOCK mode), or use "Reset demo data…" in the operator console with `DEMO_TOOLS=true`. |
| Sandbox checkout cannot return to the app | `APP_BASE_URL` must be the exact origin you browse (cookies are per origin). |
| Webhooks never arrive | The registered URL must end in `/api/webhooks/paypal`, `PAYPAL_WEBHOOK_ID` must match that webhook, and `TRUST_PROXY=true` behind a tunnel. `npm run payment:preflight` checks the local half read-only. |
| Tests refuse to start | Test runs set `GW_ISOLATED_DB=true` and refuse hosted databases, model keys and non-mock payments by design. |

## Tests

| Command | What it covers |
|---|---|
| `npm run typecheck` | strict TypeScript |
| `npm run lint` | ESLint (Next core-web-vitals + TS) |
| `npm test` | Vitest: physics, economics, payment state machine, env guard, PayPal REST client (fake transport), benchmark determinism, and full lifecycle integration on PGlite with adversarial cases |
| `npm run test:e2e` | Playwright against the production build in MOCK mode: demo scenarios A/B/C, economic rejection, pending/declined settlement, offer expiry, validation, persistence, operator outage → void, demo seed, axe accessibility, API security checks; screenshots for desktop/tablet/mobile in `artifacts/screenshots/` |
| `npm run benchmark` | ≥ 500 seeded scenarios × 4 policies with an independent validator |

## Architecture

- `src/domain/`: pure, deterministic logic. Integer units (cents, W, Wh, mWh). Allocator, independent validator, economics, quotes and terms hash, simulator, payment state machine, benchmark.
- `src/payments/`: the `PaymentGateway` contract, `PayPalSandboxGateway` (Orders v2 / Payments v2 REST) and `MockGateway`.
- `src/server/`: DB client and migrations, repositories, services (quote, checkout, settlement, reconcile, webhook, views), env guard, HTTP security helpers.
- `src/app/`: Next.js App Router pages and API routes.

Key safety properties:

- The server recomputes every amount from the stored offer.
- Compare-and-set state transitions.
- A unique settlement index makes capture-after-void impossible.
- `PayPal-Request-Id` idempotency.
- Reconciliation from provider truth.
- Webhook verification against the raw body.
- Append-only event and energy tables.

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Piyusha Sayal and Satyam Pandey. Third-party package licenses are summarized in [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md); Geist fonts (SIL Open Font License) are loaded from Google Fonts at build time and no third-party images or datasets are included.
