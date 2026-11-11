# Demo script (about three minutes, live site)

We record the hosted app at https://gridwindow-flexpay.onrender.com. Payments there are PayPal Sandbox, so it is test money. Charging, site load and disturbances are simulated, and the app labels them SYNTHETIC. Say "synthetic" out loud at least once.

## Before recording

- Open the site a minute early. It runs on Render's free plan and sleeps when idle, so the first page can take up to a minute.
- Sign in to the operator console in a second tab (`/operator`, passphrase from the Devpost testing instructions).
- Have a PayPal Sandbox personal (buyer) login ready. You can create one at developer.paypal.com under Testing Tools, Sandbox Accounts.
- Optional: an MCP client (Claude Desktop, Cursor) set up as in [MCP.md](MCP.md), with `GRIDWINDOW_URL` set to the live URL.
- Don't rehearse the AI steps many times on the day. Gemini runs on the free tier (20 requests per model per day). When the quota runs out, the app answers with deterministic text instead. The flow keeps working; the wording is just plainer.

## Timeline

| Time | Screen | What to do | What to say |
|---|---|---|---|
| 0:00-0:12 | Home | Drag the ready-by slider, then press **Plan My Charge** | "A shared charging site has a hard power cap. Most drivers only care that the car is ready in the morning. We move their charging into cheaper windows, and they pay only for energy that was delivered." |
| 0:12-0:30 | Smart Charge (`/drive`) | Type "Find me 30 kWh before 7 AM and save at least $4", press **Fill form**, then **See offers** | "Gemini turns the sentence into form fields. It never sets a price. The server prices every offer under the station's power cap." |
| 0:30-0:45 | Offers | Show the recommended offer and its explanation | "The deal agent checks the offers against the driver's goal and explains its pick using numbers the server already verified." |
| 0:45-1:05 | Terms, then PayPal Sandbox | **Review and approve**, tick consent, press **Approve $X with PayPal Sandbox**, log in as the Sandbox buyer, approve. Back on the reservation it reads "Authorized, not captured" | "The driver approves one exact offer in PayPal. That's an authorization hold. Nothing is captured until energy is delivered." |
| 1:05-1:25 | MCP client (optional) | Ask: "Book me 25 kWh tonight, ready by 7, under $20, cheapest." Show the offers, the pick and the PayPal approval link | "An AI agent can book through our MCP server. It finds and prepares the deal, then stops at a PayPal link only the human can approve." If you skip this, give the time to the recovery step. |
| 1:25-1:40 | Operator console | Load tonight's night. In the AG Grid table, sort by payment, tick **Needs attention only**, press **Export CSV** | "Operators see every reservation in one grid. Each row says whether it is PayPal Sandbox or MOCK." |
| 1:40-2:10 | Recovery engine, then **Schedule view** | On your reservation, inject a **Charger power reduction** with **Inject SYNTHETIC disturbance**. Open it under **Recorded disturbances** and read the seven steps. Press **Schedule view** and toggle **Original plan** / **Current (recovered)** | "A charger slows down. The recovery run proposes fixes, a deterministic validator checks each one, and if the terms change, the driver has to approve first. The Bryntum timeline shows the plan that was actually stored." |
| 2:10-2:30 | Reservation page | If the run asks for approval, press **Approve change**. Then **Run the synthetic overnight charge** and open the FlexReceipt | "Delivery is simulated. The capture happens only after the delivered energy is recorded, and PayPal confirms it. If the operator's charger fails, the hold is voided instead." |
| 2:30-2:42 | Rewards, then the developer portal | Show the **Spend your savings** gear cards, then the APIMatic portal's **Accept offer** page | "Channel3 finds real EV gear from real merchants. Developers get an API portal and a typed SDK generated from the same contract the agent uses." |
| 2:42-2:50 | Closing card | Live URL, repository, the tools used | "GridWindow FlexPay: flexible charging that settles honestly with PayPal." |

## Saying it accurately

| On screen | What it means |
|---|---|
| PayPal Sandbox (test money) | A real PayPal Sandbox call. Real API, test funds. |
| MOCK provider (simulated, not PayPal) | The built-in mock provider, used locally and in automated tests. The live database also keeps four old test rows made with it, and each one is labeled MOCK. |
| SIMULATED_EVENT, SYNTHETIC | The operator injected the disturbance. It is not a real charger fault. |
| MODEL_DECISION | A live model chose among the validated candidates. Say "the AI chose" only when the run shows this. |
| DETERMINISTIC_FALLBACK | The deterministic path decided, either with no model or after a model error. |
| Financial outcome: Waiting | The money is only held (AUTHORIZED) or still settling. |
| Financial outcome: Done | PayPal confirmed the capture or the void. |

The recovery result depends on the run: it may commit on its own, ask the driver to approve, or report that no fix fits. Don't promise one before you see it.

Avoid saying "PayPal certified", "real chargers", "measured savings", or anything suggesting the AI moves money.

## If you need a backup

- **Recovery that needs approval, or a void:** the live night 2026-11-12 already has both, recorded with PayPal Sandbox. One recovery was approved by the driver and later captured. The other found no feasible fix, was attributed to the operator, and was voided. Open them in the operator console under **Recorded disturbances**.
- **No internet or a sleeping site:** run the app locally in MOCK mode, as described in [JUDGES.md](JUDGES.md#4-run-it-locally). Say "mock provider" instead of "PayPal Sandbox" at the payment step.
