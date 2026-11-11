/** Smoke test for scripts/mcp-server.ts: spawns it over stdio and walks the agent flow up to the PayPal approval link. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const log = (...parts: unknown[]) => process.stdout.write(`${parts.map(String).join(" ")}\n`);
type Offer = { offerId: string; priceCents: number; termsHash: string };

const client = new Client({ name: "mcp-smoke", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "scripts/mcp-server.ts"], env: { ...process.env } as Record<string, string> }),
);
const json = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  if (r.isError) throw new Error(`${name}: ${r.content[0]?.text}`);
  return JSON.parse(r.content[0]?.text ?? "{}");
};

log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
const site = await json("get_site_info");
log("site:", site.station.name, "| provider:", site.providerMode, "| AI:", site.ai.model ?? "off");
const parsed = await json("parse_charging_request", { text: "Find me 30 kWh before 7 AM and save at least $4" });
log("parsed:", JSON.stringify(parsed).slice(0, 200));
let quote: { quoteSetId: string; offers: Offer[] } = { quoteSetId: "", offers: [] };
for (const port of site.station.ports as { id?: string; portId?: string }[]) {
  ({ quote } = await json("request_charging_offers", {
    portId: port.id ?? port.portId,
    nightOf: site.defaultNightOf,
    plugInLocal: site.defaultPlugInLocal,
    departLocal: site.defaultDepartLocal,
    targetBatteryKWh: 20,
    spendCapCents: 2000,
  }));
  if (quote.offers.length) break;
}
log("offers:", quote.offers.map((o: Offer) => `$${(o.priceCents / 100).toFixed(2)}`).join(" | "));
const rec = await json("recommend_offer", { quoteSetId: quote.quoteSetId, preference: "lowest_cost", minSavingsCents: null });
log("recommendation:", JSON.stringify(rec).slice(0, 220));
const pick = quote.offers.find((o: Offer) => o.offerId === rec.evaluation?.recommendedOfferId) ?? quote.offers[0];
if (!pick) throw new Error("No offers available on any port for the default window.");
const checkout = await json("prepare_paypal_checkout", { quoteSetId: quote.quoteSetId, offerId: pick.offerId, termsHash: pick.termsHash, driverConfirmed: true });
log("checkout:", checkout.providerMode, checkout.reservationId, `${String(checkout.approveUrl).slice(0, 60)}…`);
const status = await json("get_reservation_status", { reservationId: checkout.reservationId });
log("status:", status.reservation?.paymentState ?? JSON.stringify(status).slice(0, 120));
await client.close();
