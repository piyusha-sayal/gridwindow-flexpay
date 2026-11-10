# Devpost submission text

Status: draft text for the owner to review. Nothing here is submitted. Claims follow `docs/AWARD_EVIDENCE.md`.

## Title
GridWindow FlexPay: consented flexible EV charging that recovers from disturbances, with payment that follows delivered energy

## Tagline
When a charger is limited mid-night, the plan is re-planned inside the driver's agreed terms, and money moves only when delivery is recorded.

## Inspiration
Overnight charging sites cap total power, but drivers plug in with no reason to shift their charging. Flexibility only works if the driver trusts the deal, and if a fault cannot leave them paying for energy they did not get.

## What it does
A driver states the energy needed, the departure time and a spending cap, in a form or in plain language. A deterministic engine finds schedules that fit under the station's power cap and the port limits. A flexible offer is shown only if the driver pays less and the operator's modeled contribution improves. The driver approves one exact offer, and the payment provider authorizes that amount.

When an operator records a synthetic charger disturbance, a recovery run re-plans only that session's remaining energy from the disturbance onward. It either writes a new schedule version (inside pre-approved bounds), asks the driver to approve the change, or reports the physical constraint that blocks it. The operator timeline (Bryntum Scheduler Community 8.0.0, read-only, with an accessible table) shows the persisted before and after. Capture or void is decided from the synthetic delivered-energy ledger, and the FlexReceipt shows the terms, the disturbance and the payment state.

## How we built it
Next.js 16 and strict TypeScript. A pure domain engine in integer units (cents, watts, watt-hours) with an independent validator. PostgreSQL through embedded PGlite by default, or a PostgreSQL server through `DATABASE_URL`, with an explicit, checksummed migration procedure. PayPal Orders v2 and Payments v2 over REST (authorize, capture, void), with a compare-and-set state machine, idempotent request IDs, signed-webhook verification against the raw body, and reconciliation against the provider.

The recovery engine is lease-fenced and bounded to three attempts. A model, when configured, can select only among candidates the server validated, by server-assigned id. It has no payment tool and no price input. Unknown tools and out-of-phase calls are rejected and traced, and any model failure falls back to the deterministic path. The run record stores which path decided, and the UI labels it.

Google Gemini (Google Gen AI SDK) and an Anthropic adapter sit behind a provider-neutral interface. They are used for request parsing, offer explanations and reservation Q&A. Their answers pass a grounding check before display.

## PayPal integration
Authorization happens at approval, capture only after delivery is recorded, and void on failure. The app reads each provider state back before it shows CAPTURED or VOIDED.

Evidence, stated plainly (details in `docs/EVIDENCE.md`):
- Sandbox, 2026-11-06 (before the recovery work): one successful run through the app, with one capture confirmed by the provider and a matching FlexReceipt.
- Sandbox, 2026-11-07 (before the recovery work): an operator-injected outage, the authorization voided, no capture.
- Signed Sandbox webhooks were verified and processed for four event types.
- Recovery settlement has not been run in PayPal Sandbox. It needs the owner's approval.

## AI integration
The model never sets a price, consent, authorization, capture or void.

Live evidence (Gemini, 2026-11-05, free-tier key, synthetic fixtures, before the recovery work): four of four mandatory assistant cases answered by the model and accepted by the grounding check, with no fallbacks. A live recovery decision has not succeeded yet. One attempt returned HTTP 504, and the deterministic fallback ran. A retry needs separate approval.

## Challenges
- Keeping the AI away from money while still letting it help.
- Separating port occupancy from electrical flow, so a parked car still occupies its port.
- Making payment recovery crash-safe. The review findings were closed with regression tests.
- Making a disturbance re-plan respect what the driver already agreed, including energy already delivered and the price.

## Accomplishments
- Final combined-branch checks: TypeScript and ESLint clean; Vitest 740 passed, 12 skipped; Playwright 0 failed, 6 skipped; both production builds pass; release scan passes; no production dependency vulnerabilities reported by `npm audit`.
- The gated real-PostgreSQL tests passed on a disposable local PostgreSQL 18.1 server (11 passed, 1 skipped for the restart test).
- A recovery benchmark over 200 seeded synthetic nights, deterministic across runs. It reports unfavorable and infeasible cases next to the wins.

## What we learned
Authorization is a hold, not escrow. "Paid" has to mean the provider confirmed it. And a planning model needs a deterministic validator it cannot override.

## What's next
- Run the Gemini recovery retry and the Sandbox recovery settlement, after explicit approval.
- Apply migrations 003 to 005 to the hosted database, after a backup and the documented procedure.
- Real tariffs and charger telemetry. A measured pilot is needed before any claim about real savings or grid benefit.

## Honest limits
- Charging, tariffs, building load and forecasts are synthetic. No vehicle is charged.
- Savings are modeled from assumptions shown with each offer, not measured.
- The default payment provider is MOCK. Sandbox runs were limited to the evidence listed above.
- The recovery engine plans on forecast base load. Some recovered plans deliver less energy than the static plan under realized load (benchmark: 4 scenarios, reported).
- Bryntum's own grid has accessibility violations. The table beside the timeline is the accessible view.
- Demo sessions are pseudonymous. This is not production authentication.

## Built with
TypeScript, Next.js, React, PostgreSQL (PGlite embedded), PayPal REST (Sandbox), Google Gemini, Bryntum Scheduler Community 8.0.0, Playwright, Vitest, Zod.

## Links
- Repository: https://github.com/piyusha-sayal/gridwindow-flexpay
- Judge walkthrough (no credentials needed): `docs/JUDGES.md`
- Live demo URL: none. Judges run the app locally in MOCK mode.
- Demo video: none recorded. Do not link one until it exists.

## Judging criteria map

| Criterion | Evidence |
|---|---|
| Technology | Idempotent PayPal authorize, capture and void with reconciliation; lease-fenced recovery engine; independent validator; `docs/ARCHITECTURE.md`; `docs/AWARD_EVIDENCE.md` |
| Design | Driver wizard that contrasts immediate and flexible charging, shows assumptions and asks for explicit consent; operator timeline with accessible table; axe and keyboard e2e tests |
| Impact | Modeled only. 500-scenario synthetic benchmark (`artifacts/benchmark/summary.json`) and 200-seed recovery benchmark (`docs/RECOVERY_BENCHMARK.md`). No measured impact is claimed. |
| Innovation | Recovery inside agreed terms, AI limited to validated candidate ids, and payment that follows the delivered-energy ledger |
| Presentation | Walkthrough script `docs/DEMO_SCRIPT.md` (MOCK); screenshot checklist below |

## Screenshot checklist

Existing screenshots in `docs/screenshots/` predate this release. Capture new ones in MOCK mode, with seeded synthetic data:

- [ ] `/drive`: Guided demo open, Scenario C loaded, the offer comparison with assumptions visible
- [ ] `/drive`: approval step showing "mock provider" (not PayPal)
- [ ] `/reservations/<id>`: authorized, not captured, status text
- [ ] `/operator`: Synthetic disturbance panel with attribution group and a recorded disturbance
- [ ] `/operator`: Scenario C recovery steps (seven steps with their labels)
- [ ] `/operator/schedule`: chart with Original plan and Current (recovered) lanes, and the table beside it
- [ ] `/reservations/<id>` with a pending proposal ("Needs your approval"), if a run reaches that state
- [ ] FlexReceipt showing SIMULATED_EVENT and the MOCK provider label

Do not crop out the MOCK or SIMULATED labels.

## Claims we do not make

- That a real vehicle, charger or grid was involved.
- That any saving, peak reduction or grid benefit is measured. All numbers are modeled or synthetic.
- That a live Gemini model made a recovery decision.
- That PayPal Sandbox recovery settlement has been run.
- That Bryntum's timeline is accessible.
- That the app is production-ready, or that it is a commercial charging deployment.
- That a demo video exists, or that a live demo URL is available.
- That the Bryntum Community license text inside the package has been checked.
- That Neon has the recovery migrations applied.
