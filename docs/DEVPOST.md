# Devpost submission text

## Title
GridWindow FlexPay: consented flexible EV charging, settled safely with PayPal

## Tagline
An AI helps drivers pick a cheaper overnight charging window; a deterministic engine proves it works for both sides; PayPal holds the money until delivery is verified.

## Inspiration
Overnight charging sites cap total power, yet drivers plug in and wait with no incentive to shift. Flexibility only works if drivers trust the deal and the money stays safe if service fails.

## What it does
A driver says what energy they need, when they leave and a spending cap (typed or in plain language). The server finds physically feasible schedules under the station's power cap, publishes only offers where the driver saves money *and* the operator's modeled contribution improves, and shows the assumptions. The driver approves one exact offer. PayPal **authorizes** the amount; a transparent synthetic simulator runs the night; the app **captures once** after verified delivery or **voids** on outage. FlexReceipt joins terms, synthetic delivery and PayPal-confirmed state.

## How we built it
Next.js + strict TypeScript; pure integer-unit domain engine with an independent validator; PayPal Orders v2 / Payments v2 (authorize, capture, void) with idempotency keys, compare-and-set state machine, reconciliation and signed-webhook verification; PostgreSQL (embedded PGlite for judges). Gemini (Google Gen AI SDK; an Anthropic adapter is also implemented) parses requests, explains backend-computed offers and answers questions about the driver's own reservation. It has no tools, never sets a price, and a grounding filter rejects unknown numbers and unconfirmed payment claims.

## PayPal integration
Authorize at approval, capture only after delivery, void on failure; provider read-back before any `CAPTURED`/`VOIDED` label. Genuine Sandbox evidence: standalone capture PASS and void PASS (2026-10-30, USD 1.23). Through the app (2026-11-06, Sandbox, synthetic delivery): driver consent, PayPal buyer approval, authorization, one capture confirmed by the provider (GET capture COMPLETED, USD 14.82) and a FlexReceipt that matches the provider. Signed webhooks: three authentic PayPal events (order approved, authorization created, capture completed) verified against the raw body, correlated and processed once. Outage-and-void through the app (2026-11-07): after authorization an operator-injected synthetic charger outage failed delivery (0 kWh), the app voided the authorization once (provider status VOIDED, no capture, $0 collected), and PayPal's PAYMENT.AUTHORIZATION.VOIDED webhook was verified and processed. Four webhook event types in total were verified live.

## AI integration
Gemini (`gemini-3.6-flash`, Google Gen AI SDK) behind a provider-neutral interface, for request parsing, offer explanation, own-reservation Q&A and a goal-aware Flex Deal Agent (server-orchestrated, read-only). The model has no tools and never sets a price, consent, authorization, capture or void; every number it writes is checked against backend facts and replaced by deterministic text on any mismatch. Live evidence (2026-11-05, free-tier key, synthetic fixtures only): 1 metadata preflight and 5 generation requests, 5 provider responses, 4 of 4 mandatory cases passed with a genuine model answer that the backend validated (request parsing, offer explanation, reservation Q&A, prompt-injection probe), 0 deterministic fallbacks, 0 grounding failures, 2,063 input and 548 output tokens, cost computed as $0 at the free-tier price (not checked against a billing statement). An earlier live run on the same day was not certified (one provider error, three rejected answers); the fixes and the stricter certification report are in the repository. Offline scripted-model tests cover prompt injection, hallucinated numbers, refusals, quota and outage. An Anthropic adapter exists but has not been run live.

## Challenges
Keeping AI away from money; port occupancy vs electrical flow; crash-safe payment recovery (ten review findings closed with regression tests).

## Accomplishments
344 unit/integration tests and 67 Playwright checks (axe, keyboard, three viewports) pass, plus a certified live Gemini run on synthetic fixtures; 500-scenario seeded benchmark with 0 physics violations: optimized mean 537¢ vs immediate 1201¢ (synthetic).

## What we learned
Authorization is not escrow; "paid" must mean provider-confirmed.

## What's next
Real tariffs and charger telemetry, measured pilots, live merchant onboarding (out of scope: sandbox only).

## Honest limits
Synthetic tariffs and simulated delivery; no measured grid benefit; sandbox money only.

## Built with
TypeScript, Next.js, React, PostgreSQL/PGlite, PayPal REST (Sandbox), Google Gemini, Playwright, Vitest, Zod.

## Judging criteria map (equal weight)

| Criterion | Evidence |
|---|---|
| Technology | Idempotent PayPal authorize/capture/void with reconciliation; independent validator; `docs/ARCHITECTURE.md`; tests listed above; evidence `docs/EVIDENCE.md` |
| Design | Driver wizard that contrasts immediate vs flexible, shows assumptions, explicit consent; operator console; axe + keyboard e2e (`tests/e2e/qa.spec.ts`) |
| Impact | Peak 17.6 kW vs 22.1 kW immediate, congested requests 91 vs 826, cheaper in 1183/1245 pairs, worse in 62 (synthetic, `artifacts/benchmark/summary.json`) |
| Innovation | Win-win-gated offers + AI that cannot touch money + provider-truth receipts |
| Presentation | demo video of at most 2:55; judge quickstart `docs/JUDGES.md` (no credentials) |
