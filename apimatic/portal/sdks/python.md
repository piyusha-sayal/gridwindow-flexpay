# Python SDK (/sdks/python)

[Download SDK](/__downloads/sdk/python.zip)

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

Add the SDK to your project from its folder, with whichever package manager your project uses. Give each tool a path containing a slash, such as `../grid-window-flex-pay-api` - a bare folder name is looked up on PyPI instead, and resolves to whatever project holds that name there:

```bash
pip install <path-to-sdk>
```

```bash
uv add <path-to-sdk>
```

```bash
poetry add <path-to-sdk>
```

## Quick Start [#quick-start]

### Synchronous client [#synchronous-client]

Construct `GridWindowFlexPayApiClient` with keyword arguments, and call `close()` when you are done. Every argument is optional.

```python
from grid_window_flex_pay_api import GridWindowFlexPayApiClient

client = GridWindowFlexPayApiClient(operator_cookie="YOUR_API_KEY", environment="production")

client.close()
```

Alternatively, scope it - `with GridWindowFlexPayApiClient(...) as client:` closes the pool on exit.

### Asynchronous client [#asynchronous-client]

`AsyncGridWindowFlexPayApiClient` mirrors `GridWindowFlexPayApiClient` with **identical method names**, and every endpoint method is a coroutine. It takes the same arguments, with some differences - for example, the transport argument is `custom_async_http_client`.

```python
from asyncio import run

from grid_window_flex_pay_api import AsyncGridWindowFlexPayApiClient

async def main() -> None:
    client = AsyncGridWindowFlexPayApiClient(operator_cookie="YOUR_API_KEY", environment="production")
    await client.aclose()

run(main())
```

Alternatively, scope it - `async with AsyncGridWindowFlexPayApiClient(...) as client:` closes the pool on exit.