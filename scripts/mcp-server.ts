/**
 * GridWindow FlexPay MCP server (stdio).
 *
 * Lets any MCP-capable AI agent (Claude Desktop, Claude Code, Cursor, ...) shop for overnight EV charging
 * on a driver's behalf through the app's public driver API: read the site, turn a sentence into a request,
 * get priced offers, ask the deal agent for a pick, and prepare a PayPal checkout.
 *
 * Consent boundary: the agent never moves money. `prepare_paypal_checkout` needs the driver's explicit
 * confirmation of the exact terms and returns a PayPal approval link that only the human can complete.
 * Capture or void happens later on the server, from delivered energy, never from the agent.
 *
 * Run:  GRIDWINDOW_URL=http://localhost:3000 npx tsx scripts/mcp-server.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.GRIDWINDOW_URL ?? "http://localhost:3000").replace(/\/$/, "");
let cookie = "";

/** Calls the app as a browser would: same-origin header and the driver session cookie, so every server-side check still applies. */
async function call(path: string, init: { method?: string; json?: unknown } = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? (init.json === undefined ? "GET" : "POST"),
    headers: { origin: BASE, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    const name = (pair: string) => pair.slice(0, Math.max(0, pair.indexOf("=")));
    const jar = new Map<string, string>(cookie ? cookie.split("; ").map((c) => [name(c), c] as const) : []);
    for (const c of setCookie) {
      const pair = c.split(";")[0] ?? "";
      if (pair) jar.set(name(pair), pair);
    }
    cookie = [...jar.values()].join("; ");
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body.error ?? body)}`);
  return body;
}

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] });

const server = new McpServer({ name: "gridwindow-flexpay", version: "1.0.0" });

server.registerTool(
  "get_site_info",
  { title: "Charging site info", description: "Station name, time zone, ports, payment provider mode (PayPal Sandbox or MOCK) and the default charging night and window." },
  async () => {
    try {
      return text(await call("/api/config"));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "parse_charging_request",
  {
    title: "Turn a sentence into a charging request",
    description: "Turns plain language such as 'Find me 30 kWh before 7 AM and save at least $4' into the structured fields request_charging_offers needs. Only fills a form; sets no price and approves nothing.",
    inputSchema: { text: z.string().max(1000) },
  },
  async ({ text: sentence }) => {
    try {
      return text(await call("/api/quotes/parse", { json: { text: sentence } }));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "request_charging_offers",
  {
    title: "Get priced charging offers",
    description:
      "Requests priced overnight charging offers for one port. Each offer carries exact terms and a termsHash. Times are station-local HH:MM; nightOf is YYYY-MM-DD; spendCapCents is the driver's budget in cents.",
    inputSchema: {
      portId: z.string(),
      nightOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      plugInLocal: z.string().regex(/^\d{2}:\d{2}$/),
      departLocal: z.string().regex(/^\d{2}:\d{2}$/),
      targetBatteryKWh: z.number().positive().max(120),
      spendCapCents: z.number().int().min(100).max(50_000),
      requiredMinSavingsCents: z.number().int().min(1).max(50_000).optional(),
    },
  },
  async (input) => {
    try {
      return text(await call("/api/quotes", { json: input }));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "recommend_offer",
  {
    title: "Ask the deal agent for a pick",
    description: "Asks the app's deal agent to recommend one of the offers in a quote set for a goal. Read-only: it never accepts or pays.",
    inputSchema: {
      quoteSetId: z.string(),
      preference: z.enum(["lowest_cost", "early_finish", "gentle"]),
      minSavingsCents: z.number().int().min(1).max(50_000).nullable(),
    },
  },
  async (input) => {
    try {
      return text(await call("/api/agent/deals", { json: input }));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "prepare_paypal_checkout",
  {
    title: "Prepare a PayPal checkout for the driver to approve",
    description:
      "Creates the PayPal authorize order for one exact offer and returns an approval link. ONLY call this after showing the driver the exact price, charging window and terms and getting an explicit yes; set driverConfirmed to true only then. The driver must open approveUrl and approve in PayPal themselves; nothing is authorized or charged until they do, and capture happens later only for energy actually delivered.",
    inputSchema: {
      quoteSetId: z.string(),
      offerId: z.string(),
      termsHash: z.string().regex(/^[0-9a-f]{64}$/),
      driverConfirmed: z.literal(true),
    },
  },
  async ({ quoteSetId, offerId, termsHash }) => {
    try {
      const result = (await call("/api/offers/accept", { json: { quoteSetId, offerId, termsHash, consent: true } })) as { approveUrl: string; reservationId: string; providerMode: string };
      const approveUrl = result.approveUrl.startsWith("http") ? result.approveUrl : `${BASE}${result.approveUrl}`;
      return text({ ...result, approveUrl, nextStep: "Give approveUrl to the driver. They approve the payment in PayPal; the agent cannot." });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "get_reservation_status",
  {
    title: "Reservation and payment status",
    description: "Payment state (approved, authorized, captured, voided), charging state and receipt details of a reservation created in this session.",
    inputSchema: { reservationId: z.string() },
  },
  async ({ reservationId }) => {
    try {
      return text(await call(`/api/reservations/${encodeURIComponent(reservationId)}`));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "find_ev_gear",
  {
    title: "Find EV charging accessories",
    description:
      "Searches in-stock EV accessories (adapters, cables, organizers, home chargers) across merchants through Channel3, optionally under a price cap. Read-only: returns merchant links; nothing is bought.",
    inputSchema: {
      query: z.string().max(200).optional(),
      maxPriceCents: z.number().int().min(100).max(500_000).optional(),
      limit: z.number().int().min(1).max(12).optional(),
    },
  },
  async ({ query, maxPriceCents, limit }) => {
    try {
      const qs = new URLSearchParams();
      if (query) qs.set("q", query);
      if (maxPriceCents) qs.set("maxPriceCents", String(maxPriceCents));
      if (limit) qs.set("limit", String(limit));
      return text(await call(`/api/gear?${qs.toString()}`));
    } catch (e) {
      return fail(e);
    }
  },
);

await server.connect(new StdioServerTransport());
