// OpenAPI -> APIMatic TypeScript SDK -> real HTTP -> response decoded by the SDK's generated schemas.
// LIVE: read-only operations only. LOCAL (isolated MOCK server): the full driver flow up to the approval link, plus operator reads.
import { GridWindowFlexPayApiClient } from "file:///D:/Gridwindow-flexpay/apimatic/sdk/typescript/src/index.ts";

const LOCAL = process.env.LOCAL_BASE ?? "http://localhost:3210";
const LOCAL_PASS = process.env.EVIDENCE_OPERATOR_PASSPHRASE ?? "evidence-operator-passphrase-local";
const results: { env: string; operation: string; ok: boolean; note: string }[] = [];
const record = (env: string, operation: string, ok: boolean, note: string) => { results.push({ env, operation, ok, note }); console.log(`${ok ? "PASS" : "FAIL"} ${env} ${operation} ${note}`); };
async function step<T>(env: string, operation: string, fn: () => Promise<T>, note: (v: T) => string): Promise<T | null> {
  try { const v = await fn(); record(env, operation, true, note(v)); return v; }
  catch (e) { record(env, operation, false, `${(e as Error).name}: ${(e as Error).message}`.slice(0, 200)); return null; }
}

/** Minimal cookie jar + Origin header, so the SDK can drive the cookie-based session flow. */
function jarFetch(base: string): typeof fetch {
  const jar = new Map<string, string>();
  return async (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    headers.set("origin", base);
    const res = await fetch(input, { ...init, headers });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    return res;
  };
}

// ---------- LIVE, read-only ----------
const live = new GridWindowFlexPayApiClient({ serverEnvironment: "production" });
await step("LIVE", "site.getSiteConfig", () => live.site.getSiteConfig(), (c) => `providerMode=${c.providerMode} ports=${c.station.ports.length} ai=${JSON.stringify(c.ai)}`);
await step("LIVE", "gear.findEvGear", () => live.gear.findEvGear({ limit: 3 }), (g) => `enabled=${g.enabled} items=${g.items.length} https=${g.items.every((i) => i.url.startsWith("https://"))}`);

// ---------- LOCAL isolated MOCK server, full flow ----------
const local = new GridWindowFlexPayApiClient({ serverEnvironment: "environment2", serverOptions: { baseUrl: LOCAL }, fetch: jarFetch(LOCAL) });
await step("LOCAL", "site.getSiteConfig", () => local.site.getSiteConfig(), (c) => `providerMode=${c.providerMode}`);
await step("LOCAL", "aiApi.parseChargingRequest", () => local.aiApi.parseChargingRequest({ body: { text: "Find me 30 kWh before 7 AM and save at least $4" } }), (r) => `source=${(r as { source: string }).source}`);
const quote = await step("LOCAL", "offers.requestOffers", () => local.offers.requestOffers({ body: { portId: "port_b", nightOf: "2026-11-20", plugInLocal: "19:00", departLocal: "07:00", targetBatteryKWh: 30, spendCapCents: 2000 } }), (q) => `offers=${q.quote.offers.length}`);
if (quote) {
  const q = quote.quote;
  const deal = await step("LOCAL", "aiApi.recommendOffer", () => local.aiApi.recommendOffer({ body: { quoteSetId: q.quoteSetId, preference: "lowest_cost", minSavingsCents: null } }), (d) => `source=${(d as { source: string }).source} status=${(d as { evaluation: { status: string } }).evaluation.status}`);
  const pick = q.offers.find((o) => o.offerId === (deal as { evaluation?: { recommendedOfferId?: string } } | null)?.evaluation?.recommendedOfferId) ?? q.offers[0];
  const accepted = await step("LOCAL", "checkout.acceptOffer", () => local.checkout.acceptOffer({ body: { quoteSetId: q.quoteSetId, offerId: pick.offerId, termsHash: pick.termsHash, consent: true } }), (a) => `approveUrl=${String(a.approveUrl).replace(/\?.*/, "?…")} (stops at buyer approval)`);
  if (accepted) {
    await step("LOCAL", "reservations.getReservation", () => local.reservations.getReservation({ id: accepted.reservationId }), (r) => `paymentState=${(r as { reservation: { paymentState: string } }).reservation.paymentState}`);
    await step("LOCAL", "aiApi.explainOffer", () => local.aiApi.explainOffer({ body: { quoteSetId: q.quoteSetId, offerId: pick.offerId } }), (r) => `source=${r.source} points=${r.points.length}`);
    await step("LOCAL", "aiApi.askAboutReservation", () => local.aiApi.askAboutReservation({ body: { reservationId: accepted.reservationId, question: "When am I charged?" } }), (r) => `source=${r.source} inScope=${r.inScope}`);
    await step("LOCAL", "reservations.listMyReservations", () => local.reservations.listMyReservations(), (r) => `count=${(r as { reservations: unknown[] }).reservations.length}`);
  }
}
await step("LOCAL", "operator.operatorSignIn", () => local.operator.operatorSignIn({ body: { passphrase: LOCAL_PASS } }), () => "session cookie set");
await step("LOCAL", "operator.getOperatorDashboard", () => local.operator.getOperatorDashboard({ night: "2026-11-20" }), (d) => `sessions=${((d as { dashboard: { sessions: unknown[] } }).dashboard.sessions).length}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`SUMMARY ${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
