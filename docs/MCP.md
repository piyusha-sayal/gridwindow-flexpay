# Agentic commerce over MCP

GridWindow FlexPay ships an MCP server so any MCP-capable AI agent (Claude Desktop, Claude Code, Cursor, …) can shop for overnight EV charging on a driver's behalf, through the same public driver API the website uses.

## The consent boundary

The agent can **find, compare and prepare** a deal. It can never **pay**.

| Step | Who | Tool |
| --- | --- | --- |
| Read the site, ports and payment mode | Agent | `get_site_info` |
| Turn "30 kWh before 7 AM, save at least $4" into a request | Agent | `parse_charging_request` |
| Get priced offers with exact terms and a terms hash | Agent | `request_charging_offers` |
| Ask the deal agent which offer fits the goal | Agent | `recommend_offer` |
| Create the PayPal authorize order for one exact offer | Agent, **only after the driver says yes to the exact terms** | `prepare_paypal_checkout` |
| Approve the payment in PayPal | **Driver only** (opens the returned `approveUrl`) | — |
| Capture for delivered energy, or void | Server, from the energy ledger | — |
| Check payment and charging state | Agent | `get_reservation_status` |

Every server-side safeguard still applies, because the tools call the app's normal endpoints: same-origin checks, rate limits, offer expiry, terms-hash tamper checks, and provider read-back before anything is labelled paid or voided.

## Run it

```bash
npm run dev                      # the app, on http://localhost:3000
npm run mcp:smoke                # walks the whole agent flow and prints the PayPal approval link
```

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "gridwindow-flexpay": {
      "command": "npx",
      "args": ["tsx", "scripts/mcp-server.ts"],
      "cwd": "/path/to/gridwindow-flexpay",
      "env": { "GRIDWINDOW_URL": "http://localhost:3000" }
    }
  }
}
```

Point `GRIDWINDOW_URL` at a deployed instance to shop against it instead. If that instance enforces an origin allow-list, its own URL is what the server sends.

Then ask the agent, for example: *"Book me 25 kWh at the depot tonight, ready by 7 AM, under $20, cheapest option."* It will return offers, explain its pick and hand you a PayPal link to approve.
