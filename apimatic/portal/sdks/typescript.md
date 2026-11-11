# TypeScript SDK (/sdks/typescript)

[Download SDK](/__downloads/sdk/typescript.zip)

## Intro [#intro]

The GridWindow FlexPay API SDK provides access to the GridWindow FlexPay API REST APIs.

The public driver API behind GridWindow FlexPay, plus the operator endpoints.

**Flow.** A driver (or an AI agent acting for one, see `docs/MCP.md`) reads the site, requests priced offers,
optionally asks the deal agent for a pick, then accepts one exact offer. Accepting creates a PayPal Orders v2
**AUTHORIZE** order and returns an `approveUrl`; only the human buyer can approve it in PayPal. The server then
authorizes, commits the charging slots, and later captures for delivered energy or voids. The client never sets a price
and never moves money.

**Sessions.** Driver identity is a signed `gw_drv` cookie created on the first quote. Operator endpoints need the
`gw_op` cookie from `POST /api/operator/session`. Mutating requests must come from an allowed origin (`Origin` header).

**Money.** All amounts are integer US cents. Payments are PayPal **Sandbox** (test money) or a labelled MOCK provider.

## Installation [#installation]

The SDK compiles to `dist/` before it can be referenced - run its `build` script once in the SDK folder, then add it to your project by path:

```bash
npm install <path-to-sdk>
```

## Quick Start [#quick-start]

Create one client and reuse it. Configure its behaviour through `ClientOptions`.

```ts
import { GridWindowFlexPayApiClient, ServerEnvironment } from "grid-window-flex-pay-api";

const client = new GridWindowFlexPayApiClient({
  serverEnvironment: ServerEnvironment.Production,
  operatorCookie: "YOUR_API_KEY",
});
```

Nothing in `ClientOptions` is required - `new GridWindowFlexPayApiClient()` compiles - and each option left out falls back to its default. `serverEnvironment` is spelled out above so the environment a call reaches is visible where the client is built rather than inherited silently.

### From CommonJS [#from-commonjs]

The package ships both dialects from a single entry, so `require` works with full types. In a TypeScript CommonJS file use the `import ... = require(...)` form - a plain destructuring `require` runs fine but gives you `any`.

```ts
import sdk = require("grid-window-flex-pay-api");

const client = new sdk.GridWindowFlexPayApiClient({
  serverEnvironment: sdk.ServerEnvironment.Production,
  operatorCookie: "YOUR_API_KEY",
});
```