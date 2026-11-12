# Verified integration evidence (sanitized)

This page summarizes what was actually run against the genuine PayPal Sandbox and a genuine Gemini model, and what was not. PayPal identifiers are left out; reservations are named by the last eight characters of their app ID. All payments are PayPal **Sandbox** transactions; no live money moved. Charging is a **synthetic simulation**: no vehicle was charged, and no real-world energy, grid or cost-saving benefit is claimed.

Method: after each run, the team read the application database inside a read-only transaction and queried PayPal with `GET` requests only (authorization, capture, order, webhook registration and webhook event log), then compared the two. Redacted raw artifacts are kept by the team and can be provided on request.

## PayPal Sandbox through the application

| Scenario | Date | What happened | Result |
|---|---|---|---|
| A. Successful charging (not backed by an artifact in the reviewed `artifacts/` directory; not re-verified in the 2026-11-09 audit) | 2026-11-06 | Driver consent to exact terms, PayPal buyer approval, authorization of USD 14.82, synthetic delivery of 30.015 kWh against a 30 kWh target, one capture of USD 14.82 | Provider authorization status CAPTURED, capture COMPLETED and tied to that authorization, one CAPTURE operation, reservation CAPTURED, FlexReceipt shows "capture confirmed by provider" |
| B. Charging outage (not backed by an artifact in the reviewed `artifacts/` directory; not re-verified in the 2026-11-09 audit) | 2026-11-07 | Same approval flow, authorization of USD 14.19, operator-injected synthetic outage, 0 kWh delivered, run FAILED | Provider authorization status VOIDED, exactly one VOID operation, no capture, USD 0.00 collected, reservation VOIDED, FlexReceipt "Not charged. Authorization voided by provider (bank hold removal may take time)" |
| Standalone smoke test (historical, not linked to the recovery work) | 2026-10-30 | One authorize → capture and one authorize → void of USD 1.23 each, two separate orders | Passed. Artifacts: `artifacts/paypal-smoke-capture-only-smoke_1793370835421.json` (capture COMPLETED, authorization CREATED before capture) and `artifacts/paypal-smoke-void-only-smoke_1793372411617.json` (authorization VOIDED after void). Sandbox host and USD 1.23 confirmed in both. Approval identity and request-ID values are not recorded. Details: `docs/PAYPAL_CERTIFICATION.md` section 0. |

The orders were approved on PayPal's Sandbox page with a Sandbox personal (buyer) account; for scenario A the approving account was confirmed to differ from the Sandbox business (merchant) account. Before every authorization the application compares the order's payee to the configured merchant, and the amount, currency and custom ID to the stored terms; mismatches stop before authorization.

On the deployed build, the team also ran one capture (`…H62XfQtp`) and one void (`…C2afKCrn`) of USD 15.56 each. Both were read back from the PayPal Sandbox API after the 2026-11-11 deploy, with signature-verified webhooks. See [the release verification](FINAL_RELEASE_VERIFICATION_2026-11-11.md).

## Recovery followed by PayPal Sandbox settlement (2026-11-11)

Two bookings on the deployed site went through a recorded disturbance and then settled in PayPal Sandbox. We read them back through the operator API (GET requests only) the same day. Times are UTC, and both bookings are on the night of 2026-11-12.

| Reservation | What happened | Result |
|---|---|---|
| `…n-qKqgUM` | Order, buyer approval and authorization in PayPal Sandbox at 19:09. At 19:09:57 the operator recorded a SYNTHETIC charger disturbance, with fault attribution left as UNKNOWN. The recovery run needed the driver's consent; the driver approved, and schedule version 2 was committed at 19:10:41. Synthetic delivery then recorded 30.015 kWh against a 30 kWh target. | Capture COMPLETED at 19:10:59, read from the PayPal Sandbox API. Webhook verified at 19:11:17. Run COMMITTED, consent DRIVER_APPROVED. |
| `…kfgzxjBp` | Order, approval and authorization at 19:05 to 19:06. At 19:07:23 the operator recorded a SYNTHETIC disturbance and marked the operator as responsible. The recovery run found no feasible schedule (INFEASIBLE). Because the operator was responsible and nothing could fix it, the app marked the service failed and decided to void. | Void at 19:07:32, read from the PayPal Sandbox API. Webhook verified at 19:09:21. Nothing captured. |

Judges with operator access can open both under **Recorded disturbances** on that night and read the seven recovery steps from the stored run.

## Two more recovery runs, and why an infeasible recovery is not a void (2026-11-12 UTC)

Two more Sandbox bookings went through a recorded SYNTHETIC charger power reduction, each on its own night. They were run on the afternoon of 2026-11-11 Pacific time, which is 2026-11-12 in UTC. We read them back through the operator API (GET requests only) at 01:16 UTC. Times below are UTC on 2026-11-12. Both agent runs ended as DETERMINISTIC_FALLBACK (no model decision). Reservations are given by their full app ID here, so you can find them in the operator console.

| Reservation | What happened | Result |
|---|---|---|
| `res_42W3op4GUph4lqbj` (night 2026-11-23, Port B, $13.04) | Order, buyer approval and authorization in PayPal Sandbox at 00:33. At 00:34:24 the operator recorded the disturbance, with fault attribution OPERATOR. The recovery needed the driver's consent; the driver approved, and schedule version 2 was committed at 00:36:01. Synthetic delivery then recorded 30.015 kWh against a 30 kWh target. | Capture COMPLETED for $13.04 at 00:36:37, read from the PayPal Sandbox API. Webhook verified at 00:36:48. Run COMMITTED, consent DRIVER_APPROVED. |
| `res_cg6ud43I8hjE8VfM` (night 2026-11-25, Port B, $13.03) | Order, approval and authorization in PayPal Sandbox at 00:38 to 00:39. At 00:39:40 the operator recorded the disturbance, with fault attribution UNKNOWN. The recovery run found no feasible schedule (INFEASIBLE): at the reduced charger limit, the remaining energy cannot be delivered before departure. The schedule stayed at version 1. At 00:39:57 the app recorded OPERATOR_RESOLUTION_REQUIRED. | The $13.03 authorization is held (payment state AUTHORIZED, service state SCHEDULED). $0.00 captured. No void and no capture is recorded. |

The second row is the state at 01:16 UTC, not a final outcome. Under the settlement policy an operator has to decide it. If it is settled later, that will appear as new events and a new PayPal proof on the reservation.

### An infeasible recovery is not a void

The recovery engine decides only whether a valid schedule exists. What happens to the payment is decided separately, by the settlement policy (`OPERATOR_FAILURE_FULL_VOID_V1`) and the fault attribution the operator recorded with the disturbance. Two live Sandbox reservations show the difference:

| Reservation | Recovery result | Attribution | What the app did with the money |
|---|---|---|---|
| `…kfgzxjBp` (night 2026-11-12) | INFEASIBLE | OPERATOR | Marked the service failed and decided to void at 19:07:30 on 2026-11-11 UTC. The authorization was VOIDED at 19:07:32, nine seconds after the disturbance was recorded. Nothing captured. |
| `res_cg6ud43I8hjE8VfM` (night 2026-11-25) | INFEASIBLE | UNKNOWN | Recorded OPERATOR_RESOLUTION_REQUIRED. The authorization is held. Nothing captured or voided. |

A full void needs a confirmed operator failure: attribution OPERATOR, a conclusive recovery result (INFEASIBLE, or FAILED on every attempt) and no driver-requested departure. An UNKNOWN, DRIVER or EXTERNAL attribution never voids and never captures automatically. It goes to the operator, with a stored resolution deadline 24 hours out. When that deadline passes, the app only marks the flag overdue, and no money moves either way. The rule is in `src/domain/outdatedSession.ts`, with tests in `tests/integration/attributionSettlement.test.ts`.

The **Inject outage** button is a third, separate path: a synthetic charging run with an outage injected by the operator, so nothing is delivered and the authorization is voided. It is not what an infeasible recovery does. The server also refuses that run, and **Run the synthetic overnight charge**, on a reservation whose schedule a recorded disturbance has outdated while no valid recovery is committed (`PLAN_OUTDATED`: "A valid recovery must be committed before charging can be simulated"). `tests/integration/recoveryOrchestrator.test.ts` covers this.

Judges with operator access can open the nights 2026-11-23 and 2026-11-25 with the **Night of** picker and read the seven recovery steps for each from the stored run.

## Signed webhooks

A Sandbox webhook subscribed to seven event types delivered, and the application verified (PayPal `verify-webhook-signature` over the unaltered raw body), correlated and durably processed, four event types: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.AUTHORIZATION.VOIDED`. Each processed event matched PayPal's own event record by event ID, was linked to its reservation, and caused no duplicate financial operation: money state is always read back from the PayPal API, never taken from the webhook body.

Honest note: the first two events were initially delivered to a webhook registered without the `/api/webhooks/paypal` path and were therefore not processed. After the registered URL was corrected, each of those two events was resent once and processed. The capture and void events arrived on their own.

Not tested live: refund and dispute events (not handled by design), a PENDING or DECLINED capture against the real provider (covered by the offline provider fake and the MOCK provider), and long-term webhook delivery (the tunnel used was temporary).

## Gemini

One live run on 2026-11-05 with a free-tier key and synthetic fixtures only: model `gemini-3.6-flash` through the Google Gen AI SDK, one metadata preflight and five generation requests, five provider responses, four of four mandatory cases answered by the model and accepted by the backend's grounding validator (request parsing, offer explanation, reservation Q&A, prompt-injection probe), zero deterministic fallbacks, zero grounding failures, 2,063 input and 548 output tokens. Cost is computed as USD 0 at the free-tier price and was not checked against a billing statement. An earlier run the same day was not certified (one provider error and three rejected answers); the causes were fixed and the stricter certification report is in the repository.

The model has no tools. It never sets a price, consent, authorization, capture or void, and any answer containing a number or payment claim the backend cannot confirm is replaced by deterministic text.

On 2026-11-11 the deployed build answered request parsing, the deal agent and the offer explanation from Gemini (3 of 3 calls in the production smoke test), with Gemini 3.5 Flash-Lite and a free OpenRouter model as backups.

## Automated tests

On the submitted code: TypeScript strict check and ESLint clean; Vitest 1,023 passed and 12 skipped (the skipped suite needs a disposable PostgreSQL server, see [SKIPPED_TESTS.md](SKIPPED_TESTS.md)); Playwright 114 passed on desktop, 14 on mobile and 3 on tablet, with 6 desktop-only keyboard journeys skipped on the smaller devices; production build and secret scan pass; `npm audit --omit=dev` reports 0 vulnerabilities. All of these run with the MOCK provider and a throwaway database, so they never call PayPal or a model.

## Known limits

- Tariffs, fees, building load, forecast and delivery are synthetic assumptions. The benchmark (500 seeded scenarios) compares policies on synthetic data and is not a measured saving.
- A PayPal authorization is not escrow. The honor period is three days and the lifetime up to 29 days; the application does not capture after expiry.
- Free-tier Gemini traffic may be used by Google to improve its products: do not enter personal data into the assistant.
- Operator and driver identities are pseudonymous demo sessions, not production authentication.

## Final release evidence (2026-11-11)

Screenshots with an evidence manifest, live PayPal Sandbox capture and void read-backs, SDK, MCP and OpenRouter run records: `docs/evidence/final-release-2026-11-11/`. Report: `docs/FINAL_RELEASE_VERIFICATION_2026-11-11.md`.
