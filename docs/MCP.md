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
| Approve the payment in PayPal | **Driver only** (opens the returned `approveUrl`) | No tool |
| Capture for delivered energy, or void | Server, from the energy ledger | No tool |
| Check payment and charging state | Agent | `get_reservation_status` |
| Find in-stock EV accessories (adapters, cables, organizers) across merchants, optionally under a budget | Agent (read-only, powered by [Channel3](https://trychannel3.com)) | `find_ev_gear` |

Every server-side safeguard still applies, because the tools call the app's normal endpoints: same-origin checks, rate limits, offer expiry, terms-hash tamper checks, and provider read-back before anything is labelled paid or voided.

## Run it

```bash
npm run dev                      # the app, on http://localhost:3000
npm run mcp:smoke                # walks the whole agent flow and prints the PayPal approval link
```

### Connect your AI client (Claude Desktop, Cursor, Claude Code)

You don't need to run the app. Clone the repository, run `npm ci` once, and point the server at the hosted site.

For Claude Desktop (`claude_desktop_config.json`) or Cursor (`mcp.json`), use absolute paths. Some clients ignore a `cwd` setting and start servers from an unrelated folder, so a relative path or a bare `npx tsx` may fail to start:

```json
{
  "mcpServers": {
    "gridwindow-flexpay": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/gridwindow-flexpay/node_modules/tsx/dist/cli.mjs",
        "/ABSOLUTE/PATH/gridwindow-flexpay/scripts/mcp-server.ts"
      ],
      "env": { "GRIDWINDOW_URL": "https://gridwindow-flexpay.onrender.com" }
    }
  }
}
```

For Claude Code:

```bash
claude mcp add gridwindow-flexpay -e GRIDWINDOW_URL=https://gridwindow-flexpay.onrender.com -- node /ABSOLUTE/PATH/gridwindow-flexpay/node_modules/tsx/dist/cli.mjs /ABSOLUTE/PATH/gridwindow-flexpay/scripts/mcp-server.ts
```

On Windows, write the paths with forward slashes, for example `C:/Users/you/gridwindow-flexpay/scripts/mcp-server.ts`. Restart the client after changing its config.

To shop against your own local copy instead, start the app and set `GRIDWINDOW_URL` to `http://localhost:3000`. If an instance enforces an origin allow-list, its own URL is what the server sends.

On the hosted site, payments are PayPal Sandbox. When you approve a checkout link, log in with a PayPal Sandbox personal (buyer) account.

Then ask the agent, for example: *"Book me 25 kWh at the depot tonight, ready by 7 AM, under $20, cheapest option."* It will return offers, explain its pick and hand you a PayPal link to approve.
