<div align="center">
GridWindow FlexPay
EV charging that works around your schedule. Payments that wait for proof.
A smarter way to share limited charging capacity, with flexible charging windows, transparent offers, and payment capture tied to verified delivery.


TypeScript


![PayPal](https://img.shields.io/badge/PayPal-Sandbox-003087?logo=paypal&logoColor=white)






Explore the experience · Run it locally · See the evidence · **Judge walkthrough** · **Architecture**


<img src="public/images/nighttime_ev_charging_station.png" alt="Electric vehicle charging at night at a shared station" width="820">
<sub>Working application. Synthetic charging and energy models. PayPal Sandbox or clearly labeled MOCK payments. No live charging hardware.</sub>

</div>
The idea
Your car does not need to charge every minute it is parked. It needs to be ready when you leave.

That gap is an opportunity. At a shared charging site, several drivers can arrive around the same time, compete for limited power, and push demand into expensive hours. Yet some of those vehicles could charge later without inconveniencing anyone.

GridWindow FlexPay finds that flexibility and turns it into an offer a driver can actually understand. The driver chooses how much energy they need, when they are leaving, and what they are willing to spend. A deterministic scheduler checks the station's physical limits and builds feasible options. Flexible offers appear only when the modeled economics work for both the driver and the operator.

Then comes the part that matters most: the driver approves exact terms, the payment is authorized, and capture waits until the simulated delivery record satisfies the settlement rules. If the charging session fails under the applicable policy, the authorization can be voided instead of collecting money for an undelivered session.

AI makes the journey easier to navigate. It does not decide what the driver owes, approve terms, or touch a payment.

[!IMPORTANT]
This is a hackathon prototype and an engineering demonstration, not a commercial charging network. Energy delivery, base load, tariffs, savings, and disturbances are simulated. PayPal integrations use Sandbox funds only. See Scope and limitations.

At a glance
The challenge	What GridWindow does
Multiple cars want to charge at once	Plans in 15-minute intervals against site capacity, port ratings, and efficiency
Flexible charging is hard to explain	Shows the immediate option alongside qualifying flexible offers and their assumptions
A cheap schedule may not actually work	Revalidates plans with an independent feasibility checker
Drivers need control over price and timing	Requires approval of an exact, versioned offer before payment authorization
Pay-now checkout ignores actual delivery	Separates authorization from capture and settles against delivery evidence
Conditions change during charging	Replans remaining energy, protects delivered history, and requests consent when terms change
AI can produce unreliable answers	Keeps models inside narrow explanation and candidate-selection boundaries
The experience
<table> <tr> <td width="50%" align="center"> <img src="docs/screenshots/driver-offers.png" alt="Driver-facing comparison of immediate and flexible EV charging offers" width="100%"> <br><strong>01. Choose your charging window</strong> <br><sub>Compare timing, modeled price, savings, and assumptions before approving an offer.</sub> </td> <td width="50%" align="center"> <img src="docs/screenshots/operator-console.png" alt="Operator view of charging reservations, station load, and control tools" width="100%"> <br><strong>02. Keep the site within its limits</strong> <br><sub>Inspect reservations, occupancy, load, disturbances, and payment state.</sub> </td> </tr> <tr> <td colspan="2" align="center"> <img src="docs/screenshots/flexreceipt.png" alt="FlexReceipt connecting approved terms, simulated energy delivered, and payment outcome" width="52%"> <br><strong>03. Close the loop with a FlexReceipt</strong> <br><sub>One record connects the approved offer, simulated delivery, and provider-confirmed payment result.</sub> </td> </tr> </table>
<sub>These screenshots were taken in MOCK mode with seeded synthetic data. They do not depict real payments or physical charging.</sub>

A complete charging journey
The payment authorization is a hold, not escrow. Authorization does not mean capture, and an elapsed deadline is never itself a reason to charge the driver.

What makes it different
1. An offer must be physically possible
The scheduler works in 15-minute slots and accounts for port limits, charger efficiency, occupancy, and a shared site power constraint. A separate validator checks the proposed plan before it can be used. The demo station is configured as follows:

Port	Rated charging power
A	3.6 kW
B	7.2 kW
C	11 kW
Site capacity	24 kW, shared with modeled site load
An attractive price is not enough. If the requested energy cannot fit inside the available parked time and capacity, the app cannot present that plan as feasible.

2. Flexibility has to benefit both sides
A flexible offer is published only when the driver receives a modeled discount and the operator's modeled contribution improves. Otherwise, immediate charging remains the available choice. Prices, fees, and savings are derived from the synthetic assumptions rather than generated by an AI model.

3. The approved terms are the source of truth
The server stores the approved offer, including its amount, currency, merchant, conditions, and expiry. It recomputes payment amounts from those terms and checks the PayPal order before authorization. Neither the browser nor an AI response can silently change the bargain.

4. The payment follows the energy
The system records simulated energy delivery and uses it to drive settlement. It can capture a successful session once or void an eligible failed session. Compare-and-set transitions, idempotency keys, a unique settlement guard, webhook verification, and provider reconciliation protect the payment path from retries and conflicting events.

5. Recovery respects what was already agreed
A site cap may fall, a charger may fail, or a departure time may change. GridWindow can replan only the affected session's remaining energy. Previously delivered energy and unrelated sessions remain untouched. The system can commit a safe replacement plan or ask the driver to approve a specific change. It does not let an agent rewrite prices or settle funds.

Built for two sides of the charging experience
<table> <tr><th width="50%">For drivers</th><th width="50%">For operators</th></tr> <tr><td> <ul> <li>Enter requirements using a form or plain language.</li> <li>Compare immediate charging against qualifying flexible windows.</li> <li>See modeled savings and the assumptions used.</li> <li>Approve one exact offer before checkout.</li> <li>Track authorization, simulated charging, capture, or void.</li> <li>Use a savings-goal helper that recommends, but never approves.</li> <li>Print a FlexReceipt showing the agreed and delivered outcome.</li> </ul> </td><td> <ul> <li>Sign in to a passphrase-protected operator console.</li> <li>Inspect reservations, port occupancy, and the site load plan.</li> <li>Run a simulated night and inspect payment events.</li> <li>Inject a labeled synthetic outage or disturbance.</li> <li>Review recovery candidates, consent gates, and schedule versions.</li> <li>Reconcile settlement state with the payment provider.</li> <li>Explore a read-only schedule timeline and accessible table.</li> </ul> </td></tr> </table>
Recovery when the original plan stops working
The autonomous recovery workflow is deliberately bounded. It is not a free-running agent making operational or financial decisions.

What the guardrails actually mean:

Already delivered energy is never replanned. Other reservations stay unchanged.
Automatic changes must satisfy the agreed energy target, preserve the departure deadline, stay inside the plug-in window, and avoid a higher price.
Changes needing consent require the driver's approval of the exact proposal version. Expired or stale approvals are rejected.
Recovery executions are lease-fenced and limited to three attempts. A stalled worker cannot commit the same change twice.
The model, when available, may select a server-validated candidate ID. It cannot invent a candidate, change a quote, authorize a payment, or call an unknown tool.
For qualifying unrecoverable operator-attributable failures under the newer agreement policy, the authorization is voided in full and the customer is charged zero, even if some physical energy was simulated as delivered. Other outcomes can require operator resolution.
<details> <summary><strong>Read the recovery edge cases and known gaps</strong></summary>
Recovery uses forecast base load, while replay uses realized synthetic load. Some recovered schedules therefore deliver less than planned. An auto-committed recovery can also raise the operator's modeled energy cost, provided the defined minimum margin still holds.

A live Gemini recovery attempt returned an HTTP 504 and used the deterministic fallback. That run does not establish a completed live-model recovery decision. PayPal Sandbox recovery settlement has not yet been tested.

Guided demo Scenario C exercises the recovery path. The operator console's Inject outage button still exercises the older simulated outage flow. The two should not be presented as the same scenario.

Full details: Recovery benchmark · Findings · Architecture.

</details>
AI helps explain. Deterministic code decides.
GridWindow can use Google Gemini through the Google Gen AI SDK, or a supported Anthropic configuration. With no key, or when a provider fails, the application uses a clearly labeled deterministic parser and explainer.

Responsibility	AI assistant	Server-owned logic
Interpret a driver's plain-language request	Yes	Validates inputs
Explain offers and reservation status	Yes	Supplies and verifies facts
Suggest an existing eligible offer	Yes	Calculates eligibility and price
Select a recovery candidate by validated ID	Bounded	Generates and checks candidates
Set or change an offer's amount	No	Yes
Approve a driver's consent	No	Enforces explicit approval
Authorize, capture, or void money	No	Yes, through the gateway
Numbers shown in model-generated explanations are checked against backend facts. Unsupported answers are replaced by deterministic text. This design makes the app usable even if the model service is down.

Quick start
No PayPal account, AI API key, hosted database, or webhook tunnel is required. MOCK mode uses an embedded PGlite database and a clearly labeled payment simulator.

Requirements: Node.js 22+, npm, and Git. The initial production build downloads Geist fonts and needs internet access.

<details open> <summary><strong>macOS, Linux, or Git Bash</strong></summary>
git clone https://github.com/piyusha-sayal/gridwindow-flexpay.git
cd gridwindow-flexpay
npm ci
npm run build

PAYMENT_MODE=mock PAYPAL_ENV=sandbox DEMO_TOOLS=true \
APP_BASE_URL=http://localhost:3000 \
SESSION_SECRET=local-demo-session-secret-change-me-0123456789 \
OPERATOR_PASSPHRASE=local-demo-operator \
npm start
</details><details> <summary><strong>Windows PowerShell</strong></summary>
git clone https://github.com/piyusha-sayal/gridwindow-flexpay.git
cd gridwindow-flexpay
npm ci
npm run build

$env:PAYMENT_MODE="mock"
$env:PAYPAL_ENV="sandbox"
$env:DEMO_TOOLS="true"
$env:APP_BASE_URL="http://localhost:3000"
$env:SESSION_SECRET="local-demo-session-secret-change-me-0123456789"
$env:OPERATOR_PASSPHRASE="local-demo-operator"
npm start
</details>
Open http://localhost:3000. The credentials shown here are local throwaway examples. Choose different values for any shared environment. The session secret must contain at least 32 characters and the operator passphrase at least 12.

For a persistent local configuration, copy .env.example to .env.local. To work with a development server, use npm run dev instead of the production start command. Embedded data lives under .data/.

Where to go first
Page	What to explore
/	Landing page and interactive pricing scheduler
/drive	Smart Charge request, offer comparison, and approval
/reservations/<id>	Session progress, settlement status, and FlexReceipt
/operator	Operator console and synthetic disturbances
/operator/schedule	Schedule versions, pending proposals, read-only timeline, and accessible table
/rewards	Rewards, payment commitments, and provider-confirmed states
/impact-lab	Interactive scenarios and synthetic benchmark
/how-it-works	Guided explanation and FAQ
Three ways to evaluate it
Try a normal session: open /drive, compare offers, approve one, and complete the simulated delivery in MOCK mode.
Test a failure: open /operator, inject the legacy outage scenario, and inspect the payment outcome and event trail.
Test recovery: follow Scenario C in the judge walkthrough, then inspect the updated schedule and consent outcome.
For a shorter presentation, use the under-three-minute demo script.

Architecture
Layer	Location	Responsibility
Domain	src/domain/	Deterministic scheduling, feasibility checks, economics, terms hashes, simulation, payment states, benchmarks
Payment providers	src/payments/	PaymentGateway, MockGateway, PayPalSandboxGateway
Server	src/server/	Database, migrations, repositories, quote/checkout/settlement services, webhooks, reconciliation, security helpers
Web app	src/app/	Next.js pages and API routes
Core stack: Next.js 16, React 19, strict TypeScript, Zod, PostgreSQL-compatible persistence via embedded PGlite or a PostgreSQL server, Vitest, and Playwright.

Financial and scheduling values use integer units such as cents, watts, and watt-hours, rather than relying on floating-point arithmetic for critical calculations.

<details> <summary><strong>Payment safety and state integrity</strong></summary>
The app refuses to start if PAYPAL_ENV is not sandbox.
The backend recomputes amounts from stored approved terms and checks merchant, currency, and amount before authorization.
State changes use compare-and-set conditions to prevent invalid transitions.
Payment requests use PayPal-Request-Id idempotency keys.
A unique settlement index guards against contradictory capture and void outcomes.
PayPal webhooks are signature-verified against the original raw body, correlated to reservations, and de-duplicated.
Reconciliation reads payment status from PayPal rather than trusting browser state.
Append-only energy and event records make the outcome traceable.
The settlement sweep runs every five minutes without a UI trigger.
See Architecture and PayPal certification.

</details><details> <summary><strong>Configuration reference</strong></summary>
Variable	Usage
PAYMENT_MODE	mock by default, or paypal_sandbox
PAYPAL_ENV	Must be sandbox
PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET	Backend-only PayPal Sandbox credentials
PAYPAL_EXPECTED_MERCHANT_ID	Required merchant identity in Sandbox mode
PAYPAL_WEBHOOK_ID	Registered Sandbox webhook ID; required for webhook acceptance
APP_BASE_URL	Exact app origin for return URLs, cookies, and origin validation
ALLOWED_ORIGINS	Optional exact extra origins for state-changing requests; no wildcards or paths
TRUST_PROXY	Use true only behind a trusted proxy or tunnel
SESSION_SECRET	Session-cookie secret, minimum 32 characters
OPERATOR_PASSPHRASE	Operator sign-in passphrase, minimum 12 characters
DATABASE_URL	Optional external PostgreSQL connection; otherwise use embedded PGlite
MIGRATION_DATABASE_URL	Optional direct database URL for migrations
GW_AUTO_MIGRATE	For disposable local data only; never enable for hosted or persistent databases
GEMINI_API_KEY, GEMINI_MODEL	Optional Gemini integration
ANTHROPIC_API_KEY, AI_PROVIDER, AI_MODEL	Optional Anthropic/provider settings
DEMO_TOOLS	Enables seed and reset tools in local MOCK mode without DATABASE_URL
GW_ISOLATED_DB	Test isolation guard set by test runners
FAILED_SERVICE_REMEDY_CENTS	Modeled operator remedy cost for an eligible failure, default 200 cents
The documented default Gemini model is gemini-3.6-flash. Never commit real credentials. With a loopback APP_BASE_URL, same-port localhost, 127.0.0.1, and [::1] aliases are accepted automatically.

</details><details> <summary><strong>Database and migration rules</strong></summary>
Embedded PGlite initializes and migrates automatically. External PostgreSQL databases do not migrate at application startup. A schema mismatch prevents startup until migrations are applied deliberately.

npm run db:migrate -- --status
npm run db:migrate -- --plan
npm run db:migrate -- --apply --confirm-database <fingerprint>
Only run --apply after reviewing the plan and confirming the exact target database. See Migrations.

</details>
What we tested
This is the documented release verification snapshot, not a claim that a live CI system has retested every newer local change.

Verification	Recorded outcome
Strict TypeScript and ESLint	0 errors, 0 problems
Vitest, unit and integration	806 passed, 12 gated skips
PostgreSQL 18.1 on a disposable local server	11 passed, 1 restart-test skip
Playwright, 21 spec files	0 failures, 6 intentional skips
Production build	Pass
Client-bundle secret scan	Pass
Production dependency audit	0 vulnerabilities reported at verification time
Recovery benchmark repeatability	Two deterministic runs matched
The 12 skipped Vitest checks require a disposable TEST_DATABASE_URL pointing to real PostgreSQL. The restart check also needs TEST_PG_RESTART_CMD. Playwright has six intentional mobile and tablet keyboard-journey skips. Test runners isolate data and refuse hosted services and non-MOCK payments.

npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run benchmark
npm run benchmark:recovery
npm run release:scan
npm audit --omit=dev
For the complete claim-by-claim record, including blocked and untested items, see Award evidence and Skipped tests.

Two real PayPal Sandbox paths
Unlike a MOCK-only payment demonstration, two scenarios were exercised with the genuine PayPal Sandbox API and Sandbox buyer funds.

Scenario	Recorded behavior	Result
Successful simulated charge · Nov 6, 2026	USD 14.82 authorized; 30.015 kWh simulated against a 30 kWh target	One capture reported completed by PayPal
Simulated charger outage · Nov 7, 2026	USD 14.19 authorized; 0 kWh simulated as delivered	Authorization voided, no capture, USD 0.00 collected
Four webhook event types were verified through PayPal's signature-checking flow. The initial webhook URL omitted /api/webhooks/paypal, so early events needed to be resent after the URL was corrected. That correction and the resulting processed events are recorded in the evidence log.

No real money moved and no real EV charged. PayPal Sandbox recovery settlement has not been demonstrated.

<details> <summary><strong>Reproduce the PayPal Sandbox integration</strong></summary>
Create a Sandbox REST app and Sandbox buyer account in the PayPal Developer Dashboard.

Set PAYMENT_MODE=paypal_sandbox, PAYPAL_ENV=sandbox, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_EXPECTED_MERCHANT_ID, and the exact APP_BASE_URL in .env.local.

Inspect the planned smoke test without network access:

npm run paypal:smoke
When ready to create Sandbox orders, run:

npm run paypal:smoke -- --approve-sandbox-orders
This exercises an authorize/capture and an authorize/void path using USD 1.23 Sandbox orders.

For verified webhook delivery, configure a public HTTPS endpoint ending in /api/webhooks/paypal and set PAYPAL_WEBHOOK_ID.

Use PayPal certification and the external integration runbook for the complete procedure.

</details>
Benchmark: show the wins and the misses
The scheduling benchmark replays 500 seeded synthetic nights and 1,500 requests across four policies. Every generated plan goes through the independent feasibility validator.

Scheduling policy	Requests served / 1,500	Mean modeled energy cost / session	Mean site peak
Charge immediately	1,246	$10.61	22.1 kW
Static off-peak start	1,024	$6.01	20.2 kW
Greedy cheapest tariff	1,243	$6.86	21.9 kW
GridWindow optimizer	1,254	$5.44	17.6 kW
The independent validator reported zero feasibility-validation failures for these runs. The optimized policy produced the lowest mean modeled energy cost and mean site peak in this particular synthetic benchmark, while serving the most requests.

What did not go well:

246 of 1,500 requests were infeasible even for the optimizer because the energy could not fit within the parking time and station constraints.
Compared request by request, the optimizer cost more than immediate charging in 62 comparisons, more than static off-peak in 49, and more than greedy tariff in 14. These are 125 unfavorable pairwise comparisons, not 125 unique sessions.
Benchmark values depend on the chosen synthetic load, prices, and station assumptions. They are not measured utility savings or real-world performance guarantees.
The source outputs are in `artifacts/benchmark/summary.json` and the companion requests.csv. The interactive comparison is available inside the app at /impact-lab.

A separate 200-seed recovery benchmark compares the original schedule with the recovery workflow, including unsuccessful and infeasible cases. See Recovery benchmark.

Scope and limitations
Area	What is demonstrated	What is not claimed
Charging	A schedule and simulated energy-delivery ledger	Live EV hardware control or metered utility delivery
Site economics	Transparent synthetic tariffs, fees, modeled savings, and contribution	Verified customer savings or utility bill reductions
Payments	MOCK and authentic PayPal Sandbox authorization/capture/void	Production payments or escrow
Recovery	Guarded rescheduling and explicit consent boundaries in simulation	Field-tested resilience or completed PayPal Sandbox recovery settlement
AI	Optional interpretation, explanation, and bounded candidate selection	AI control of prices, consent, or funds
Identity	Pseudonymous driver sessions and a demo operator passphrase	Production-grade identity and access management
Scheduling UI	Read-only Bryntum timeline plus an accessible reference table	Fully editable scheduling UI or complete vendor-grid accessibility
Further details that matter to reviewers:

Synthetic disturbances are labeled as such. The system labels recovery decisions MODEL_DECISION only when a trace supports live-model involvement; otherwise it reports DETERMINISTIC_FALLBACK.
Bryntum Scheduler Community 8.0.0 has known accessibility findings in its own grid DOM. The adjacent accessible table is the reference view. The bundled Bryntum license text has not yet been independently checked by the project. See Bryntum notes and third-party notices.
The free Gemini tier may allow provider use of prompts to improve products. Do not enter personal or sensitive information into this demo.
This prototype is not ready for deployment as a real charging service or production payment system.
Troubleshooting
<details> <summary><strong>Common local setup issues</strong></summary>
Symptom	What to check
Old npm crashes	Install Node.js 22+ and use its bundled npm 10+
Build fails while downloading fonts	The first build needs network access for Geist fonts
Operator console is not configured	Set OPERATOR_PASSPHRASE to at least 12 characters
SERVER_MISCONFIGURED (503)	Inspect the server log for the missing or invalid setting; secret values are not printed
Port 3000 is occupied	Start with npm start -- -p 3200 and update APP_BASE_URL to http://localhost:3200
Request origin not allowed	Open the exact APP_BASE_URL origin or configure permitted ALLOWED_ORIGINS
PayPal return fails	Match APP_BASE_URL to the browser origin; cookies are origin-bound
Webhooks do not arrive	Check the /api/webhooks/paypal path, PAYPAL_WEBHOOK_ID, and trusted proxy settings
Tests refuse hosted services	Test isolation intentionally blocks hosted databases, model keys, and non-MOCK payments
Need a fresh local demo	Stop the server and delete .data/, or use the demo reset with DEMO_TOOLS=true
For public preview origins, use HTTPS. ALLOWED_ORIGINS accepts exact origins only, with no wildcard or path. Set TRUST_PROXY=true only when requests come through a trusted tunnel or proxy.

</details>
Documentation and deeper dives
Start here	Why it matters
Judge walkthrough
Credential-free evaluation path and optional integrations
Demo script
Under-three-minute presentation sequence
Architecture
Trust boundaries, state machines, and data flow
Award evidence
Claim-by-claim status, including gaps
Evidence log
Sanitized Sandbox and model test records
Economics
Assumptions, offer rules, worked calculations, and physics checks
Recovery benchmark
200-seed recovery comparisons
Recovery findings
Shortfalls and operator margin tradeoffs
<details> <summary><strong>More technical references</strong></summary>
Reference	Topic
PayPal certification
Sandbox and webhook checks
External integration
PayPal and AI runbook
External preflight
Required approvals for integration testing
Migrations
Database migration procedure
Bryntum notes
Time zone, accessibility, and licensing review
Skipped tests
Test inventory and gating
Third-party dependencies
Package licenses
License and secrets checklist
License and client-bundle scan checks
Devpost draft
Hackathon submission copy
</details>
Creators
Piyusha Sayal and Satyam Pandey

Built to explore a practical question: What if EV charging was scheduled around the driver's actual deadline, and payment depended on what the charger could prove it delivered?

Released under the MIT License. Copyright © 2026 Piyusha Sayal and Satyam Pandey. Third-party dependencies retain their respective licenses. Geist fonts use the SIL Open Font License.

<div align="center">
Plan carefully. Charge flexibly. Settle against delivery.

Back to top · Run the demo · Review the evidence · Open issues

</div>




