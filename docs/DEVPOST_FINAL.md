# Devpost submission draft (replaces the stale `docs/DEVPOST.md` figures)

Items in [BRACKETS] are for the owner to confirm from their own records. Nothing here claims a live integration that has no evidence in this repository.

## Title
GridWindow FlexPay: a charging promise that repairs itself, safely

## Tagline
When a charger slows down, an agent-style recovery workflow finds a fix, a deterministic validator proves it, the driver consents if needed, Bryntum shows the new schedule, and money moves only after energy is delivered.

## Inspiration
Overnight charging sites cap total power, so drivers are offered cheaper flexible windows. That only works if the driver trusts the promise: if the charger slows or fails, the schedule must be repaired honestly and nobody should pay for energy they did not get.

## What it does
1. A driver asks for energy, a ready-by time and a budget. The server finds feasible schedules under the station's power cap and publishes an offer only if the driver saves and the operator still earns.
2. The driver approves one exact offer. Payment is an authorization hold, not a charge.
3. An operator records a disturbance (SYNTHETIC in the demo): charger power limit, site cap cut, early departure or charger failure.
4. A durable recovery run starts automatically. It requests candidate fixes, validates each with the deterministic engine, and either commits a change inside pre-approved bounds or asks the driver to approve the exact proposal. A model, when configured, may only select among validated options; without one, a labelled deterministic path decides.
5. The Bryntum Scheduler shows the original plan, the pending proposal and the committed version, read from the database, and the result survives a reload.
6. Charging is simulated. Capture happens once after delivery is recorded; an operator-attributable failure voids the hold; other shortfalls go to the operator. FlexReceipt explains every step.

## How we built it
Next.js and strict TypeScript; an integer-unit domain engine with an independent validator; PostgreSQL (embedded PGlite for judges) with append-only schedule versions; fenced durable workers; PayPal Orders v2 / Payments v2 integration with idempotency keys, compare-and-set settlement, provider read-back, reconciliation and signed-webhook verification; the Bryntum Community Scheduler 8.0 for the operator timeline; Gemini behind a provider-neutral interface with no payment tools. Architecture: `docs/ARCHITECTURE_SUMMARY.md`.

## Bryntum
Real `@bryntum/scheduler-community` 8.0.0 (MIT, license text verified in the installed package). It renders persisted allocations per port, original versus recovered plans, pending proposals in a separate lane, and updates by polling without reload. An accessible table carries the same data. Evidence and honest vendor accessibility findings: `docs/BRYNTUM_EVIDENCE.md`.

## Agentic commerce
An event-driven, durable, resumable workflow with a bounded tool set, deterministic validation, consent enforcement, lease-fenced commits and a persisted trace. Decision sources are labelled in every record (`REAL_GEMINI`, `MOCK_GEMINI`, `DETERMINISTIC_FALLBACK`). Evidence: `docs/AGENTIC_COMMERCE_EVIDENCE.md`. [Add a REAL_GEMINI statement only if the certification in that file has been run and passed.]

## PayPal + AI
The AI has no payment capability: no tool, no price, no consent, no capture or void. Settlement follows the delivered-energy ledger with one provider operation per reservation, provider read-back before any "paid" or "voided" label, and signed-webhook verification. Independently re-verified locally on the MOCK provider; the exact Sandbox capture/void procedure is in `docs/PAYPAL_AI_EVIDENCE.md`. [State Sandbox results here only from your own provider read-backs.]

## Verification
Independent QA on the final build: 668 Vitest tests (10 env-gated skips), 99 Playwright checks (6 desktop-only skips) on desktop, tablet and mobile with axe, TypeScript and ESLint clean, production dependency audit with 0 vulnerabilities, release scan clean, deterministic benchmark. Security regression tests cover authorization boundaries, webhook forgery, duplicate settlement, concurrent commits, prompt injection and hostile model output. Report: `docs/QA_INDEPENDENT_REPORT.md`.

## Impact (synthetic model, not measured)
In a seeded model of 485 flexible charges under 12 kinds of disturbance, rescheduling repaired 15 % of disturbed cases (704 of 4,672) and raised modeled delivered energy by 2.6 % when drivers approved. Charger failures (1,455 of 1,455) cannot be repaired, and the system handles them by not charging the driver. Recovery delivered slightly less than keeping the plan in three scenarios (seeds 91, 134, 152: 50, 3 and 15 Wh). See `docs/IMPACT_SUMMARY.md`.

## Challenges
Keeping the AI away from money; separating forecast energy from delivered energy; making a recovery commit safe under concurrency and crashes; telling the truth about what is simulated.

## What we learned
Authorization is not escrow. "Recovered" must mean validated and consented, not merely proposed. A fallback must never be dressed up as a model decision.

## Honest limitations
- All charging, tariffs, loads and disturbances are synthetic; no real charger or grid data.
- Demo payments use a mock provider. [PayPal Sandbox evidence only as confirmed from your own records.]
- No live Gemini decision is demonstrated unless the certification has been run. An earlier live attempt returned HTTP 504 and is not evidence of a model decision.
- Most severe disturbances (all charger failures) are physically unrecoverable; the benefit is honest handling, not rescue.
- The Bryntum time axis follows the browser's time zone, not the station's (QA-3); the table and labels use the station zone. Bryntum's own markup has three axe findings (one critical, two serious); the table is the accessible alternative.
- The timeline is read-only; changes are made by the engine, never by dragging.
- Operator-login rate limiting shares one bucket unless `TRUST_PROXY=true` (QA-2).

## What's next (future work)
Fix QA-3 and QA-2; real tariff and charger telemetry; a measured pilot before any savings claim; REAL_GEMINI and Sandbox certification runs; live merchant onboarding (out of scope for the hackathon).

## Built with
TypeScript, Next.js, React, Bryntum Scheduler (Community), PostgreSQL / PGlite, PayPal REST (Sandbox), Google Gemini, Zod, Playwright, Vitest.

## Video
Under 3 minutes, script in `docs/FINAL_DEMO_SCRIPT.md`. [Add the URL only after the owner records and publishes it.]
