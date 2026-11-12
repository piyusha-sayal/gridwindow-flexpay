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

## Recovery demo evidence: November 23 and 25, 2026 reservations

The following are the **two selected demo reservations**, grouped by their **scheduled charging nights**, not by the date on which synthetic test actions were run. Both use the deployed application's PayPal Sandbox integration and synthetic charging. Event-trail times below are **UTC**. These records do **not** show physical EV charging on the future reservation dates. The first recovery has been completed and paid; the second is **infeasible and awaiting an operator's planned outage/void action**.

| Reservation | What happened | Result |
|---|---|---|
| **…UPH4LQBJ, November 23-24, Port B, 19:00-07:00, target 30.00 kWh** | The driver accepted the offer at **00:33:28 UTC**; the PayPal Sandbox order was created at 00:33:29, buyer approval recorded at 00:33:47 and authorization recorded at **00:33:49**. The operator recorded a **synthetic charger power reduction** at **00:34:24**. The changed schedule required **manual driver consent**, and the driver-facing page confirms *"Approved by you and applied."* The event trail records SCHEDULE_VERSION_COMMITTED at **00:36:01** and synthetic SERVICE_DELIVERED at **00:36:32**. Actual simulated battery delivery was **30.02 kWh** against the 30.00 kWh target; the original **$13.04** agreed price did not change. | **SUCCESSFUL RECOVERY: DRIVER APPROVED; CAPTURED.** PayPal Sandbox evidence shows CAPTURED · COMPLETED at **00:36:37 UTC**, followed by WEBHOOK_VERIFIED at **00:36:48**. FlexReceipt **FR-UPH4LQBJ** confirms **$13.04 paid** after **30.02 kWh** simulated delivery. The schedule change was committed; the numeric schedule version is not independently visible in the supplied event-trail screenshot. |
| **…8HJE8VFM, November 25-26, Port B, 19:00-07:00, target 30.00 kWh** | The driver accepted the offer at **00:38:56 UTC**; the PayPal Sandbox order was created at 00:38:58, buyer approval recorded at 00:39:06 and authorization recorded at **00:39:08**. The operator recorded a **synthetic charger power reduction** at **00:39:40**, effective from slot 0. Recovery validation found **INFEASIBLE**: at the reduced power, the remaining energy could not be delivered before departure. The deterministic fallback made **no model decision**; the original schedule stayed unchanged, **no new schedule version** was written and **no driver consent** was requested. OPERATOR_RESOLUTION_REQUIRED was recorded at **00:39:57**. | **INFEASIBLE: AWAITING OPERATOR RESOLUTION / VOID.** The driver's page shows AUTHORIZED HOLD · NOT CAPTURED for **$13.03**, **0.00 kWh** delivered at the time of the screenshot, and **$0.00 collected so far**. Recovery step 6 (Financial outcome) and step 7 (FlexReceipt) are **WAITING**. **A completed void is not yet evidenced for this reservation.** |

### What these two demo cases prove

- *Driver-controlled recovery:* The first reservation demonstrates that a materially changed, feasible schedule is not silently committed. The driver approved the proposed change before the schedule was committed. The agreed price remained $13.04.
- *Settlement follows simulated delivery:* In the first case, SERVICE_DELIVERED precedes the provider-reported capture and verified webhook. The FlexReceipt shows the same $13.04 total and 30.02 kWh delivered.
- *No fictional recovery:* In the second case, the recovery engine explicitly refused a physically infeasible schedule, preserved the original plan, and reported that operator resolution was required. An infeasible plan does *not* itself prove a payment void.
- *Evidence scope:* These findings come from the supplied screenshots of the driver reservation pages, FlexReceipt, recovery steps, application-displayed provider evidence and event trails. A separate raw PayPal API/DB GET reconciliation record for these *exact two* reservations was not supplied with this update. Prior provider-level verification in other sections should not be attributed to these reservations.

### Planned live demo step: second reservation

During the demo, the operator plans to use *Inject outage* for …8HJE8VFM and show the zero-delivery failure/void path. *Do not change this evidence to VOIDED until the same reservation displays a PayPal Sandbox provider-confirmed void* (ideally with a corresponding event, webhook verification and final $0.00-collected receipt). The legacy outage action may not support an already-infeasible reservation; if it fails, label the result as *awaiting operator resolution* rather than claiming a void took place.

Judges can navigate to the two *future charging dates* in the operator schedule, open each reservation's *Recorded disturbances* and inspect the seven recovery steps. The first case shows consent → committed plan → simulated delivery → capture; the second shows validation → infeasible outcome → unchanged schedule → pending financial resolution.

## Signed webhooks

The general webhook verification below covers previously documented provider tests. It should *not* be read as evidence that the November 25 reservation has already been voided.

A Sandbox webhook subscribed to seven event types delivered, and the application verified (PayPal `verify-webhook-signature` over the unaltered raw body), correlated and durably processed, four event types: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.AUTHORIZATION.VOIDED`. Each processed event matched PayPal's own event record by event ID, was linked to its reservation, and caused no duplicate financial operation: money state is always read back from the PayPal API, never taken from the webhook body.

Honest note: the first two events were initially delivered to a webhook registered without the `/api/webhooks/paypal` path and were therefore not processed. After the registered URL was corrected, each of those two events was resent once and processed. The capture and void events arrived on their own.

Not tested live: refund and dispute events (not handled by design), a PENDING or DECLINED capture against the real provider (covered by the offline provider fake and the MOCK provider), and long-term webhook delivery (the tunnel used was temporary).

## Gemini

One live run on 2026-11-05 with a free-tier key and synthetic fixtures only: model `gemini-3.6-flash` through the Google Gen AI SDK, one metadata preflight and five generation requests, five provider responses, four of four mandatory cases answered by the model and accepted by the backend's grounding validator (request parsing, offer explanation, reservation Q&A, prompt-injection probe), zero deterministic fallbacks, zero grounding failures, 2,063 input and 548 output tokens. Cost is computed as USD 0 at the free-tier price and was not checked against a billing statement. An earlier run the same day was not certified (one provider error and three rejected answers); the causes were fixed and the stricter certification report is in the repository.

The model has no tools. It never sets a price, consent, authorization, capture or void, and any answer containing a number or payment claim the backend cannot confirm is replaced by deterministic text.

## Automated tests

On the submitted code: TypeScript strict check and ESLint clean; Vitest 1,023 passed and 12 skipped (the skipped suite needs a disposable PostgreSQL server, see [SKIPPED_TESTS.md](SKIPPED_TESTS.md)); Playwright 114 passed on desktop, 14 on mobile and 3 on tablet, with 6 desktop-only keyboard journeys skipped on the smaller devices; production build and secret scan pass; `npm audit --omit=dev` reports 0 vulnerabilities. All of these run with the MOCK provider and a throwaway database, so they never call PayPal or a model.

## Known limits

- Tariffs, fees, building load, forecast and delivery are synthetic assumptions. The benchmark (500 seeded scenarios) compares policies on synthetic data and is not a measured saving.
- A PayPal authorization is not escrow. The honor period is three days and the lifetime up to 29 days; the application does not capture after expiry.
- Free-tier Gemini traffic may be used by Google to improve its products: do not enter personal data into the assistant.
- Operator and driver identities are pseudonymous demo sessions, not production authentication.
