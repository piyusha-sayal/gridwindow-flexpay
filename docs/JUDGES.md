# Running GridWindow FlexPay as a judge

The fastest path needs **no credentials and no network services**. It runs the full app against a built-in **MOCK payment provider** and an embedded database. Every MOCK screen says so ("MOCK PAYMENT PROVIDER: this is not PayPal", "MOCK: simulated payment, not PayPal"). Nothing in MOCK mode contacts PayPal or any AI provider.

## 1. MOCK demonstration (recommended, ~5 minutes)

Requirements: Node.js ≥ 22 and git. No `.env` file is needed. All settings are passed on the command line, and the values below are throwaway local placeholders, not secrets.

```bash
git clone <repository-url> gridwindow && cd gridwindow
npm ci                 # installs the exact versions in package-lock.json
npm run build
PAYMENT_MODE=mock PAYPAL_ENV=sandbox DEMO_TOOLS=true \
APP_BASE_URL=http://localhost:3000 \
SESSION_SECRET=local-demo-session-secret-change-me-0123456789 \
OPERATOR_PASSPHRASE=local-demo-operator \
npm start              # http://localhost:3000
```

On Windows PowerShell, set the variables first and then start:

```powershell
$env:PAYMENT_MODE="mock"; $env:PAYPAL_ENV="sandbox"; $env:DEMO_TOOLS="true"
$env:APP_BASE_URL="http://localhost:3000"
$env:SESSION_SECRET="local-demo-session-secret-change-me-0123456789"
$env:OPERATOR_PASSPHRASE="local-demo-operator"
npm start
```

The database is created and migrated automatically on first start (embedded PGlite in `.data/`). Data survives restarts. To start from scratch, delete `.data/` or use **Reset demo data…** in the operator console.

### Suggested walkthrough

1. Open `/operator` and sign in with the passphrase you set.
2. Press **Seed background drivers** to add two reservations on ports B and C through the real checkout flow.
3. Open `/drive` and choose **Port A**. Ports B and C are now occupied, so the app correctly refuses flexible offers there.
4. Press **See offers**. Compare immediate charging with the flexible offers, read the assumptions, tick consent and approve on the MOCK checkout page.
5. On the reservation page, press **Run the synthetic overnight charge**. A FlexReceipt appears after the MOCK capture is confirmed.
6. Back in `/operator`, press **Inject outage** on a seeded reservation. The authorization is voided, not captured.
7. Use **Deliver · capture pending**, then **Provider completes capture**, to see a non-final payment state. These controls are MOCK-only.
8. On `/drive`, request 120 kWh on Port C between 05:00 and 07:00 to see an infeasible request explained.
9. Open `/benchmark` for the 500-scenario synthetic comparison.

Notes:
- The AI assistant shows **"Deterministic fallback (no AI)"** unless a Gemini or Anthropic key is configured. That is expected.
- `OPERATOR_PASSPHRASE` must be at least 12 characters, or the operator console is disabled. `npm run build` downloads fonts, so it needs network access.
- Date and time fields follow your operating system's format: day/month or month/day, 12-hour or 24-hour.

## 2. What needs credentials

| Capability | Needs | Status in the submitted build |
|---|---|---|
| Driver and operator journeys, settlement logic, benchmark | Nothing | Verified in MOCK mode with automated tests |
| Real PayPal Sandbox checkout (create → buyer approval → authorize → capture/void) | Your own PayPal **sandbox** REST app (client ID, secret, merchant ID) and a sandbox buyer account | Verified live by the team on 2026-11-06/07 (capture and void, see [EVIDENCE.md](EVIDENCE.md)); judges reproduce it with their own credentials |
| PayPal webhooks | A public HTTPS URL registered in the sandbox app, plus `PAYPAL_WEBHOOK_ID` | Verified live for four event types (see [EVIDENCE.md](EVIDENCE.md)); the registration used for that run was temporary |
| AI wording (Gemini or Claude) | `GEMINI_API_KEY` (free tier available) or `ANTHROPIC_API_KEY` | Gemini verified live (4 of 4 cases); optional, and without a key the labeled deterministic fallback is used |

The build refuses to run against live PayPal: any `PAYPAL_ENV` other than `sandbox` stops it at startup.

## 3. Optional: PayPal Sandbox with your own credentials

Put credentials only in a local, git-ignored `.env.local`, never on the command line of a shared machine or in screenshots. Set `PAYMENT_MODE=paypal_sandbox`, `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_EXPECTED_MERCHANT_ID` and `APP_BASE_URL`. Demo tools are disabled in this mode by design. See README → "PayPal Sandbox mode" and [EXTERNAL_INTEGRATION.md](EXTERNAL_INTEGRATION.md).

## 4. Checks you can run

```bash
npm run typecheck && npm run lint && npm test   # unit + integration (embedded database)
npx playwright install chromium && npm run test:e2e
npm run benchmark                               # regenerates artifacts/benchmark/requests.csv (deterministic)
```

`npm run test:e2e` builds nothing itself; run `npm run build` first.
