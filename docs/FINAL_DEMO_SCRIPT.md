# Final demo script (target 2:50, hard limit 2:58)

Record the **live site**, https://gridwindow-flexpay.onrender.com (open it a minute early so the free instance is awake), as a screen recording with voice-over. Upload to YouTube as **Public** or **Unlisted-but-public link** per the rules, and paste the link into Devpost. Payments are PayPal **Sandbox** (test money); charging and disturbances are **SYNTHETIC**. Say "synthetic" aloud once.

Pre-flight (off camera): sign in to the operator console in a second tab; have a PayPal Sandbox **personal (buyer)** account login ready (developer.paypal.com → Testing Tools → Sandbox Accounts); Claude Desktop (or a terminal) set up with the MCP server from `docs/MCP.md` pointed at the live URL.

| Time | Screen | Action | Voice-over |
|---|---|---|---|
| 0:00-0:12 | Home | Title, then "Plan My Charge" | "Shared charging sites cap total power. Drivers who let us move their charging overnight get a cheaper night, and they only pay for energy actually delivered." |
| 0:12-0:30 | `/drive`, "Say it" box | Type "30 kWh before 7 AM, save at least $4", press Fill form; the form fills. Request offers | "Gemini reads a plain sentence and fills the form. It never sets a price: the server prices every offer under the station's power cap." |
| 0:30-0:45 | Offers + deal agent + explanation | Show the recommended offer and its plain-language explanation | "A deal agent checks the offers against the driver's goals and explains the pick, using only verified numbers." |
| 0:45-1:05 | PayPal Sandbox checkout | Accept the exact terms, log in as the Sandbox buyer, approve; back on the reservation: "Authorized hold, not captured" | "The driver approves one exact offer in PayPal. It's an authorization hold, not a charge. Capture waits for delivered energy." |
| 1:05-1:25 | Agent over MCP | In Claude Desktop: "Book me 25 kWh tonight, ready by 7, under $20, cheapest." Show offers, the pick, and the PayPal approval link | "Any AI agent can book through our MCP server. It finds and prepares the deal, then stops at a PayPal approval link that only the human can complete. The same agent can find a compatible adapter through Channel3." |
| 1:25-1:40 | Operator console | Show KPIs, open the AG Grid data grid: sort by payment, filter "needs attention", Export CSV | "Operators see every reservation in an AG Grid data grid: sort, filter, search, export." |
| 1:40-2:10 | Bryntum schedule + disturbance | Inject "Charger power reduction" on a reservation; show the recovery proposal lane in Bryntum, then the driver's consent card, approve, schedule updates | "When a charger slows down, a durable agent run proposes fixes, a deterministic validator proves each one, and the driver consents before anything changes. Bryntum shows the new committed plan." |
| 2:10-2:30 | Simulated delivery + FlexReceipt | Run delivery; receipt shows delivered kWh and the PayPal capture; mention the void path | "Charging is simulated. Money moves only after delivered energy is recorded; if the charger fails, the hold is voided and the driver pays nothing." |
| 2:30-2:42 | Rewards → Spend your savings; API portal | Show Channel3 gear cards; switch to the APIMatic portal tab, open "Accept offer", show the samples | "Savings turn into gear from real merchants through Channel3. Developers get an APIMatic portal and SDK from the same contract our agent uses." |
| 2:42-2:50 | Closing card | Live URL, repo, "Built with PayPal, Gemini, Bryntum, AG Grid, Channel3, APIMatic, Render" | "GridWindow FlexPay: flexible charging people can trust, settled with PayPal." |

Narrative check: plain-language request → priced offers → PayPal authorization → an AI agent books the same way and stops at PayPal approval → operator view → disruption repaired with validation and consent → capture only after delivery.

If Gemini is rate-limited on the day (free tier: 20 requests per model per day), the app answers with its labelled deterministic text. Record after the daily reset, avoid repeated test runs before recording, and keep `GEMINI_FALLBACK_MODEL` set.

Never say: "PayPal certified", "real chargers", "measured savings", or that the AI moves money.
