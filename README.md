
<!--
  GridWindow FlexPay
  GitHub-native README: Markdown, HTML, compact Mermaid, and image-based charts.
  No JavaScript, custom CSS, or unsupported embeds required.
-->

<div align="center">

<img src="https://img.shields.io/badge/GRIDWINDOW-FLEXPAY-0B1220?style=for-the-badge&amp;labelColor=0B1220&amp;color=14B8A6" alt="GridWindow FlexPay" />

# GridWindow FlexPay

### Your car charges when it makes sense. Your payment waits until delivery.

**Smart EV scheduling · Verified delivery before payment · Human-approved recovery · Developer-ready integrations**

<img src="https://readme-typing-svg.demolab.com?font=Inter&amp;weight=600&amp;size=19&amp;duration=3500&amp;pause=900&amp;color=14B8A6&amp;center=true&amp;vCenter=true&amp;repeat=true&amp;width=760&amp;height=52&amp;lines=Plan+around+the+driver%2C+not+just+the+charger.;Protect+the+site%27s+power+limit.;Authorize+first.+Capture+only+after+delivery.;Recover+from+failures+without+changing+the+deal." alt="Animated introduction to GridWindow FlexPay" />

[![Next.js 16](https://img.shields.io/badge/Next.js-16-111827?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-PGlite%20%2F%20Server-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![PayPal](https://img.shields.io/badge/PayPal-Sandbox-003087?logo=paypal&logoColor=white)](docs/EVIDENCE.md)
[![MIT](https://img.shields.io/badge/License-MIT-16A34A)](LICENSE)
[![CI](https://github.com/piyusha-sayal/gridwindow-flexpay/actions/workflows/ci.yml/badge.svg)](https://github.com/piyusha-sayal/gridwindow-flexpay/actions/workflows/ci.yml)

**[Explore the live demo](https://gridwindow-flexpay.onrender.com)** · **[Judge guide](docs/JUDGES.md)** · **[Open the API developer portal](https://gridwindow-flexpay-developers.onrender.com)** · **[Connect an AI agent through MCP](docs/MCP.md)**

<sub>Live on Render · PayPal Sandbox test funds · Synthetic charging · Latest release evidence: November 11, 2026</sub>

<br />

<img src="public/images/nighttime_ev_charging_station.png" width="860" alt="Illustration of an electric vehicle charging at a shared station overnight" />

</div>

---

## One simple idea, four important promises

> **A parked car does not need electricity every minute. It needs enough energy before its driver leaves.**

GridWindow FlexPay uses that flexibility to coordinate charging at a shared site. Drivers choose their energy target, departure time, and budget. The scheduler finds feasible windows, checks the economics for both sides, and lets the driver approve one exact offer. The exact approved amount is authorized first. Capture follows only when the synthetic delivery ledger and settlement rules allow it. If an eligible operator failure prevents delivery, the authorization is voided instead.

| The promise | How we approach it |
| :--- | :--- |
| **Ready when you leave** | Schedule in 15-minute slots around energy needs, port limits, occupancy, and departure times. |
| **Savings with real constraints** | Show a flexible offer only when it improves the modeled outcome for both driver and operator. |
| **No automatic pay-now capture** | Authorize an agreed amount, then capture after qualifying delivery or void after an eligible failure. |
| **AI without payment authority** | Let AI explain or select prevalidated recovery options, never change prices, grant consent, or move money. |

> [!IMPORTANT]
> **Prototype, not a live charging network.** Vehicles, building load, energy delivery, forecasts, tariffs, disturbances, and savings are simulated. Payments use MOCK mode or PayPal Sandbox funds. No real vehicle is charged and no real customer money moves. [Read the limits](#an-honest-look-at-the-boundaries).

---

## Pick your path

<table>
<tr>
<td width="33%" align="center">
<h3>I'm a driver</h3>
<p>See what a flexible charging offer looks like and follow a session through settlement.</p>
<a href="docs/evidence/final-release-2026-11-11/01-product/05-validated-charging-offers.png"><strong>See Smart Charge</strong></a><br />
<a href="#what-the-app-actually-gives-you">Explore the driver flow</a>
</td>
<td width="33%" align="center">
<h3>I'm an operator</h3>
<p>Inspect site power, schedule versions, synthetic faults, and payment outcomes.</p>
<a href="docs/evidence/final-release-2026-11-11/03-operator-ag-grid/01-operator-dashboard.png"><strong>See the console</strong></a><br />
<a href="#what-the-app-actually-gives-you">Explore operator controls</a>
</td>
<td width="33%" align="center">
<h3>I'm a judge</h3>
<p>Start with the hosted app: what to try without access, and which evidence is real PayPal Sandbox.</p>
<a href="docs/JUDGES.md"><strong>Open judge guide</strong></a><br />
<a href="docs/DEMO_SCRIPT.md">Follow the demo script</a>
</td>
</tr>
</table>

---

## The product in pictures

<div align="center">

<table>
<tr>
<td align="center" width="50%" valign="top">
<h3>01 / Find a plan that fits the driver</h3>
<a href="docs/evidence/final-release-2026-11-11/01-product/05-validated-charging-offers.png"><img src="docs/evidence/final-release-2026-11-11/01-product/05-validated-charging-offers.png" alt="Smart Charge: compare immediate and flexible charging offers with modeled price assumptions" width="100%" /></a>
<p><sub>Validated offers with savings and a bounded recommendation. Local synthetic run using a labeled fallback.</sub></p>
</td>
<td align="center" width="50%" valign="top">
<h3>02 / Run the site</h3>
<a href="docs/evidence/final-release-2026-11-11/03-operator-ag-grid/01-operator-dashboard.png"><img src="docs/evidence/final-release-2026-11-11/03-operator-ag-grid/01-operator-dashboard.png" alt="Operator console: reservations, station power usage and simulation controls" width="100%" /></a>
<p><sub>Live operator dashboard, including connected AI status and provider-backed payment operations.</sub></p>
</td>
</tr>
</table>

<h3>03 / Verify the outcome</h3>

<a href="docs/evidence/final-release-2026-11-11/02-paypal/06-flexreceipt.png"><img src="docs/evidence/final-release-2026-11-11/02-paypal/06-flexreceipt.png" alt="FlexReceipt: approved terms, synthetic energy delivery and PayPal Sandbox capture" width="400" /></a>

<sub>Live PayPal Sandbox receipt: confirmed capture following synthetic delivery.</sub>

</div>

<sub>Screenshot provenance varies: offers use local MOCK/fallback, while the operator dashboard and receipt show the live Sandbox environment. Charging and grid data are synthetic throughout. See the <a href="docs/evidence/final-release-2026-11-11/SCREENSHOT_INDEX.md">screenshot index</a> and <a href="docs/evidence/final-release-2026-11-11/EVIDENCE_MANIFEST.md">evidence manifest</a>.</sub>

### See the integrations and recovery in action

<table>
<tr>
<td width="50%" align="center" valign="top"><strong>PayPal Sandbox: captured after delivery</strong><br /><a href="docs/evidence/final-release-2026-11-11/02-paypal/05-successful-capture.png"><img src="docs/evidence/final-release-2026-11-11/02-paypal/05-successful-capture.png" width="100%" alt="Live PayPal Sandbox capture after synthetic energy delivery" /></a><br /><sub>Live Sandbox provider-confirmed capture</sub></td>
<td width="50%" align="center" valign="top"><strong>PayPal Sandbox: authorization voided</strong><br /><a href="docs/evidence/final-release-2026-11-11/02-paypal/08-zero-charge-receipt.png"><img src="docs/evidence/final-release-2026-11-11/02-paypal/08-zero-charge-receipt.png" width="100%" alt="Live PayPal Sandbox authorization void receipt with zero collected" /></a><br /><sub>Live Sandbox void, $0.00 collected</sub></td>
</tr>
<tr>
<td width="50%" align="center" valign="top"><strong>Bryntum: approved recovery timeline</strong><br /><a href="docs/evidence/final-release-2026-11-11/04-bryntum-recovery/07-updated-bryntum-schedule.png"><img src="docs/evidence/final-release-2026-11-11/04-bryntum-recovery/07-updated-bryntum-schedule.png" width="100%" alt="Bryntum Scheduler displaying committed recovered charging schedule" /></a><br /><sub>Local synthetic recovery after driver approval</sub></td>
<td width="50%" align="center" valign="top"><strong>AG Grid: reservation operations</strong><br /><a href="docs/evidence/final-release-2026-11-11/03-operator-ag-grid/02-ag-grid-reservations.png"><img src="docs/evidence/final-release-2026-11-11/03-operator-ag-grid/02-ag-grid-reservations.png" width="100%" alt="Live AG Grid reservations table with payment and service status" /></a><br /><sub>Live operator reservation table</sub></td>
</tr>
<tr>
<td width="50%" align="center" valign="top"><strong>Channel3: live EV accessories</strong><br /><a href="docs/evidence/final-release-2026-11-11/06-channel3/02-channel3-product-cards.png"><img src="docs/evidence/final-release-2026-11-11/06-channel3/02-channel3-product-cards.png" width="100%" alt="Live Channel3 EV accessory products displayed on Rewards" /></a><br /><sub>Real merchant listings, not charging payouts</sub></td>
<td width="50%" align="center" valign="top"><strong>APIMatic: developer portal</strong><br /><a href="docs/evidence/final-release-2026-11-11/07-apimatic/03-accept-offer-api-reference.png"><img src="docs/evidence/final-release-2026-11-11/07-apimatic/03-accept-offer-api-reference.png" width="100%" alt="APIMatic documentation for accept-offer API with explicit consent" /></a><br /><sub>Live API documentation and typed contract</sub></td>
</tr>
</table>

<details>
<summary><strong>More release screenshots: AI agent, approval gate, mobile UI, and accessible schedule</strong></summary>

| Evidence | What it shows |
| :--- | :--- |
| [MCP tools](docs/evidence/final-release-2026-11-11/05-ai-agentic-commerce/04-mcp-tools.png) | Seven tools exposed to an AI client without payment-authority tools |
| [MCP booking preparation](docs/evidence/final-release-2026-11-11/05-ai-agentic-commerce/05-mcp-booking-preparation.png) | Agent prepares a reservation and stops before buyer approval |
| [Driver approval required](docs/evidence/final-release-2026-11-11/04-bryntum-recovery/05-driver-consent-required.png) | Exact proposed change and consent boundary |
| [Recovery validation](docs/evidence/final-release-2026-11-11/04-bryntum-recovery/04-deterministic-validation.png) | Candidate and deterministic validation record |
| [Accessible schedule table](docs/evidence/final-release-2026-11-11/04-bryntum-recovery/08-accessible-schedule-table.png) | Alternative to vendor timeline markup |
| [Smart Charge on mobile](docs/evidence/final-release-2026-11-11/08-responsive/02-mobile-smart-charge.png) | Verified responsive layout |
| [AI deal recommendation](docs/evidence/final-release-2026-11-11/01-product/06-recommended-offer-explanation.png) | Backend-grounded explanation in labeled fallback mode |
| [Full screenshot index](docs/evidence/final-release-2026-11-11/SCREENSHOT_INDEX.md) | Entire capture set with live, local, Sandbox and fallback labels |

</details>

---

## From plug-in to proof

A charging reservation has two separate jobs: **deliver the agreed energy** and **settle the payment correctly**. The second job is not allowed to skip ahead of the first.

```mermaid
flowchart LR
  A[Driver request] --> B[Validate and price]
  B --> C[Approve exact terms]
  C --> D[PayPal authorize]
  D --> E[Simulate delivery]
  E --> F{Result}
  F -->|Delivered| G[Capture once]
  F -->|Eligible failure| H[Void]
  F -->|Unresolved| I[Review]
  classDef good fill:#D1FAE5,stroke:#059669,color:#064E3B
  class G,H good
```

**The important distinction:** an authorization is a temporary hold, not escrow and not a completed payment. The system does not capture merely because a clock or deadline has passed. [Explore the payment evidence](docs/EVIDENCE.md).

---

## Why a shared station needs a smarter window

Imagine three drivers plugging in after work. All three need energy by morning, but they do not all need the same charging start time. Charging every car immediately can increase the site's peak and push consumption into higher-cost intervals. Moving everyone to a single cheap hour can create a new bottleneck.

GridWindow handles the trade-off in **15-minute planning intervals**, with an independent validator checking each proposed schedule. The demo site has a **24 kW shared cap** and ports rated **3.6, 7.2 and 11 kW**.

### The demo site's physical budget

```mermaid
flowchart LR
  A[24 kW site cap] --> B[Building base load]
  A --> C[Port A · 3.6 kW]
  A --> D[Port B · 7.2 kW]
  A --> E[Port C · 11 kW]
  B --> F[15-minute validator]
  C --> F
  D --> F
  E --> F
```

| Constraint | Why it matters |
| :--- | :--- |
| **24 kW site cap** | Combined modeled site load must stay inside the configured limit. |
| **3.6 / 7.2 / 11 kW ports** | A reservation cannot draw more than its assigned port allows. |
| **Plug-in and ready-by times** | The available charging window is finite. |
| **Charging efficiency** | Energy drawn from the site is not identical to energy delivered to the battery. |
| **Shared occupancy** | Two vehicles cannot use the same port at the same time. |
| **15-minute time steps** | Every schedule is checked slot by slot, not only by an overall energy total. |

If the requested energy cannot physically be delivered, the system does not create an attractive-looking but impossible offer. [See the detailed economics and physics](docs/08_ECONOMICS.md).

---

## What the app actually gives you

<table>
<tr>
<td width="50%" valign="top">
<h3 id="driver-experience">Driver experience</h3>
<ul>
<li>Enter energy, arrival, departure, and budget by form or plain language.</li>
<li>Compare immediate charging against qualifying flexible windows.</li>
<li>Inspect assumptions, modeled savings, and final terms.</li>
<li>Approve one immutable offer with merchant, amount, currency, and expiry.</li>
<li>Track authorization, synthetic charging, and settlement.</li>
<li>Compare Gentle Charging at reduced port power when feasible and ask the savings-goal helper to recommend a qualifying offer.</li>
<li>Print a FlexReceipt connecting consent, delivery, and payment.</li>
</ul>
<a href="docs/evidence/final-release-2026-11-11/01-product/05-validated-charging-offers.png">View driver screenshot</a>
</td>
<td width="50%" valign="top">
<h3 id="operator-experience">Operator experience</h3>
<ul>
<li>Open a passphrase-protected control center.</li>
<li>Use AG Grid-powered operator tables to inspect reservations, site load and charging status.</li>
<li>Run synthetic sessions and reconcile payment state.</li>
<li>Inject a labeled synthetic outage or capacity disturbance.</li>
<li>Review ordered recovery steps, fault attribution, candidate checks and pending driver consent.</li>
<li>Navigate the selected date in the Bryntum schedule, with persisted versions and pending proposals.</li>
<li>See a per-reservation event and payment history.</li>
</ul>
<a href="docs/evidence/final-release-2026-11-11/03-operator-ag-grid/01-operator-dashboard.png">View operator screenshot</a>
</td>
</tr>
</table>

### Explore the pages

| Experience | Route after local startup | What to try |
| :--- | :--- | :--- |
| Home | [Live home](https://gridwindow-flexpay.onrender.com/) | Interactive pricing scheduler and product overview |
| Smart Charge | [Live Smart Charge](https://gridwindow-flexpay.onrender.com/drive) | Compare offers, gentle charging, approve terms and start Sandbox checkout |
| Reservation | `/reservations/<id>` | Inspect session and payment state, then print FlexReceipt |
| Operator console | [Live operator console](https://gridwindow-flexpay.onrender.com/operator) | AG Grid operations view, reservations, synthetic events and reconciliation; passphrase required |
| Operator schedule | [Live scheduler](https://gridwindow-flexpay.onrender.com/operator/schedule) | Date-specific Bryntum timeline, persisted versions, proposals and accessible table; operator access required |
| Rewards & Payments | [Live Rewards](https://gridwindow-flexpay.onrender.com/rewards) | Provider-confirmed payment states and Channel3 EV gear recommendations |
| Impact Lab | [Live Impact Lab](https://gridwindow-flexpay.onrender.com/impact-lab) | Explore charging scenarios and synthetic benchmark results |
| How it works | [Live walkthrough](https://gridwindow-flexpay.onrender.com/how-it-works) | Four-step product walkthrough, gentle charging and FAQ |

<sub>The reservation route uses a generated session-specific ID. Operator pages require authorized access. Local equivalents use `http://localhost:3000` after setup.</sub>

---

## The numbers behind the scheduler

The benchmark replays **500 seeded synthetic nights** containing **1,500 charging requests**. It compares four policies under the same modeled station, tariff, and load assumptions. A separate validator checks each proposed plan.

<div align="center">

![Modeled nights](https://img.shields.io/badge/Seeded%20nights-500-0F766E?style=for-the-badge)
![Charging requests](https://img.shields.io/badge/Charging%20requests-1%2C500-0284C7?style=for-the-badge)
![Validator failures](https://img.shields.io/badge/Validator%20failures-0-16A34A?style=for-the-badge)
![Recovery seeds](https://img.shields.io/badge/Recovery%20seeds-200-7C3AED?style=for-the-badge)

</div>

<table>
<tr>
<td width="50%" align="center" valign="top">
<h3>Modeled energy cost per served session</h3>
<img src="https://quickchart.io/chart?width=600&amp;height=330&amp;backgroundColor=%230F172A&amp;format=png&amp;c=%7B%22type%22%3A%22horizontalBar%22%2C%22data%22%3A%7B%22labels%22%3A%5B%22Immediate%22%2C%22Off-peak%22%2C%22Greedy%22%2C%22GridWindow%22%5D%2C%22datasets%22%3A%5B%7B%22label%22%3A%22USD%22%2C%22data%22%3A%5B10.61%2C6.01%2C6.86%2C5.44%5D%2C%22backgroundColor%22%3A%5B%22%2364748B%22%2C%22%2364748B%22%2C%22%2364748B%22%2C%22%2314B8A6%22%5D%2C%22borderWidth%22%3A0%7D%5D%7D%2C%22options%22%3A%7B%22responsive%22%3Atrue%2C%22legend%22%3A%7B%22display%22%3Afalse%7D%2C%22layout%22%3A%7B%22padding%22%3A%7B%22left%22%3A6%2C%22right%22%3A20%2C%22top%22%3A12%2C%22bottom%22%3A6%7D%7D%2C%22scales%22%3A%7B%22xAxes%22%3A%5B%7B%22ticks%22%3A%7B%22beginAtZero%22%3Atrue%2C%22max%22%3A12%2C%22fontColor%22%3A%22%23E2E8F0%22%2C%22fontSize%22%3A11%7D%2C%22gridLines%22%3A%7B%22color%22%3A%22%23334155%22%2C%22zeroLineColor%22%3A%22%2364748B%22%7D%7D%5D%2C%22yAxes%22%3A%5B%7B%22ticks%22%3A%7B%22fontColor%22%3A%22%23F1F5F9%22%2C%22fontSize%22%3A12%7D%2C%22gridLines%22%3A%7B%22display%22%3Afalse%7D%7D%5D%7D%2C%22plugins%22%3A%7B%22datalabels%22%3A%7B%22display%22%3Afalse%7D%7D%7D%7D" alt="Horizontal bar chart comparing modeled energy cost per served session in US dollars: immediate 10.61, off-peak 6.01, greedy 6.86, optimized GridWindow 5.44" width="100%" />
<p><sub>USD per served session. Lower is better.</sub></p>
</td>
<td width="50%" align="center" valign="top">
<h3>Requests served out of 1,500</h3>
<img src="https://quickchart.io/chart?width=600&amp;height=330&amp;backgroundColor=%230F172A&amp;format=png&amp;c=%7B%22type%22%3A%22horizontalBar%22%2C%22data%22%3A%7B%22labels%22%3A%5B%22Immediate%22%2C%22Off-peak%22%2C%22Greedy%22%2C%22GridWindow%22%5D%2C%22datasets%22%3A%5B%7B%22label%22%3A%22Requests%22%2C%22data%22%3A%5B1246%2C1024%2C1243%2C1254%5D%2C%22backgroundColor%22%3A%5B%22%2364748B%22%2C%22%2364748B%22%2C%22%2364748B%22%2C%22%2314B8A6%22%5D%2C%22borderWidth%22%3A0%7D%5D%7D%2C%22options%22%3A%7B%22responsive%22%3Atrue%2C%22legend%22%3A%7B%22display%22%3Afalse%7D%2C%22layout%22%3A%7B%22padding%22%3A%7B%22left%22%3A6%2C%22right%22%3A20%2C%22top%22%3A12%2C%22bottom%22%3A6%7D%7D%2C%22scales%22%3A%7B%22xAxes%22%3A%5B%7B%22ticks%22%3A%7B%22beginAtZero%22%3Atrue%2C%22max%22%3A1500%2C%22fontColor%22%3A%22%23E2E8F0%22%2C%22fontSize%22%3A11%7D%2C%22gridLines%22%3A%7B%22color%22%3A%22%23334155%22%2C%22zeroLineColor%22%3A%22%2364748B%22%7D%7D%5D%2C%22yAxes%22%3A%5B%7B%22ticks%22%3A%7B%22fontColor%22%3A%22%23F1F5F9%22%2C%22fontSize%22%3A12%7D%2C%22gridLines%22%3A%7B%22display%22%3Afalse%7D%7D%5D%7D%2C%22plugins%22%3A%7B%22datalabels%22%3A%7B%22display%22%3Afalse%7D%7D%7D%7D" alt="Horizontal bar chart comparing served requests: immediate 1,246, off-peak 1,024, greedy 1,243, optimized GridWindow 1,254" width="100%" />
<p><sub>Requests successfully scheduled. Higher is better.</sub></p>
</td>
</tr>
</table>

<sub>Charts are rendered as image previews from the recorded synthetic benchmark results. They do not update with live charging data.</sub>

| Policy | Served | Mean modeled energy cost / served session | Mean site peak |
| :--- | ---: | ---: | ---: |
| Immediate charging | 1,246 | $10.61 | 22.1 kW |
| Static off-peak | 1,024 | $6.01 | 20.2 kW |
| Greedy cheapest tariff | 1,243 | $6.86 | 21.9 kW |
| **GridWindow optimized** | **1,254** | **$5.44** | **17.6 kW** |

### The results we do not hide

The optimizer was **not** the cheapest option for every comparable request. There were **125 unfavorable pairwise comparisons**: 62 against immediate charging, 49 against static off-peak, and 14 against greedy tariff. Also, **246 requests were physically infeasible even for the optimizer**. Those requests were excluded from the pairwise cost comparisons.

This is a controlled simulation, not a field study or a utility-bill prediction. The totals summarize the documented benchmark and must not be interpreted as universal real-world savings.

**Explore the evidence:** [Benchmark summary JSON](artifacts/benchmark/summary.json) · [Economics assumptions](docs/08_ECONOMICS.md) · [Impact Lab](#explore-the-pages) · [Recovery benchmark](docs/RECOVERY_BENCHMARK.md)

---

## Payments that follow delivery

An attractive offer is only useful if both sides can trust the settlement logic. GridWindow separates the **driver's consent**, the **provider's authorization**, the **synthetic delivery ledger**, and the **final payment operation**.

```mermaid
sequenceDiagram
  actor Driver
  participant GW as GridWindow
  participant PP as PayPal Sandbox
  Driver->>GW: Approve exact offer
  GW->>PP: Authorize agreed amount
  GW->>GW: Verify synthetic delivery
  alt Qualifying delivery
    GW->>PP: Capture once
  else Eligible operator failure
    GW->>PP: Void
  else Unresolved
    GW->>GW: Operator review
  end
  PP-->>GW: Confirmed provider state
  GW-->>Driver: FlexReceipt
```

### Two PayPal Sandbox paths were exercised

<table>
<tr>
<td width="50%" valign="top">
<h3>Delivery succeeds</h3>
<strong>November 6, 2026</strong>
<p>Authorized <strong>$14.82</strong> for a 30 kWh target. The simulator recorded <strong>30.015 kWh</strong>, followed by one capture. The provider reported completed capture and verified webhooks were processed.</p>
<a href="docs/EVIDENCE.md">Inspect successful scenario</a>
</td>
<td width="50%" valign="top">
<h3>Charging fails</h3>
<strong>November 7, 2026</strong>
<p>Authorized <strong>$14.19</strong>, then injected an outage with <strong>0 kWh</strong> delivered. The provider reported a void, no capture, and <strong>$0.00 collected</strong>.</p>
<a href="docs/EVIDENCE.md">Inspect failure scenario</a>
</td>
</tr>
</table>

Both examples used **Sandbox money and simulated energy**, not real charges. Four webhook event types were verified with PayPal signature checks over the raw body. An initial webhook URL configuration mistake was corrected and the missed events were resent once. [Read the exact evidence and caveats](docs/EVIDENCE.md).

<details>
<summary><strong>How duplicate charges, stale operations, and altered terms are addressed</strong></summary>

The server uses immutable approved terms and recalculates amounts itself. It verifies the payee, amount, and currency before authorizing. Compare-and-set transitions, settlement constraints, idempotency keys (`PayPal-Request-Id`), signed raw-body webhook verification, event deduplication, and provider-side reconciliation guard against duplicate or inconsistent payment operations.

The provider's state is read back rather than accepted from the browser. The application also rejects any `PAYPAL_ENV` other than `sandbox`.

See [Architecture](docs/ARCHITECTURE.md) and [PayPal certification](docs/PAYPAL_CERTIFICATION.md).

</details>

---

## Recovery without rewriting the agreement

Real charging conditions can change. A port may fail, a site cap may fall, or a driver may leave early. The recovery engine works on **remaining energy only**. It does not rewrite energy already delivered or silently modify other reservations.

```mermaid
flowchart LR
  A[Synthetic fault] --> B[Validate candidates]
  B --> C{Safe to change?}
  C -->|Same terms| D[Commit new version]
  C -->|New consent| E[Driver approval]
  E -->|Approved, current| D
  E -->|Declined or stale| F[Keep original terms]
  C -->|No solution| G[Operator resolution]
  D --> H[Audit trail]
  F --> H
  G --> H
```

| The recovery guarantee | What the server enforces |
| :--- | :--- |
| **History stays history** | Delivered energy and earlier slots do not change. |
| **Other drivers stay protected** | The recovery cannot rewrite other sessions. |
| **No silent price increase** | Changed commercial terms require approval. |
| **No silent departure change** | Changes to agreed timing require the relevant consent. |
| **No stale approval** | Approval only applies to the exact active proposal version. |
| **No duplicate commit** | Lease and fencing checks protect schedule commits and traces. |
| **Model cannot improvise** | It can select only server-validated candidate IDs, with deterministic fallback. |

**Recovery and settlement on the live site:** on 2026-11-11, two PayPal Sandbox bookings went through a recorded disturbance before settling. One recovery was approved by the driver, wrote schedule version 2 and was then captured. The other had no feasible fix, was attributed to the operator and was voided. Both were read back from the PayPal API with verified webhooks ([evidence](docs/EVIDENCE.md#recovery-followed-by-paypal-sandbox-settlement-2026-11-11)).

**Important current limits:** recovery uses forecast base load while replay uses realized base load, so replanning does not guarantee that all remaining energy will ultimately be delivered. A recovery may raise the operator's modeled energy cost while preserving its 1-cent minimum contribution margin. Gemini has driven recovery tool steps live, but in those runs the provider hit capacity errors and the deterministic path made the final decision, so a live model's final recovery decision is not claimed. The dedicated recovery workflow traces its steps in sequence and supports a version-specific approval gate. Its synthetic fault path is distinct from the older single-click outage simulator.

[Recovery benchmark](docs/RECOVERY_BENCHMARK.md) · [Detailed findings](docs/RECOVERY_BENCHMARK_FINDINGS.md) · [Operator timeline notes](docs/BRYNTUM_NOTES.md)

---

## Connected tools that make the product work

Each integration has a specific job in the charging, payment, operator, or developer experience.

| Integration | Where it shows up | Why it matters |
| :--- | :--- | :--- |
| [PayPal Sandbox](https://developer.paypal.com/) | Checkout, authorization, capture, void, webhooks and provider reconciliation | The approved amount can be held first and captured only after qualifying synthetic delivery. |
| [Google Gemini](https://ai.google.dev/) and [OpenRouter](https://openrouter.ai/) | Driver assistance, deal agent and constrained recovery selection | AI can interpret and explain but cannot set prices, approve terms or move money. OpenRouter provides an optional backup route. |
| [Bryntum Scheduler](https://bryntum.com/products/scheduler/) | [Operator schedule](https://gridwindow-flexpay.onrender.com/operator/schedule) | Date-driven timeline with persisted schedule versions and separately shown pending proposals. |
| [AG Grid](https://www.ag-grid.com/) | [Operator console](https://gridwindow-flexpay.onrender.com/operator) | Structured operational tables and faster inspection of reservation and session data. |
| [Channel3](https://trychannel3.com/) | [Rewards & Payments](https://gridwindow-flexpay.onrender.com/rewards) and MCP `find_ev_gear` | Live EV accessory discovery and merchant links, distinct from modeled energy savings. |
| [APIMatic](https://www.apimatic.io/) | [Developer portal](https://gridwindow-flexpay-developers.onrender.com), [OpenAPI spec](docs/openapi.yaml), generated TypeScript SDK | A documented, typed API surface for outside developers. |
| [Model Context Protocol](https://modelcontextprotocol.io/) | [MCP server guide](docs/MCP.md) | Allows compatible AI clients to search and compare charging options while preserving the driver's checkout approval. |
| [Render](https://render.com/) | [Hosted application](https://gridwindow-flexpay.onrender.com) and [developer portal](https://gridwindow-flexpay-developers.onrender.com) | Publicly accessible deployments for demonstrations and developer exploration. |

### A charging flow an AI agent can assist with

The MCP server enables compatible agents such as Claude and Cursor to read station information, interpret a charging request, compare offers, request a deal recommendation, and prepare checkout. **The agent stops at the PayPal approval link.** The driver must approve the transaction, and settlement stays under server control.

```mermaid
flowchart LR
  A[AI client] --> B[MCP tools]
  B --> C[Compare validated offers]
  C --> D[Prepare checkout]
  D --> E[Driver approves in PayPal]
  E --> F[Server verifies delivery]
  F --> G[Capture or void]
```

Run `npm run mcp:smoke` for the dedicated integration check. [MCP setup and consent model](docs/MCP.md) · [APIMatic developer guide](docs/APIMATIC.md) · [API reference](https://gridwindow-flexpay-developers.onrender.com) · [TypeScript SDK files](apimatic/).

### Capability areas, from the driver to the developer

| Category | Concrete experience | Evidence |
| :--- | :--- | :--- |
| **Core charging product** | Deadline-aware windows, pricing and Gentle Charging | [Offer screen](docs/evidence/final-release-2026-11-11/01-product/05-validated-charging-offers.png) |
| **Payments and AI** | PayPal authorizations, conditional capture or void, Gemini assistance and provider failover | [Payment screenshots](docs/evidence/final-release-2026-11-11/SCREENSHOT_INDEX.md) |
| **Autonomous recovery** | Fault attribution, validated candidates, driver consent and durable schedule versions | [Recovery evidence](docs/BRYNTUM_EVIDENCE.md) |
| **Visual scheduling** | Bryntum port timeline, selected-night navigation and pending-proposal lane | [Updated schedule](docs/evidence/final-release-2026-11-11/04-bryntum-recovery/07-updated-bryntum-schedule.png) |
| **Operator operations** | AG Grid sorting, attention filter, payment status and CSV export | [AG Grid evidence](docs/evidence/final-release-2026-11-11/03-operator-ag-grid/02-ag-grid-reservations.png) |
| **Agentic commerce** | MCP offer discovery, recommendations and approval-link handoff | [MCP documentation](docs/MCP.md) |
| **Connected commerce** | Channel3 EV gear discovery on Rewards and through MCP | [Product cards](docs/evidence/final-release-2026-11-11/06-channel3/02-channel3-product-cards.png) |
| **Developer platform** | APIMatic OpenAPI docs, generated TypeScript SDK and portal | [API portal](https://gridwindow-flexpay-developers.onrender.com) |
| **Cloud delivery** | Render-hosted app and developer portal with release health checks | [Deployment verification](docs/FINAL_RELEASE_VERIFICATION_2026-11-11.md) |

---

## AI helps explain. The server makes the decisions.

GridWindow can use [Google Gemini](https://ai.google.dev/gemini-api/docs) through the [Google Gen AI SDK](https://github.com/googleapis/js-genai), with OpenRouter available as a backup model route. When no supported model key is configured or a provider fails, the app uses a **deterministic parser and explainer**. The main workflow still works, and the operator's recovery view always says whether a model or the deterministic path made each decision.

| AI may do | AI may not do |
| :--- | :--- |
| Interpret a driver's plain-language charging request | Invent or directly change a price |
| Explain offers using verified backend facts | Approve an offer for the driver |
| Answer reservation questions | Authorize, capture, or void funds |
| Recommend among offers that already qualify | Override the independent scheduler validator |
| Select a server-approved recovery candidate by ID | Make arbitrary tool calls or modify past energy delivery |

```mermaid
flowchart LR
  A[Driver or operator input] --> B[Gemini / OpenRouter / fallback]
  B --> C[Server facts + validation]
  C -->|Allowed| D[Explanation or candidate ID]
  C -->|Invalid or unavailable| E[Deterministic fallback]
  D --> F[Server-controlled decision]
  E --> F
```

**A model response is not the source of truth.** Facts are checked against server data, and unverifiable numerical claims are replaced with deterministic wording. Avoid entering personal information into demo AI prompts, especially when using provider free tiers.

---

## Architecture at a glance

```mermaid
flowchart LR
  A[Next.js and React UI] --> B[API and security checks]
  B --> C[Deterministic scheduler]
  B --> D[Recovery and settlement]
  C --> E[(PGlite / PostgreSQL)]
  D --> E
  D --> F[PayPal Sandbox]
  B -.-> G[Gemini / OpenRouter]
  A -.-> H[Bryntum / AG Grid]
```

| Layer | Source | Owns |
| :--- | :--- | :--- |
| **Web experience** | [`src/app/`](src/app/) | Next.js pages and API routes |
| **Deterministic core** | [`src/domain/`](src/domain/) | Scheduling, validation, economics, terms, simulator, state machine, benchmarks |
| **Payment adapters** | [`src/payments/`](src/payments/) | `PaymentGateway`, PayPal Sandbox and MOCK implementations |
| **Server orchestration** | [`src/server/`](src/server/) | Repositories, migrations, checkout, settlement, recovery, reconciliation, webhooks and security |
| **Persistence** | [PGlite](https://pglite.dev/) / [PostgreSQL](https://www.postgresql.org/) | Local embedded storage by default, external PostgreSQL when configured |
| **Validation and testing** | [Zod](https://zod.dev/), [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/) | Input contracts, logic tests, integration checks and browser journeys |
| **Schedule visualization** | [Bryntum Scheduler](https://bryntum.com/products/scheduler/) | Date-aware, read-only timeline with an adjacent accessible table |

AG Grid adds operator data tables, the MCP server exposes bounded charging workflows, and APIMatic publishes the API contract and TypeScript client. Domain arithmetic uses integer cents, watts, and watt-hours to avoid avoidable floating-point decisions in commercial and power constraints. Event and energy records are append-only. [Read the full design](docs/ARCHITECTURE.md).

---

## Watch the workflow, or reproduce it yourself

The demo video is linked from our Devpost submission. The repository also has the walkthrough script, the test inputs and the final screenshot evidence set, so you can follow the real interface yourself.

| Demo resource | What you get |
| :--- | :--- |
| [Live product](https://gridwindow-flexpay.onrender.com) | Driver journey and public pages; operator controls require a passphrase (judges get it in the Devpost testing instructions) |
| [Judge guide](docs/JUDGES.md) | What to try without access, which live nights hold real Sandbox records, and Sandbox evidence versus MOCK tests |
| [Demo script](docs/DEMO_SCRIPT.md) | Screen-by-screen live-site story, including PayPal, MCP, AG Grid, recovery and the integrations, with the labels to read aloud |
| [Run it locally](docs/JUDGES.md#4-run-it-locally) | Reproduce charging and recovery scenarios with an isolated MOCK database |
| [Release screenshot index](docs/evidence/final-release-2026-11-11/SCREENSHOT_INDEX.md) | Captures of the product, payment outcomes, recovery, integrations and mobile layouts |
| [Final release verification](docs/FINAL_RELEASE_VERIFICATION_2026-11-11.md) | What was exercised against the deployed release and what remains limited |

<details>
<summary><strong>Recommended 3-minute viewing sequence</strong></summary>

1. **Driver:** request 30 kWh before 7 AM, compare physically validated flexible offers, then approve exact terms.
2. **PayPal:** show a Sandbox authorization hold, followed by the separate captured or voided outcomes.
3. **AI and MCP:** show offer assistance and an agent preparing checkout without completing human approval.
4. **Operator:** inspect AG Grid reservation and payment statuses.
5. **Recovery:** inject a synthetic charger-power change, validate candidates, show the pending proposal, obtain driver approval, then display the updated Bryntum schedule.
6. **Close:** show the FlexReceipt, Channel3 gear, API portal and the recorded test results.

Keep the labels **SYNTHETIC**, **MOCK**, **SANDBOX**, and **DETERMINISTIC_FALLBACK** visible where appropriate.

</details>

---

## Release verification: November 11, 2026

The final deployment report for application revision **`3edf59d`** records **1,247 successful checks** across payments, AI, scheduling, recovery, developer integrations, security and the live service. The automated Vitest and Playwright suites recorded **zero failures**. The live PayPal checks include an actual **Sandbox capture and void on the hosted site**, confirmed by reading the resulting provider states back from PayPal.

<div align="center">

![Passed checks](https://img.shields.io/badge/Verified%20passes-1%2C247-15803D?style=for-the-badge)
![Automated failures](https://img.shields.io/badge/Automated%20failures-0-0F766E?style=for-the-badge)
![Release](https://img.shields.io/badge/Verified%20revision-3edf59d-2563EB?style=for-the-badge)
![Sandbox](https://img.shields.io/badge/PayPal%20Sandbox-capture%20%2B%20void-003087?style=for-the-badge&logo=paypal&logoColor=white)

</div>

### Verification by capability

| Area | Successful checks | What was verified |
| :--- | ---: | :--- |
| **PayPal payment lifecycle** | **229** | Checkout, authorizations, capture and void, webhooks, reconciliation and settlement. |
| **AI assistance and deal agent** | **238** | Gemini, OpenRouter backup, assistant and deal-agent behavior. Four additional live or contract checks were not recorded as passed. |
| **Autonomous recovery** | **282** | Safe replanning, consent requirements, schedule versions and the recovery checklist fix. |
| **Bryntum scheduler** | **130** | Persisted schedules, timeline behavior and selected-date navigation fix. |
| **AG Grid operator console** | **4** | Browser and integration checks for operator data presentation. |
| **Channel3 gear discovery** | **7** | EV gear search and integration behavior. |
| **APIMatic API platform** | **20** | OpenAPI contract, typed SDK and developer portal checks. |
| **MCP server** | **16** | Agent tools, contract and workflow checks. |
| **Pricing and charging physics** | **94** | Feasibility, offer qualification and numerical constraints. |
| **Security and platform** | **157** | Completed security and platform validations. |
| **UI, accessibility and visual checks** | **64** | Completed browser, accessibility and visual validations. |
| **Render deployment and health** | **6** | Hosted service and health checks. |
| **Total successful** | **1,247** | **Successful checks recorded against the release.** |

<sub>The full release inventory contains 1,269 recorded checks: 1,247 passed, 18 were intentionally skipped, and 4 AI live/contract checks were not recorded as passed. The table above focuses on successful coverage rather than counting skipped checks as executed tests. No automated test failed. The same automated suites passed again, with the same counts, on the final documentation commit.</sub>

### Live outcomes worth demonstrating

<table>
<tr>
<td width="33%" valign="top"><strong>PayPal authorization to capture</strong><p>Sandbox buyer approval, energy delivery simulation, one capture and a provider-confirmed final state.</p></td>
<td width="33%" valign="top"><strong>PayPal authorization to void</strong><p>Synthetic charging failure, authorization void and provider-confirmed no-capture outcome.</p></td>
<td width="33%" valign="top"><strong>Recovery with approval</strong><p>Change a charging constraint, inspect candidate validation, require driver approval when agreed terms change, then apply only the current proposal version.</p></td>
</tr>
</table>

The two final operator fixes, **date-specific scheduler navigation** and **an accurate recovery checklist** (the financial step shows Done only after PayPal confirms the capture or void), are part of the recorded final checks. For a demo, use the [demo script](docs/DEMO_SCRIPT.md), [release screenshot index](docs/evidence/final-release-2026-11-11/SCREENSHOT_INDEX.md), and [integration evidence](docs/EVIDENCE.md).

<details>
<summary><strong>Re-run the automated checks locally</strong></summary>

```bash
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
```

Test isolation refuses hosted databases, production-like payment providers and model keys. PostgreSQL-specific tests require a disposable database. [Migration safety](docs/MIGRATIONS.md) · [Test inventory](docs/SKIPPED_TESTS.md).

</details>

---

## Run it in minutes

**You do not need a PayPal account, Gemini key, hosted database, or webhook tunnel to explore the product.** MOCK mode and the embedded database are enough.

**Prerequisites:** [Node.js 22+](https://nodejs.org/), Git, and internet access for the first build's Geist font download.

<details open>
<summary><strong>macOS / Linux / Git Bash</strong></summary>

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

</details>

<details>
<summary><strong>Windows PowerShell</strong></summary>

```powershell
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
```

</details>

The sample values above are **local-only placeholders**, not production secrets. `SESSION_SECRET` must contain at least 32 characters, and `OPERATOR_PASSPHRASE` at least 12. For an enduring local setup, copy [`.env.example`](.env.example) to `.env.local`. The embedded database is stored under `.data/`. Stop the app before deleting that folder to reset locally.

<details>
<summary><strong>Environment reference</strong></summary>

| Setting | Purpose |
| :--- | :--- |
| `PAYMENT_MODE` | `mock` or `paypal_sandbox` |
| `PAYPAL_ENV` | Must be `sandbox`; startup rejects other values |
| `APP_BASE_URL` | Exact app origin for return URLs, cookies, and origin validation |
| `ALLOWED_ORIGINS` | Optional explicit additional origins, no wildcard or path |
| `SESSION_SECRET` | Session-cookie signing secret, at least 32 characters |
| `OPERATOR_PASSPHRASE` | Operator console password, at least 12 characters |
| `DEMO_TOOLS` | Local MOCK-only seed and reset controls without `DATABASE_URL` |
| `DATABASE_URL` | Optional external PostgreSQL; otherwise embedded PGlite |
| `MIGRATION_DATABASE_URL` | Optional direct connection for migration tasks |
| `GW_AUTO_MIGRATE` | Automatic startup migrations only for disposable local databases |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | Server-only Sandbox credentials |
| `PAYPAL_EXPECTED_MERCHANT_ID` | Required expected payee for Sandbox checkout |
| `PAYPAL_WEBHOOK_ID` | Registered Sandbox webhook ID for signature verification |
| `TRUST_PROXY` | Enable only behind a trusted proxy or tunnel |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Optional Gemini provider config |
| `GEMINI_FALLBACK_MODEL` / `AI_FALLBACK_PROVIDER` | Optional fallback-model routing; follow `.env.example` for available values |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | Optional OpenRouter backup provider configuration |
| `ANTHROPIC_API_KEY` / `AI_PROVIDER` / `AI_MODEL` | Optional alternative AI provider configuration |
| `CHANNEL3_API_KEY` | Optional Channel3 gear lookup, when permitted by the runtime configuration |
| `FAILED_SERVICE_REMEDY_CENTS` | Modeled operator remedy cost, default 200 cents; not a PayPal fee |
| `GW_ISOLATED_DB` | Test isolation guard, set by test runners |

For local development use `npm run dev`. For Sandbox setup and external integrations, see [External integration guide](docs/EXTERNAL_INTEGRATION.md).

</details>

<details>
<summary><strong>PayPal Sandbox: reproduce payment flows with your own credentials</strong></summary>

1. Create a Sandbox REST app and a Sandbox buyer account in the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).
2. Configure `PAYMENT_MODE=paypal_sandbox`, `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_EXPECTED_MERCHANT_ID`, and `APP_BASE_URL` in `.env.local`.
3. Run `npm run paypal:smoke` to preview the test plan without a network call.
4. Only when ready, run `npm run paypal:smoke -- --approve-sandbox-orders` to exercise one authorize/capture and one authorize/void of **$1.23 Sandbox** each.
5. For webhooks, expose a public HTTPS endpoint ending in `/api/webhooks/paypal`, configure `PAYPAL_WEBHOOK_ID`, and follow [PayPal certification](docs/PAYPAL_CERTIFICATION.md).

Credentials must never be committed. A PayPal Sandbox account is different from a real-money production checkout.

</details>

<details>
<summary><strong>Database and migration safety</strong></summary>

Embedded PGlite migrations run automatically. An external PostgreSQL database is **not** migrated at startup; the app refuses schema mismatches. Review migrations before applying them:

```bash
npm run db:migrate -- --status
npm run db:migrate -- --plan
# Follow the printed fingerprint instructions before applying.
npm run db:migrate -- --apply --confirm-database <fingerprint>
```

Never enable `GW_AUTO_MIGRATE=true` for a persistent database. Read [docs/MIGRATIONS.md](docs/MIGRATIONS.md).

</details>

<details>
<summary><strong>Troubleshooting quick fixes</strong></summary>

| Symptom | Check |
| :--- | :--- |
| Old npm fails | Use Node 22+ with npm 10+ |
| Build cannot download fonts | Allow network access for the initial Geist download |
| Operator console unavailable | Set a valid `OPERATOR_PASSPHRASE` |
| `SERVER_MISCONFIGURED` | Check required environment variables and server logs |
| Port 3000 occupied | Choose another port, such as `3200`, and use the matching `APP_BASE_URL` |
| Request origin rejected | Browse the exact `APP_BASE_URL`, or configure a permitted exact origin |
| Sandbox checkout does not return | Match cookie origin and browser origin exactly |
| Webhooks do not arrive | Verify HTTPS endpoint `/api/webhooks/paypal`, webhook ID, and trusted-proxy settings |
| Tests refuse to start | Remove hosted services, model keys, and non-MOCK payment settings from isolated test configuration |

See the [external integration guide](docs/EXTERNAL_INTEGRATION.md).

</details>

---

## An honest look at the boundaries

| Already demonstrated | Not demonstrated or not production-ready |
| :--- | :--- |
| Deterministic scheduling with independent validation in synthetic benchmarks | Performance against real vehicles, chargers, meter readings, and utility tariffs |
| Exact-offer consent and payment state controls | Production customer authentication and live commercial payment processing |
| PayPal Sandbox authorization/capture and authorization/void, including settlement after a recovery run | Duplicate webhook delivery and provider timeouts against the live provider (tested with fakes only) |
| Fault recovery with server-validated candidate selection and deterministic fallback | Guaranteed model-selected recovery under all provider conditions |
| Bryntum schedule with operator-selected date and an accessible table | Fully accessible third-party Bryntum grid; vendor DOM has known axe findings |
| Repeatable synthetic benchmarks and documented negative cases | Proven real-world savings, grid impact, or general economic superiority |

The recovery benchmark may show unfavorable or infeasible results. The settlement sweep runs periodically in the background and is not a manual UI action. The demo uses pseudonymous sessions instead of production-grade identity management. Bryntum licensing and vendor accessibility findings are documented in the third-party notes.

[Detailed limitations](docs/AWARD_EVIDENCE.md) · [Bryntum notes](docs/BRYNTUM_NOTES.md) · [Third-party license notes](docs/THIRD_PARTY.md) · [Secrets checklist](docs/LICENSE_AND_SECRETS_CHECKLIST.md)

---

## Documentation you can actually navigate

<details open>
<summary><strong>Demo and judging</strong></summary>

| Document | Best for |
| :--- | :--- |
| [Judge walkthrough](docs/JUDGES.md) | Where to click on the hosted app, what works without credentials, and real Sandbox evidence versus MOCK tests |
| [Demo script](docs/DEMO_SCRIPT.md) | A short, reproducible presentation path on the live site |
| [Live application](https://gridwindow-flexpay.onrender.com) | Browser-based product walkthrough |
| [Award evidence](docs/AWARD_EVIDENCE.md) | Every claim marked PASS, PARTIAL, FAIL, NOT TESTED or NOT CLAIMED |

</details>

<details>
<summary><strong>Engineering and scheduling</strong></summary>

| Document | Best for |
| :--- | :--- |
| [Architecture](docs/ARCHITECTURE.md) | Trust boundaries, domain layers, payment states, and evidence mapping |
| [Economics](docs/08_ECONOMICS.md) | Tariff assumptions, offer eligibility, physics, and worked examples |
| [Recovery benchmark](docs/RECOVERY_BENCHMARK.md) | 200-seed comparison and infeasible cases |
| [Recovery findings](docs/RECOVERY_BENCHMARK_FINDINGS.md) | Forecast versus realized-load shortfalls and margin effects |
| [Bryntum notes](docs/BRYNTUM_NOTES.md) | Scheduler UI, time zones, accessibility, and licensing |
| [API contract](docs/openapi.yaml) | Machine-readable OpenAPI specification |
| [APIMatic guide](docs/APIMATIC.md) | Generated SDK and developer portal |
| [MCP setup](docs/MCP.md) | Agent tools, approval boundary and smoke check |

</details>

<details>
<summary><strong>Integrations, safety, and operations</strong></summary>

| Document | Best for |
| :--- | :--- |
| [Integration evidence](docs/EVIDENCE.md) | Sanitized PayPal Sandbox and Gemini run records |
| [PayPal certification](docs/PAYPAL_CERTIFICATION.md) | Payment and webhook certification steps |
| [External integration](docs/EXTERNAL_INTEGRATION.md) | Sandbox, webhook, and model smoke-test runbooks |
| [PayPal + AI evidence](docs/PAYPAL_AI_EVIDENCE.md) | What was verified locally and what was verified live |
| [Agentic Commerce evidence](docs/AGENTIC_COMMERCE_EVIDENCE.md) | Recovery agent runs, decision labels and live model runs |
| [Migration guide](docs/MIGRATIONS.md) | Database schema safety and migration confirmation |
| [Skipped tests](docs/SKIPPED_TESTS.md) | What was deliberately gated and why |
| [Third-party packages](docs/THIRD_PARTY.md) | Dependency licensing |
| [License and secrets checklist](docs/LICENSE_AND_SECRETS_CHECKLIST.md) | Known license status and client-bundle checks |

</details>

<details>
<summary><strong>Product evidence and final release references</strong></summary>

| Document | Best for |
| :--- | :--- |
| [Final release report](docs/FINAL_RELEASE_VERIFICATION_2026-11-11.md) | Deployment facts, checks and integration limits |
| [Screenshot gallery](docs/evidence/final-release-2026-11-11/SCREENSHOT_INDEX.md) | All final screen captures, with provenance labels |
| [Screenshot manifest](docs/evidence/final-release-2026-11-11/EVIDENCE_MANIFEST.md) | Which images show live, local, Sandbox or fallback results |
| [Demo script](docs/DEMO_SCRIPT.md) | Current browser walkthrough and verbal script |

</details>

---

## Meet the creators

<div align="center">

<table>
<tr>
<td align="center" width="50%" valign="top">
<a href="https://github.com/piyusha-sayal"><img src="https://github.com/piyusha-sayal.png?size=160" width="104" height="104" alt="Piyusha Sayal's GitHub profile avatar" /></a>
<h3>Piyusha Sayal</h3>
<sub>Co-creator of GridWindow FlexPay</sub>
<p><a href="https://github.com/piyusha-sayal"><strong>GitHub profile</strong></a></p>
</td>
<td align="center" width="50%" valign="top">
<a href="https://github.com/satyamamarpandey"><img src="https://github.com/satyamamarpandey.png?size=160" width="104" height="104" alt="Satyam Pandey GitHub avatar" /></a>
<h3>Satyam Pandey</h3>
<sub>Co-creator of GridWindow FlexPay</sub>
<p><a href="https://github.com/satyamamarpandey"><strong>GitHub</strong></a> · <a href="https://pandeysatyam.com/#satyam-pandey"><strong>Website</strong></a></p>
</td>
</tr>
</table>

</div>

---

## License and attribution

GridWindow FlexPay is released under the [MIT License](LICENSE). Copyright © 2026 Piyusha Sayal and Satyam Pandey.

The application uses the Geist font family under the SIL Open Font License, loaded from Google Fonts during build. The illustrations, demo captures and synthetic datasets are demonstration assets, not real-world charging measurements. Third-party code and the Bryntum integration are documented separately in [Third-party notices](docs/THIRD_PARTY.md) and [Bryntum notes](docs/BRYNTUM_NOTES.md).

<div align="center">

### Flexible charging. Verified delivery. Accountable payment.

**[Back to top](#gridwindow-flexpay)** · **[Judge guide](docs/JUDGES.md)** · **[Demo walkthrough](docs/DEMO_SCRIPT.md)** · **[Release evidence](docs/evidence/final-release-2026-11-11/SCREENSHOT_INDEX.md)**

<sub>Built as a working hackathon prototype, with simulations and external integrations labeled for what they actually prove.</sub>

</div>
