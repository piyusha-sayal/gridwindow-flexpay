// MCP agentic-commerce check. Spawns the real scripts/mcp-server.ts over stdio.
//   mode "live":  read-only tools against the hosted app (site info, gear search). No booking, no PayPal order.
//   mode "local": the full booking walk against the isolated MOCK server, up to the approval link a human must open.
import { Client } from "file:///D:/Gridwindow-flexpay/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "file:///D:/Gridwindow-flexpay/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";

const mode = process.argv[2] ?? "live";
const base = mode === "live" ? "https://gridwindow-flexpay.onrender.com" : process.env.LOCAL_BASE ?? "http://localhost:3210";
const out: string[] = [];
const log = (s: string) => { out.push(s); console.log(s); };
const client = new Client({ name: "evidence-check", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "scripts/mcp-server.ts"], env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", GRIDWINDOW_URL: base }, cwd: "D:/Gridwindow-flexpay" }));
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  if (r.isError) throw new Error(`${name}: ${r.content[0]?.text}`);
  return JSON.parse(r.content[0]?.text ?? "{}");
};

log(`# MCP check (${mode}) against ${base} at ${new Date().toISOString()}`);
const tools = (await client.listTools()).tools;
log(`tools (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);
for (const t of tools) log(`  ${t.name}(${Object.keys((t.inputSchema as { properties?: object }).properties ?? {}).join(", ")})`);
const forbidden = tools.filter((t) => /capture|void|refund|approve_payment|authorize|set_price|price_override/i.test(t.name));
log(`payment-moving tools exposed: ${forbidden.length === 0 ? "none" : forbidden.map((t) => t.name).join(", ")}`);
const priceInputs = tools.filter((t) => Object.keys((t.inputSchema as { properties?: object }).properties ?? {}).some((k) => /^(price|amount|priceCents|amountCents)$/i.test(k)));
log(`tools that accept a price or amount: ${priceInputs.length === 0 ? "none" : priceInputs.map((t) => t.name).join(", ")}`);

const site = await call("get_site_info");
log(`get_site_info: ${site.station.name} | provider ${site.providerMode} | ports ${site.station.ports.length}`);
if (mode === "live") {
  const gear = await call("find_ev_gear", { maxPriceCents: 6000 });
  log(`find_ev_gear: enabled=${gear.enabled} items=${gear.items?.length ?? 0} https=${(gear.items ?? []).every((i: { url: string }) => i.url.startsWith("https://"))}`);
  for (const i of (gear.items ?? []).slice(0, 3)) log(`  - ${i.title.slice(0, 60)} | $${(i.priceCents / 100).toFixed(2)} ${i.currency} | ${i.domain}`);
} else {
  const parsed = await call("parse_charging_request", { text: "Find me 30 kWh before 7 AM and save at least $4" });
  log(`parse_charging_request: source=${parsed.source} target=${parsed.parsed?.targetBatteryKWh} kWh`);
  const { quote } = await call("request_charging_offers", { portId: "port_c", nightOf: "2026-11-21", plugInLocal: "19:00", departLocal: "07:00", targetBatteryKWh: 25, spendCapCents: 2000 });
  log(`request_charging_offers: ${quote.offers.length} server-priced offers: ${quote.offers.map((o: { priceCents: number }) => `$${(o.priceCents / 100).toFixed(2)}`).join(" | ")}`);
  const rec = await call("recommend_offer", { quoteSetId: quote.quoteSetId, preference: "lowest_cost", minSavingsCents: null });
  log(`recommend_offer: source=${rec.source} status=${rec.evaluation?.status}`);
  const pick = quote.offers.find((o: { offerId: string }) => o.offerId === rec.evaluation?.recommendedOfferId) ?? quote.offers[0];
  try { await call("prepare_paypal_checkout", { quoteSetId: quote.quoteSetId, offerId: pick.offerId, termsHash: "0".repeat(64), driverConfirmed: true }); log("tampered termsHash: ACCEPTED (unexpected)"); }
  catch (e) { log(`tampered termsHash: refused by the server (${String((e as Error).message).slice(0, 90)})`); }
  try { await call("prepare_paypal_checkout", { quoteSetId: quote.quoteSetId, offerId: pick.offerId, termsHash: pick.termsHash, driverConfirmed: false }); log("driverConfirmed=false: ACCEPTED (unexpected)"); }
  catch (e) { log(`driverConfirmed=false: refused (${String((e as Error).message).slice(0, 90)})`); }
  const checkout = await call("prepare_paypal_checkout", { quoteSetId: quote.quoteSetId, offerId: pick.offerId, termsHash: pick.termsHash, driverConfirmed: true });
  log(`prepare_paypal_checkout: provider ${checkout.providerMode}; approval link returned for the human: ${String(checkout.approveUrl).replace(/\?.*/, "?…")}`);
  const status = await call("get_reservation_status", { reservationId: checkout.reservationId });
  log(`get_reservation_status: paymentState=${status.reservation?.paymentState} (nothing authorized until the human approves)`);
  console.log(`APPROVE_URL=${checkout.approveUrl}`);
}
await client.close();
const { writeFileSync } = await import("node:fs");
writeFileSync(process.argv[3] ?? `mcp-${mode}.txt`, out.join("\n") + "\n");
