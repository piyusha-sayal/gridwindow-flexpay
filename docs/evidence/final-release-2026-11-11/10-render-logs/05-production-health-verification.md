# Production health verification, 2026-11-11

All checks ran against the live services after deployment. They were bounded and non-destructive: no PayPal order, reservation, disturbance or payment was created or changed; the only writes were quote records (as any visitor makes). Model calls: 3 per smoke run.

## Smoke test on the release (`6265654`), 17:14-17:16 UTC: 19 of 20

Everything passed except the AI: all three model calls (request parsing, deal agent, explanation) came back as the labelled deterministic fallback with `REQUEST_REJECTED`, and the operator AI status read "AI unavailable". The logs in `02-app-startup-runtime.log` show HTTP 400 `INVALID_ARGUMENT` from Gemini. Root cause (reproduced locally with the same key): the Google SDK sent the adapter's 8 s timeout as `X-Server-Timeout: 8`, which Gemini rejects; 20 s is accepted. Fixed in PR #10 (`ed68391`, merged as `7959a1b`), with a regression test that drives the real SDK.

## Smoke test on the hotfix (`7959a1b`), 17:31:51-17:32:41 UTC: 21 of 21

| Area | Result |
|---|---|
| AI fallback chain (effective Render config) | Operator AI status before any call: "AI ready: gemini-3.6-flash with fallback gemini-3.5-flash-lite, then baidu/ernie-5.5-flash-preview:free" |
| Configuration | `providerMode=PAYPAL_SANDBOX`, AI enabled, `gemini-3.6-flash`; the public config contains no secret |
| Home and navigation | Smart Charge, Rewards, Impact Lab, How It Works reached from the navigation |
| AI assistant | Request parsing answered by `gemini-3.6-flash` (source MODEL), 30 kWh read correctly |
| Smart Charge | 2 validated offers ($11.54 each), each with a 64-character terms hash |
| Deal agent and explanation | Answered by the second model `gemini-3.5-flash-lite` after the primary hit its rate limit (HTTP 429, transient); operator status then "AI degraded: fallback gemini-3.5-flash-lite is answering" |
| Removed label | No "How this was generated" text on the driver screens |
| Consent cannot be bypassed | `consent: false` gives HTTP 400, a tampered terms hash HTTP 409, a request without Origin HTTP 403; no order is created |
| Security | Anonymous operator dashboard HTTP 401; malformed JSON HTTP 400 without internals |
| Rewards / Channel3 | `enabled: true`, 6 live products, 6 cards rendered, all HTTPS, USD |
| AG Grid | 11 rows (night of 2026-11-10), "Needs attention only" 4, payment sort ascending, CSV export 11 data rows |
| MOCK vs Sandbox | CSV provider column: 1 MOCK row (kept, from 2026-11-05 testing), 10 PayPal Sandbox rows |
| Bryntum | Scheduler rendered; accessible table rows present |
| PayPal Sandbox evidence | `…2XfQtp` CAPTURED / COMPLETED / PAYPAL_SANDBOX_API / 1556 c; `…afKCrn` VOIDED / VOIDED / PAYPAL_SANDBOX_API / 1556 c |
| Developer portal | HTTP 200; accept-offer documents `consent` as a boolean that must be `true`; deal result documents the source enum |
| Mobile | 0 px horizontal overflow on `/`, `/drive`, `/rewards`, `/operator` at 390 px |
| Browser errors | 0 console errors, 0 uncaught exceptions, no unexpected HTTP errors |

## Other checks after the hotfix deploy

- APIMatic SDK contract: 17 of 17 calls pass, 13 distinct operations, 6 of them against the live API (site config, gear search, request offers, operator sign-in, session, dashboard); the rest on an isolated server built from the same source (`09-verification/sdk-contract-2026-11-11.txt`).
- MCP (live, read-only, 17:36 UTC): 7 tools, none moves money or accepts a price; live gear search returns 6 products (`09-verification/mcp-live-readonly-2026-11-11.txt`).
- Live screenshots re-captured on `7959a1b` (17:33-17:35 UTC), 0 console errors, 0 overflow.

The two high-severity booking and recovery fixes run on the deployed code (`7959a1b` contains them); reproducing them live would need a disturbance on a shared production reservation and a new PayPal order, both outside the release authorization, so they are proven by their regression tests (run in CI on the deployed commit) and by the isolated browser run on the same code (`04-bryntum-recovery/`).
