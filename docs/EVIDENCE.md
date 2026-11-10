# Verified integration evidence (sanitized)

This page summarizes what was actually run against the genuine PayPal Sandbox and a genuine Gemini model, and what was not. Provider identifiers are intentionally omitted. All payments are PayPal **Sandbox** transactions; no live money moved. Charging is a **synthetic simulation**: no vehicle was charged, and no real-world energy, grid or cost-saving benefit is claimed.

Method: after each run, the team read the application database inside a read-only transaction and queried PayPal with `GET` requests only (authorization, capture, order, webhook registration and webhook event log), then compared the two. Redacted raw artifacts are kept by the team and can be provided on request.

## PayPal Sandbox through the application

| Scenario | Date | What happened | Result |
|---|---|---|---|
| A. Successful charging (not backed by an artifact in the reviewed `artifacts/` directory; not re-verified in the 2026-11-09 audit) | 2026-11-06 | Driver consent to exact terms, PayPal buyer approval, authorization of USD 14.82, synthetic delivery of 30.015 kWh against a 30 kWh target, one capture of USD 14.82 | Provider authorization status CAPTURED, capture COMPLETED and tied to that authorization, one CAPTURE operation, reservation CAPTURED, FlexReceipt shows "capture confirmed by provider" |
| B. Charging outage (not backed by an artifact in the reviewed `artifacts/` directory; not re-verified in the 2026-11-09 audit) | 2026-11-07 | Same approval flow, authorization of USD 14.19, operator-injected synthetic outage, 0 kWh delivered, run FAILED | Provider authorization status VOIDED, exactly one VOID operation, no capture, USD 0.00 collected, reservation VOIDED, FlexReceipt "Not charged. Authorization voided by provider (bank hold removal may take time)" |
| Standalone smoke test (historical, not linked to the recovery work) | 2026-10-30 | One authorize → capture and one authorize → void of USD 1.23 each, two separate orders | Passed. Artifacts: `artifacts/paypal-smoke-capture-only-smoke_1793370835421.json` (capture COMPLETED, authorization CREATED before capture) and `artifacts/paypal-smoke-void-only-smoke_1793372411617.json` (authorization VOIDED after void). Sandbox host and USD 1.23 confirmed in both. Approval identity and request-ID values are not recorded. Details: `docs/PAYPAL_CERTIFICATION.md` section 0. |

The orders were approved on PayPal's Sandbox page with a Sandbox personal (buyer) account; for scenario A the approving account was confirmed to differ from the Sandbox business (merchant) account. Before every authorization the application compares the order's payee to the configured merchant, and the amount, currency and custom ID to the stored terms; mismatches stop before authorization.

## Signed webhooks

A Sandbox webhook subscribed to seven event types delivered, and the application verified (PayPal `verify-webhook-signature` over the unaltered raw body), correlated and durably processed, four event types: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.AUTHORIZATION.VOIDED`. Each processed event matched PayPal's own event record by event ID, was linked to its reservation, and caused no duplicate financial operation: money state is always read back from the PayPal API, never taken from the webhook body.

Honest note: the first two events were initially delivered to a webhook registered without the `/api/webhooks/paypal` path and were therefore not processed. After the registered URL was corrected, each of those two events was resent once and processed. The capture and void events arrived on their own.

Not tested live: refund and dispute events (not handled by design), a PENDING or DECLINED capture against the real provider (covered by the offline provider fake and the MOCK provider), and long-term webhook delivery (the tunnel used was temporary).

## Gemini

One live run on 2026-11-05 with a free-tier key and synthetic fixtures only: model `gemini-3.6-flash` through the Google Gen AI SDK, one metadata preflight and five generation requests, five provider responses, four of four mandatory cases answered by the model and accepted by the backend's grounding validator (request parsing, offer explanation, reservation Q&A, prompt-injection probe), zero deterministic fallbacks, zero grounding failures, 2,063 input and 548 output tokens. Cost is computed as USD 0 at the free-tier price and was not checked against a billing statement. An earlier run the same day was not certified (one provider error and three rejected answers); the causes were fixed and the stricter certification report is in the repository.

The model has no tools. It never sets a price, consent, authorization, capture or void, and any answer containing a number or payment claim the backend cannot confirm is replaced by deterministic text.

## Automated tests (final run of this release candidate)

Earlier release-candidate run, before the recovery work (superseded by the combined-release figures in `README.md` and `docs/AWARD_EVIDENCE.md`): TypeScript strict check, ESLint, 344 Vitest tests (physics, economics, payment state machine, adversarial lifecycle cases on an embedded PostgreSQL, 10 skipped), the real-PostgreSQL suite on a disposable local server (9 passed, 1 skipped because it needs a restartable server), Playwright end-to-end checks on desktop, tablet and mobile with axe accessibility and keyboard tests, a production build, and a secret scan of the browser bundle. `npm audit --omit=dev` reports 0 vulnerabilities.

## Known limits

- Tariffs, fees, building load, forecast and delivery are synthetic assumptions. The benchmark (500 seeded scenarios) compares policies on synthetic data and is not a measured saving.
- A PayPal authorization is not escrow. The honor period is three days and the lifetime up to 29 days; the application does not capture after expiry.
- Free-tier Gemini traffic may be used by Google to improve its products: do not enter personal data into the assistant.
- Operator and driver identities are pseudonymous demo sessions, not production authentication.
