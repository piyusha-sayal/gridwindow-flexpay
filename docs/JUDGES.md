# Judge guide

GridWindow FlexPay is running at **https://gridwindow-flexpay.onrender.com**. You don't need to build anything to judge it. Start with the hosted app, and only come back to the local setup if you want to read or test the code.

| Link | What it is |
|---|---|
| [Live app](https://gridwindow-flexpay.onrender.com) | The product, connected to PayPal Sandbox |
| [Developer portal](https://gridwindow-flexpay-developers.onrender.com) | API reference and TypeScript SDK, generated with APIMatic |
| [Demo script](DEMO_SCRIPT.md) | The three-minute route we use in the video |
| Demo video | Linked from our Devpost submission |

Three things to know first:

- The app runs on Render's free plan and sleeps when nobody uses it. The first page can take up to a minute to load. After that it's quick.
- Payments on the live site go through **PayPal Sandbox**, so it's real PayPal APIs with test money. Charging, building load, tariffs and disturbances are simulated, and the app labels them SYNTHETIC.
- The AI features use Gemini's free tier. If the daily quota runs out, the app switches to deterministic text and keeps working. The API response records which one answered.

## 1. What you can try without any access (about 10 minutes)

1. **Home.** Drag the ready-by slider. The price updates from the synthetic tariff.
2. **Smart Charge** (`/drive`). Type "Find me 30 kWh before 7 AM and save at least $4", press **Fill form**, then **See offers**. You'll see offers the server priced and validated under the site's power cap, a deal agent recommendation, and a plain-language explanation. The AI never sets a price, and every number in its answers is checked against the server's figures before you see it.
3. **Review and approve.** Open the exact terms (merchant, amount, charging window, expiry) and press **Approve $X with PayPal Sandbox**. You'll land on PayPal's Sandbox login. Without a Sandbox buyer account you can stop there. Nothing is authorized until a buyer approves.
4. **Rewards & Payments.** The **Spend your savings** cards are live product results from Channel3.
5. **Impact Lab.** The synthetic benchmark: 500 seeded nights and 1,500 charging requests, compared across four scheduling policies.
6. **How it works.** A short walkthrough and FAQ.
7. **Developer portal.** Browse the API reference and the SDK guide. Everything there comes from the same OpenAPI contract the app and the MCP server use ([docs/openapi.yaml](openapi.yaml)).

## 2. What needs the Devpost testing instructions

Two things are protected, and we put the details in the private testing instructions on Devpost rather than in this public repository.

**A PayPal Sandbox buyer login** lets you finish a checkout. You can also create your own at developer.paypal.com (Testing Tools, Sandbox Accounts). With it:

1. Approve the payment on PayPal. You come back to your reservation, which says "Authorized, not captured".
2. Press **Run the synthetic overnight charge**. Once PayPal confirms the capture, the FlexReceipt appears, showing the agreed terms, the delivered energy and the payment result.

**The operator passphrase** opens `/operator`. These nights already hold real Sandbox records:

| Night | What's there |
|---|---|
| 2026-11-10 | 11 reservations in the AG Grid table, 10 PayPal Sandbox and 1 MOCK, each labeled. One is the Sandbox capture ending `…H62XfQtp`. Try sorting by payment, **Needs attention only**, and **Export CSV**. |
| 2026-11-12 | The Sandbox void ending `…C2afKCrn`, plus two Sandbox reservations that went through a recorded disturbance. Under **Recorded disturbances** you can open each one and read the seven recovery steps from the stored run. One recovery was approved by the driver, wrote schedule version 2, and the payment was captured. The other found no feasible fix, the operator was recorded as responsible, and the authorization was voided. |
| 2026-11-14 | A recovery that committed on its own, within the limits the driver had already agreed to. Its payment is still an authorization, so the financial step shows Waiting. |

Press **Schedule view** to see the same night on the Bryntum timeline. Switch between **Original plan** and **Current (recovered)**, and use the **Night of** picker above the timeline to move between nights. You can also record your own disturbance in the **Recovery engine** panel on a reservation you booked. Please use your own booking rather than the ones above.

## 3. Real PayPal Sandbox evidence vs MOCK tests

We keep these apart on purpose. Every reservation in the app names its provider, either "PayPal Sandbox (test money)" or "MOCK provider (simulated, not PayPal)". Every payment proof records where it came from, `PAYPAL_SANDBOX_API` or `MOCK_PROVIDER`.

| Evidence | Where to see it | Provider |
|---|---|---|
| Sandbox capture `…H62XfQtp` and void `…C2afKCrn`, USD 15.56 each, read back from the PayPal API after the 2026-11-11 deploy, with signature-verified webhooks | Live operator console (nights above), [release verification](FINAL_RELEASE_VERIFICATION_2026-11-11.md) | PayPal Sandbox |
| Recovery followed by settlement on 2026-11-11: a driver-approved recovery and then a capture (`…n-qKqgUM`), and an operator-attributed disturbance with no feasible fix and then a void (`…kfgzxjBp`) | Live, night 2026-11-12; [evidence](EVIDENCE.md#recovery-followed-by-paypal-sandbox-settlement-2026-11-11) | PayPal Sandbox |
| Earlier Sandbox capture (Nov 6, 30.015 kWh delivered) and void (Nov 7, 0 kWh delivered), with four verified webhook types | [evidence](EVIDENCE.md) | PayPal Sandbox |
| Automated tests: 1,023 Vitest and 131 Playwright passes, no failures | Run locally, see below | MOCK provider and a throwaway database. No PayPal or model calls. |
| Recovery scenario tests and the browser certification screenshots | `tests/`, [docs/evidence/certification](evidence/certification) | MOCK |
| Release screenshots, each labeled LIVE or LOCAL-MOCK | [screenshot index](evidence/final-release-2026-11-11/SCREENSHOT_INDEX.md) | Both, labeled |

## 4. Run it locally

You need Node.js 22 or newer and git. No accounts or keys. This mode uses the built-in MOCK provider and an embedded database, and nothing contacts PayPal or an AI provider.

```bash
git clone https://github.com/piyusha-sayal/gridwindow-flexpay.git
cd gridwindow-flexpay
npm ci
npm run build
PAYMENT_MODE=mock PAYPAL_ENV=sandbox DEMO_TOOLS=true \
APP_BASE_URL=http://localhost:3000 \
SESSION_SECRET=local-demo-session-secret-change-me-0123456789 \
OPERATOR_PASSPHRASE=local-demo-operator \
npm start
```

On Windows PowerShell, set the variables first:

```powershell
$env:PAYMENT_MODE="mock"; $env:PAYPAL_ENV="sandbox"; $env:DEMO_TOOLS="true"
$env:APP_BASE_URL="http://localhost:3000"
$env:SESSION_SECRET="local-demo-session-secret-change-me-0123456789"
$env:OPERATOR_PASSPHRASE="local-demo-operator"
npm start
```

These values are local placeholders, not secrets. The build downloads fonts once, so it needs network access. Then:

1. Sign in at `http://localhost:3000/operator` with `local-demo-operator` and press **Seed background drivers**.
2. Book a charge on `/drive`. The mock checkout page stands in for PayPal and says so.
3. On the reservation, press **Run the synthetic overnight charge** to get a FlexReceipt.
4. In the operator console, press **Inject outage** on a seeded reservation to see a void, or use the **Recovery engine** panel to record a disturbance.

To start over, use **Reset demo data** in the operator console or delete the `.data/` folder.

To use your own PayPal Sandbox credentials instead, see [EXTERNAL_INTEGRATION.md](EXTERNAL_INTEGRATION.md). The app refuses to start with any `PAYPAL_ENV` other than `sandbox`.

## 5. Checks you can run

```bash
npm run typecheck && npm run lint && npm test
npx playwright install chromium && npm run test:e2e   # needs npm run build first
npm run benchmark
```

On the submitted code, Vitest passes 1,023 tests with 12 skipped. The skipped ones need a disposable PostgreSQL server, see [SKIPPED_TESTS.md](SKIPPED_TESTS.md). Playwright passes 114 on desktop, 14 on mobile and 3 on tablet, with 6 keyboard-only journeys that run on desktop only. GitHub Actions runs typecheck, lint, the unit tests, the build and a secret scan on every pull request.

## 6. Known limits

- Charging, site load, tariffs, forecasts and disturbances are simulated. Savings are modeled, not measured.
- Gemini drove recovery tool steps live, but a live model making the final recovery decision hasn't been recorded. In those runs the provider returned a capacity error and the labeled deterministic path finished the job. See [AGENTIC_COMMERCE_EVIDENCE.md](AGENTIC_COMMERCE_EVIDENCE.md).
- The Bryntum timeline's own markup has accessibility findings from axe. The table under the chart is the accessible view. In browsers set to a half-hour time zone, the axis ticks follow the browser's hours. See [BRYNTUM_NOTES.md](BRYNTUM_NOTES.md).
- The settlement sweep runs in the background every five minutes. There's no button for it.
- Operator sign-in is a shared passphrase for the demo, not production identity management.
