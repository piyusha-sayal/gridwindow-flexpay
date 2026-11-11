# APIMatic in GridWindow FlexPay

APIMatic generates PayPal's official Server SDKs (including `@paypal/paypal-server-sdk`) and built PayPal's **Context Plugin**, an MCP server that gives coding agents authoritative PayPal SDK context. We used it in two ways.

## 1. Auditing our PayPal integration with the PayPal Context Plugin

The plugin (`acp-paypal-server-sdk-ts`, hosted by APIMatic, no API key) was added to Claude Code from APIMatic's official plugin marketplace (`apimatic/plugin-marketplace`, plugin `acp-paypal`):

```bash
claude mcp add --transport http acp-paypal-server-sdk-ts \
  "https://chatbotapi.apimatic.io/mcp/cacdb56c-c789-4017-b820-011496c7ed24/typescript" \
  --header "X-Apimatic-Mcp-Client: ClaudeCode"
```

Its `endpoint_search` and `ask` tools were queried for the Orders v2 authorize flow (`createOrder`, `authorizeOrder`, `captureAuthorizedPayment`, void, `getAuthorizedPayment`) and the results compared with `src/payments/paypalSandbox.ts` and the settlement services.

| Check (PayPal SDK definition) | GridWindow | Result |
| --- | --- | --- |
| `PayPal-Request-Id` idempotency is honored on create order, authorize order and capture (kept 6 h for create/authorize, 45 days for capture) | Sent on create, authorize, capture and void, with a persisted key per operation so retries replay instead of double-charging | Matches |
| Buyer experience settings belong under `payment_source.paypal.experience_context`; `application_context` is deprecated | Uses `payment_source.paypal.experience_context` | Matches |
| Capture an authorization with `final_capture: true` | One final capture of the agreed amount, only after delivered energy | Matches |
| Authorization statuses: `CREATED`, `CAPTURED`, `DENIED`, `PARTIALLY_CAPTURED`, `VOIDED`, `PENDING`; capture statuses: `COMPLETED`, `DECLINED`, `PARTIALLY_REFUNDED`, `PENDING`, `REFUNDED`, `FAILED` | Only `CREATED` counts as authorized and only `COMPLETED` (with matching amount, currency and authorization) counts as captured. Anything else, including `PENDING`, goes to `NEEDS_RECONCILIATION`; the reconciler re-reads PayPal on every sweep and commits, voids or flags it for the operator | Matches; no money is ever labelled moved on an ambiguous status |
| Authorization honor period of 3 days; reauthorize day 4 to 29 | Charging is overnight, so capture or void happens within hours; expired authorizations are never captured or reauthorized automatically | Within the honor period by design |

No code change was needed.

## 2. An OpenAPI description of the GridWindow API

[`docs/openapi.yaml`](openapi.yaml) (OpenAPI 3.1) describes the driver, checkout, reservation, operator and webhook endpoints, with schemas taken from the server's own validation (zod) and response types. It can be imported into APIMatic to generate a developer portal and client SDKs for partners, alongside the MCP server for AI agents ([MCP.md](MCP.md)).

## 3. Developer portal and TypeScript SDK generated with APIMatic

The spec passes APIMatic's validator (`apimatic api validate`), and APIMatic's CLI generated, from that one file:

- **A developer portal** (`apimatic/portal`, static site): API reference with a live "Send" console, cURL / Python / TypeScript samples for every endpoint, an SDK section, and `llms.txt` / `llms-full.txt` so AI agents can read the API. Hosted as a free Render static site, `gridwindow-flexpay-developers`, from the same Blueprint.
- **A typed TypeScript SDK** (`apimatic/sdk/typescript`, package `grid-window-flex-pay-api`) with README, API reference and a machine-readable SDK map.

Regenerate after changing `docs/openapi.yaml` (needs a free APIMatic account key in `APIMATIC_API_KEY`):

```bash
cp docs/openapi.yaml apimatic/src/spec/openapi.yaml
npx @apimatic/cli@2.0.0 portal generate -i apimatic -f -k "$APIMATIC_API_KEY"
npx @apimatic/cli@2.0.0 sdk generate -l typescript -i apimatic -f -k "$APIMATIC_API_KEY"
```

So GridWindow offers three integration surfaces from one contract: the website, an MCP server for AI agents ([MCP.md](MCP.md)), and an APIMatic SDK and portal for developers.

**Where the APIMatic key is needed.** Only for the two CLI commands above, on the machine that regenerates the portal and SDK. The portal is served as prebuilt static files (`staticPublishPath: ./apimatic/portal`, build command `echo`), and nothing in `src/` reads `APIMATIC_API_KEY`. A copy of the key on the Render web service is unused and can be removed.

## Verification, 2026-11-11 (final release)

The contract was tested end to end: OpenAPI spec, APIMatic-generated TypeScript SDK, real HTTP, response decoded by the SDK's generated schemas.

- **Three spec errors found and fixed** (the SDK caught them; the website was unaffected): `acceptOffer.consent` was declared `type: boolean, const: true`, which the generator turned into the string literal `"True"`, so the SDK could not accept an offer (now `type: boolean`; the server still refuses anything but `true`). The deal agent's `source` was typed as an object while the API returns `MODEL` or `DETERMINISTIC_FALLBACK`, and `summary` and `points` were missing (new `DealResult`, `AiSourceKind`). Operator sign-in and sign-out were declared with empty bodies while they return `{ "operator": boolean }` (new `OperatorSessionState`). Explain and ask now have typed results (`ExplainResult`, `AskResult`).
- **Regenerated** with the commands above (`apimatic api validate`: Succeeded, warnings only for missing parameter descriptions and examples); portal and SDK updated in `apimatic/`.
- **SDK typecheck** with its own declared toolchain (TypeScript 7.0.2, `@types/node` 20): exit 0. With the app's TypeScript 6 and `@types/node` 24 it reports four `Uint8Array` generic errors in `core/request-body.ts`; that is a toolchain mismatch, not a runtime problem.
- **Contract run: 13 of 13 operations PASS**: `site.getSiteConfig` and `gear.findEvGear` against the live deployment (read-only); `parseChargingRequest`, `requestOffers`, `recommendOffer`, `acceptOffer`, `getReservation`, `explainOffer`, `askAboutReservation`, `listMyReservations`, `operatorSignIn`, `getOperatorDashboard` against an isolated MOCK server. Transcript and script: `docs/evidence/final-release-2026-11-11/09-verification/`.
