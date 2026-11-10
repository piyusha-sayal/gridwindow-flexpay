# Devpost submission draft (replaces the stale `docs/DEVPOST.md` figures)

Final submission text. Every sentence is limited to what the repository, the tests and the captured screenshots support. Statements that would need live Gemini or PayPal Sandbox proof are written in their evidence-free form; the owner-decision checklist at the end says what to upgrade, and when. Not submitted.

## Title
GridWindow FlexPay: repairing disrupted EV charging promises, safely and honestly

## Central differentiation
Constraint-aware EV charging recovery combined with explicit customer consent and verifiable financial settlement: a disrupted charging promise is repaired only with a plan the deterministic engine has proven valid, only within what the driver consented to, and money moves only on delivered-energy evidence.

## Tagline
When a charger slows down, a recovery workflow looks for a valid fix (not every disruption can be repaired), a deterministic validator proves it, the driver consents if needed, Bryntum shows the new schedule, and money moves only after energy is delivered.

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
An event-driven, durable, resumable workflow with a bounded tool set, deterministic validation, consent enforcement, lease-fenced commits and a persisted trace. Decision sources are labelled in every record (`REAL_GEMINI`, `MOCK_GEMINI`, `DETERMINISTIC_FALLBACK`). Evidence: `docs/AGENTIC_COMMERCE_EVIDENCE.md`. In the demonstrated runs no model key is configured, so recovery decisions are the labelled deterministic path; a live-model certification procedure is prepared but has not been run.

## PayPal + AI
The AI has no payment capability: no tool, no price, no consent, no capture or void. Settlement follows the delivered-energy ledger with one provider operation per reservation, provider read-back before any "paid" or "voided" label, and signed-webhook verification. Independently re-verified locally on the MOCK provider; the exact Sandbox capture/void procedure is in `docs/PAYPAL_AI_EVIDENCE.md`. The Sandbox capture and void certification procedure is prepared and has not been run for this build.

## Verification
Independent QA on the final build: 668 Vitest tests (10 env-gated skips), 99 Playwright checks (6 desktop-only skips) on desktop, tablet and mobile with axe, TypeScript and ESLint clean, production dependency audit with 0 vulnerabilities, release scan clean, deterministic benchmark. Security regression tests cover authorization boundaries, webhook forgery, duplicate settlement, concurrent commits, prompt injection and hostile model output. Report: `docs/QA_INDEPENDENT_REPORT.md`.

## Impact (synthetic model, not measured)
In a seeded model of 485 flexible charges under up to 12 kinds of disturbance (4,672 disturbed scenarios), rescheduling reached the energy target in 704 (15 %), 592 of them only by finishing later than agreed with the driver's consent, and raised modeled delivered energy by 2.6 % when drivers approved. Charger failures (1,455 of 1,455) cannot be repaired, and the system handles them by not charging the driver. Recovery delivered slightly less than keeping the plan in three scenarios (seeds 91, 134, 152: 50, 3 and 15 Wh). See `docs/IMPACT_SUMMARY.md`.

## Challenges
Keeping the AI away from money; separating forecast energy from delivered energy; making a recovery commit safe under concurrency and crashes; telling the truth about what is simulated.

## What we learned
Authorization is not escrow. "Recovered" must mean validated and consented, not merely proposed. A fallback must never be dressed up as a model decision.

## Honest limitations
- All charging, tariffs, loads and disturbances are synthetic; no real charger or grid data.
- Demo payments use a mock provider; no PayPal Sandbox transaction is shown in the demo or claimed for this build.
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
Under 3 minutes, script in `docs/FINAL_DEMO_SCRIPT.md`. (URL to be added by the owner after recording and approving it; none exists yet.)

---

## Claims audit (what supports each statement)

| Criterion | Claim | Support | Status |
|---|---|---|---|
| Technology | Fenced, durable recovery runs; deterministic validator; one provider operation per reservation; lease and version fencing | `commitFencing.test.ts`, `independent-security.test.ts`, `recoveryOrchestrator.test.ts` | PASS |
| Technology | Schema safety: external databases are never migrated at startup | `migrationSafety.test.ts` (12), commit `f089afc` | PASS |
| Technology | 668 Vitest and 99 Playwright checks pass on the QA-certified build | `artifacts/qa/final` logs of 2026-11-09 on the code at `e066bdf` (this update only adds tests and docs) | PASS (re-certify on the final commit) |
| Design | Driver sees what changes and what does not, the price is unchanged, consent is explicit and expiring | `03-agent-recommendation-needs-consent.png`, `recoveryDriver.spec.ts` | PASS |
| Design | Accessible alternative to the timeline | table + axe, `independent-bryntum-a11y.spec.ts` | PASS (vendor timeline has 3 disclosed axe findings) |
| Impact | Figures are synthetic model results with stated denominators | `docs/IMPACT_SUMMARY.md`, `independent-benchmark-breakdown.test.ts` | PASS (synthetic only) |
| Innovation | Consent-bounded autonomous recovery tied to delivered-energy settlement | architecture + tests above | PASS |
| Bryntum | Real Community Scheduler 8.0.0, persisted data, updates without reload, survives reload | `BRYNTUM_EVIDENCE.md`, screenshots 01 to 06 | PASS (QA-3, QA-6 disclosed) |
| Agentic Commerce | Event-driven durable agent workflow with bounded tools | `AGENTIC_COMMERCE_EVIDENCE.md` | PASS for MOCK_GEMINI and DETERMINISTIC_FALLBACK |
| Agentic Commerce | A live Gemini model made the decisions | no evidence | NOT CLAIMED |
| PayPal + AI | AI cannot touch money; settlement follows delivered energy | tool allowlist tests, 0 gateway calls asserted | PASS (MOCK provider) |
| PayPal + AI | PayPal Sandbox capture and void verified | none for this build in this repository | NOT CLAIMED |
| Presentation | Under-3-minute video | script and package ready; no video exists | NEEDS USER APPROVAL |

Claims removed or softened from the older `docs/DEVPOST.md`: "344 tests and 67 Playwright checks" (stale), the PayPal Sandbox and live-Gemini evidence paragraphs (their artifacts are git-ignored and not in this repository, so they could not be re-verified), and any wording that implies the AI decides money.

## Owner-decision checklist (cannot be established from the repository)
1. **Hackathon requirements**: confirm the official rules (video length and hosting, repository visibility, required fields, team size, eligibility, whether a live demo URL is required, submission deadline and time zone). The QA brief gave a deadline of 2026-11-12 12 PM Pacific; no rules document is in the repository.
2. **Team**: names, roles and Devpost accounts for the "built by" section (Satyam and Piyusha are working in separate branches; confirm who is listed).
3. **Earlier PayPal Sandbox and live-Gemini results**: if you hold the original artifacts, decide whether to cite them with dates and redacted ids. If not, leave them out. Do not cite them from memory.
4. **Live certification**: decide whether to run `docs/LIVE_CERTIFICATION_HANDOFF.md` Part 1 (Gemini) and Part 2 (PayPal). Only after a passing run, change the two "NOT CLAIMED" rows and the matching sentences.
5. **Video**: record from `docs/DEMO_RECORDING_PACKAGE.md`, review, then upload and add the URL yourself.
6. **Bryntum license**: confirm the Community package (MIT text in the installed package) is the edition you intend to claim.
7. **QA-4 and QA-5 wording fixes** appear on screen in the demo; decide whether to authorize them before recording (recommended).
8. **Repository link and README**: confirm which branch or merged main the judges will see, and that the final integrated commit is the one certified.
9. **Screenshots**: choose which of `docs/evidence/` to upload as the gallery (suggested: 20, 03b, 05, 06, 14).
