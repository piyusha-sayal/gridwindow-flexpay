# Final demo script (target 2:45, hard limit 2:55)

Format: screen recording of the running app with voice-over. MOCK payments, SYNTHETIC charging. No real charger, no real PayPal, no model claim unless a REAL_GEMINI run has been certified.

Pre-flight (off camera): `docs/DEMO_RUNBOOK.md`. Browser time zone set to Pacific (see QA-3).

| Time | Screen | Action | Voice-over |
|---|---|---|---|
| 0:00-0:12 | Home | Title card, then Smart Charge | "Charging sites cap total power. Drivers who agree to flexible charging get a cheaper night, but only if the promise survives when something goes wrong." |
| 0:12-0:35 | `/drive` wizard, offers | Port B, 19:00 to 07:00, 30 kWh, $20. See offers. Show the flexible offer and its assumptions | "The engine only shows an offer when the driver saves money and the operator still earns. Prices are synthetic assumptions." |
| 0:35-0:50 | Consent and mock payment | Tick consent, approve. "Authorized, not captured." | "The driver approves one exact offer. The payment is only a hold. Nothing is collected yet. This demo uses a mock provider, not PayPal." |
| 0:50-1:05 | Operator schedule (Bryntum) | Show the original plan on Port B | "This is the operator's schedule in Bryntum, drawn from the database." |
| 1:05-1:20 | Operator console, synthetic disturbance | Record "Charger power reduction, 4.8 kW from 22:00" (or early departure) | "Now a charger slows down. This is a synthetic event the operator injects; no real charger is connected." |
| 1:20-1:45 | Bryntum, then run trace | Board shows the hatched proposal lane without reload. Open the run trace | "An agent run starts automatically and is stored durably. It asks the server for candidates and validates each one. In this recording no model key is configured, so the labelled deterministic path decides; a model can only pick among options the server has already validated." |
| 1:45-2:05 | Reservation page, consent card | Driver reads the change and presses Approve | "The change moves the finish time, so the driver must consent. Nothing changes until they do. The price stays exactly the same." |
| 2:05-2:20 | Bryntum | Schedule updates to version 2; reload and it is still there | "The validated schedule appears in Bryntum and survives a reload, because it was committed to the database, not drawn in the browser." |
| 2:20-2:40 | Run synthetic night, FlexReceipt | Press run. Show delivered kWh, captured amount, receipt | "Charging is simulated. Money moves only after delivered energy is recorded. If the charger had failed, the hold would be voided and the driver pays nothing." |
| 2:40-2:50 | Impact summary slide | Static text | "In a synthetic benchmark, rescheduling reached the energy target in 15 percent of disturbed cases, mostly by finishing later with the driver's consent; the rest are physically unrecoverable and are handled honestly. Not measured savings." |

Narrative check: a customer accepts a charging promise (0:35) -> a charger slows (1:05) -> the recovery workflow responds (1:20) -> deterministic validation (1:20-1:45) -> Bryntum shows the change (2:05) -> charging continues (2:20) -> the financial policy decides (2:20) -> FlexReceipt explains it (2:20).

Honest-failure variant (optional 15 s, only if time remains): use the operator "Inject outage" on the reservation before delivery; the hold is voided and the receipt shows no charge. State that failure cases are unrecoverable by design.

Never say: "live Gemini decided", "PayPal certified", "real chargers", "measured savings". Say "SYNTHETIC" aloud once.
