// Bounded, non-destructive production smoke test of the deployed release.
// Writes nothing but quote rows (as any visitor does). No order, reservation, disturbance or payment is created or changed.
// Model calls: at most 3 (parse, deal agent, explanation). Reads OPERATOR_PASSPHRASE from .env; prints no secret.
import { chromium } from "file:///D:/Gridwindow-flexpay/node_modules/@playwright/test/index.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const B = "https://gridwindow-flexpay.onrender.com";
const P = "https://gridwindow-flexpay-developers.onrender.com";
const OUT = process.argv[2] ?? ".";
const pass = readFileSync("D:/Gridwindow-flexpay/.env", "utf8").match(/^OPERATOR_PASSPHRASE=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const results = [];
const check = (area, ok, detail) => { results.push({ area, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${area}: ${detail}`); };
const NIGHT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(Date.now() + 3 * 86_400_000));

const b = await chromium.launch();
const ctxOpts = { timezoneId: "America/Los_Angeles", locale: "en-US" };
const ctx = await b.newContext({ ...ctxOpts, viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = { console: [], page: [], http: [] };
p.on("console", (m) => m.type() === "error" && errs.console.push(m.text().slice(0, 160)));
p.on("pageerror", (e) => errs.page.push(String(e).slice(0, 160)));
p.on("response", (r) => { const u = new URL(r.url()); if (r.status() >= 400 && u.host.endsWith("onrender.com")) errs.http.push(`${r.status()} ${u.pathname}`); });

// ---------- configuration ----------
// Operator AI status before any model call: after a restart it is IDLE and names the whole configured chain.
const signIn = await fetch(B + "/api/operator/session", { method: "POST", headers: { origin: B, "content-type": "application/json" }, body: JSON.stringify({ passphrase: pass }) });
const opCookie = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const aiBefore = (await (await fetch(B + "/api/operator/dashboard?night=2026-11-11", { headers: { cookie: opCookie } })).json()).dashboard.ai;
check("AI fallback chain (effective config)", /gemini-3\.6-flash/.test(aiBefore.label) && /gemini-3\.5-flash-lite/.test(aiBefore.label) && /baidu\/ernie-5\.5-flash-preview:free/.test(aiBefore.label), `operator AI status before any call: "${aiBefore.label}" (state ${aiBefore.state})`);
const cfg = await (await fetch(B + "/api/config")).json();
check("Config", cfg.providerMode === "PAYPAL_SANDBOX" && cfg.ai?.enabled && cfg.ai?.model === "gemini-3.6-flash", `providerMode=${cfg.providerMode}, ai=${JSON.stringify(cfg.ai)}`);
check("Security: config has no secrets", !/key|secret|token|passphrase|postgres/i.test(JSON.stringify(cfg).replace(/"timeZone"/g, "")), "public config exposes only station, provider mode, AI model and defaults");

// ---------- home and navigation ----------
await p.goto(B + "/", { waitUntil: "networkidle", timeout: 120000 });
const navOk = [];
for (const [name, url, heading] of [["Smart Charge", "/drive", /What does your car need tonight/], ["Rewards & Payments", "/rewards", /./], ["Impact Lab", "/impact-lab", /Impact Lab/], ["How It Works", "/how-it-works", /./]]) {
  await p.goto(B + "/", { waitUntil: "domcontentloaded" });
  await p.getByRole("navigation").getByRole("link", { name }).first().click();
  await p.waitForURL((u) => u.pathname === url, { timeout: 30000 });
  await p.getByRole("heading").filter({ hasText: heading }).first().waitFor({ timeout: 30000 });
  navOk.push(url);
}
check("Home and navigation", navOk.length === 4, `navigated to ${navOk.join(", ")}`);

// ---------- Smart Charge, AI assistant, offers, deal agent, explanation ----------
await p.goto(B + "/drive", { waitUntil: "networkidle" });
const parseResp = p.waitForResponse((r) => r.url().includes("/api/quotes/parse") && r.request().method() === "POST", { timeout: 60000 });
await p.getByLabel("Charging request in words").fill("I need 30 kWh before 7 AM on port C");
await p.getByRole("button", { name: "Fill form" }).click();
const parse = await (await parseResp).json();
check("AI assistant (request parsing)", ["MODEL", "DETERMINISTIC_FALLBACK"].includes(parse.source) && parse.parsed?.targetBatteryKWh === 30, `source=${parse.source}${parse.model ? ` model=${parse.model}` : ""}${parse.reason ? ` reason=${parse.reason}` : ""}, energy=${parse.parsed?.targetBatteryKWh}`);
await p.getByRole("radio", { name: /^Port C/ }).check();
await p.getByLabel("Night of").fill(NIGHT);
await p.getByLabel("Plug in").fill("19:00");
await p.getByLabel("Ready by (next morning)").fill("07:00");
await p.getByLabel("Energy into battery (kWh)").fill("30");
await p.getByLabel("Budget (USD)").fill("20.00");
const quoteResp = p.waitForResponse((r) => r.url().endsWith("/api/quotes") && r.request().method() === "POST", { timeout: 60000 });
const dealResp = p.waitForResponse((r) => r.url().includes("/api/agent/deals"), { timeout: 90000 });
await p.getByRole("button", { name: "See offers" }).click();
const quote = (await (await quoteResp).json()).quote;
check("Smart Charge offers", quote?.offers?.length > 0 && quote.offers.every((o) => o.priceCents > 0 && /^[0-9a-f]{64}$/.test(o.termsHash)), `${quote?.offers?.length} validated offers for ${NIGHT}: ${quote?.offers?.map((o) => `$${(o.priceCents / 100).toFixed(2)}`).join(", ")}`);
const deal = await (await dealResp).json();
check("Deal agent", ["MODEL", "DETERMINISTIC_FALLBACK"].includes(deal.source) && deal.evaluation?.status, `source=${deal.source}${deal.model ? ` model=${deal.model}` : ""}${deal.reason ? ` reason=${deal.reason}` : ""}, status=${deal.evaluation?.status}`);
const explainResp = p.waitForResponse((r) => r.url().includes("/api/assist/explain"), { timeout: 60000 });
await p.getByRole("button", { name: "Why is it cheaper?" }).first().click();
const explain = await (await explainResp).json();
await p.locator('[id^="why-"]:not([hidden]) ul li').first().waitFor({ timeout: 30000 });
check("AI explanation", ["MODEL", "DETERMINISTIC_FALLBACK"].includes(explain.source) && explain.points?.length > 0, `source=${explain.source}${explain.model ? ` model=${explain.model}` : ""}${explain.reason ? ` reason=${explain.reason}` : ""}, points=${explain.points?.length}`);
check("No 'How this was generated' label", (await p.getByText("How this was generated").count()) === 0 && (await p.getByText(/Deterministic fallback \(no AI\)/).count()) === 0, "driver screens show no provenance label");

// ---------- consent cannot be bypassed (refused before any PayPal order exists) ----------
const offer = quote.offers[0];
const post = (body) => p.request.post(B + "/api/offers/accept", { data: body, headers: { Origin: B } });
const noConsent = await post({ quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: false });
const tampered = await post({ quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: "0".repeat(64), consent: true });
const noOrigin = await p.request.post(B + "/api/offers/accept", { data: { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true } });
check("Consent cannot be bypassed", noConsent.status() >= 400 && tampered.status() === 409 && noOrigin.status() === 403, `consent=false -> HTTP ${noConsent.status()}; tampered terms -> HTTP ${tampered.status()}; missing Origin -> HTTP ${noOrigin.status()} (no order created)`);

// ---------- security ----------
const anonDash = await fetch(B + "/api/operator/dashboard?night=2026-11-11");
const badJson = await fetch(B + "/api/quotes", { method: "POST", headers: { origin: B, "content-type": "application/json" }, body: "{not json" });
const badBody = await badJson.text();
check("Security: operator API needs a session", anonDash.status === 401, `anonymous dashboard -> HTTP ${anonDash.status}`);
check("Security: errors leak no internals", badJson.status >= 400 && badJson.status < 500 && !/at \w+ \(|node_modules|stack|postgres/i.test(badBody), `malformed JSON -> HTTP ${badJson.status}`);

// ---------- Rewards / Channel3 ----------
await p.goto(B + "/rewards", { waitUntil: "networkidle" });
const gear = await (await fetch(B + "/api/gear")).json();
const cards = await p.locator("section[aria-labelledby='gear-title'] a[href^='https://']").count();
check("Rewards / Channel3", gear.enabled && gear.items.length > 0 && cards > 0 && gear.items.every((i) => i.url.startsWith("https://") && i.priceCents > 0 && i.currency === "USD"), `enabled=${gear.enabled}, items=${gear.items.length}, cards rendered=${cards}`);

// ---------- operator: AI chain, AG Grid, Bryntum, PayPal evidence, MOCK vs Sandbox ----------
await p.goto(B + "/operator", { waitUntil: "networkidle" });
await p.fill("#pass", pass);
await p.click("button:has-text('Sign in')");
await p.getByLabel("Night of").waitFor({ timeout: 60000 });
const cookie = (await ctx.cookies(B)).map((c) => `${c.name}=${c.value}`).join("; ");
const api = async (u) => (await fetch(B + u, { headers: { cookie } })).json();
const dash11 = await api("/api/operator/dashboard?night=2026-11-11");
const aiAfter = dash11.dashboard.ai ?? {};
const modelAnswers = [parse, deal, explain].filter((x) => x.source === "MODEL").map((x) => x.model);
check("AI answered by a model (hotfix)", modelAnswers.length > 0, `${modelAnswers.length} of 3 AI calls answered by a model (${[...new Set(modelAnswers)].join(", ") || "none"}); operator AI status after the calls: "${aiAfter.label}" (state ${aiAfter.state})`);
await p.getByLabel("Night of").fill("2026-11-10");
await p.getByRole("button", { name: "Load" }).click();
await p.waitForTimeout(3000);
await p.getByRole("button", { name: "Open data grid" }).click();
await p.locator("#grid-search").waitFor();
const footer = async () => (await p.getByText(/^\d+ of \d+ reservations/i).first().textContent()).match(/(\d+) of (\d+)/i).slice(1).map(Number);
const all = await footer();
await p.getByLabel("Needs attention only").check();
const attention = await footer();
await p.getByLabel("Needs attention only").uncheck();
const payHeader = p.locator(".ag-header-cell", { hasText: /Payment/ }).first();
await payHeader.click();
const sort = await payHeader.getAttribute("aria-sort");
const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Export CSV" }).click()]);
const csvFile = path.join(OUT, "smoke-grid.csv");
await dl.saveAs(csvFile);
const csv = readFileSync(csvFile, "utf8").trim().split(/\r?\n/);
const providerIdx = csv[0].split(",").findIndex((h) => /Provider/.test(h));
const providers = csv.slice(1).map((l) => l.split(",")[providerIdx]?.replace(/"/g, "") ?? "");
const mock = providers.filter((x) => /MOCK/i.test(x)).length;
const sandbox = providers.filter((x) => /Sandbox/i.test(x)).length;
writeFileSync(csvFile, ""); // the CSV holds reservation ids; keep only the counts
check("AG Grid", all[0] === all[1] && all[1] > 0 && attention[0] <= all[1] && sort === "ascending" && csv.length - 1 === all[1], `night 2026-11-10: ${all[1]} rows, needs attention ${attention[0]}, payment sort ${sort}, CSV ${csv.length - 1} data rows`);
check("MOCK rows distinguishable from Sandbox", mock >= 1 && sandbox >= 1, `CSV provider column: ${mock} MOCK row(s), ${sandbox} PayPal Sandbox row(s)`);
await p.goto(B + "/operator/schedule?night=2026-11-11", { waitUntil: "networkidle" });
await p.locator(".b-scheduler").first().waitFor({ timeout: 60000 });
const tableRows = await p.getByRole("table").first().locator("tbody tr").count();
check("Bryntum schedule", (await p.locator(".b-scheduler").count()) > 0 && tableRows >= 1, `scheduler rendered; accessible table rows=${tableRows}`);
const paypal = {};
for (const [night, suffix, want] of [["2026-11-10", "2XfQtp", "CAPTURED"], ["2026-11-12", "afKCrn", "VOIDED"]]) {
  const s = (await api(`/api/operator/dashboard?night=${night}`)).dashboard.sessions.find((x) => x.id.endsWith(suffix));
  const r = (await api(`/api/reservations/${s.id}`)).reservation;
  const proof = r.proofs.find((x) => x.type === want);
  paypal[suffix] = `${r.paymentState}/${proof?.providerStatus}/${proof?.evidenceSource}/${proof?.amountCents}c`;
}
check("PayPal Sandbox evidence (read back)", paypal["2XfQtp"] === "CAPTURED/COMPLETED/PAYPAL_SANDBOX_API/1556c" && paypal["afKCrn"] === "VOIDED/VOIDED/PAYPAL_SANDBOX_API/1556c", JSON.stringify(paypal));

// ---------- developer portal matches the deployed API ----------
const portalHome = await fetch(P + "/");
const acceptMd = await (await fetch(P + "/api/openapi/checkout/acceptOffer.md")).text();
const dealMd = await (await fetch(P + "/api/openapi/ai/recommendOffer.md")).text();
check("Developer portal", portalHome.status === 200 && /Must be `true`/.test(acceptMd) && !/const: true/.test(acceptMd) && /AiSourceKind|DETERMINISTIC_FALLBACK/.test(dealMd), `home HTTP ${portalHome.status}; accept-offer documents consent as boolean (regenerated spec); deal result documents the source enum`);

// ---------- mobile ----------
const m = await (await b.newContext({ ...ctxOpts, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
const mobile = [];
for (const u of ["/", "/drive", "/rewards", "/operator"]) {
  await m.goto(B + u, { waitUntil: "networkidle" });
  mobile.push(`${u} overflow ${await m.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))}px`);
}
check("Mobile layout", mobile.every((x) => x.endsWith(" 0px")), mobile.join("; "));

check("Browser errors during smoke", errs.console.length === 0 && errs.page.length === 0 && errs.http.filter((h) => !/\/api\/offers\/accept/.test(h)).length === 0, `console=${errs.console.length}, uncaught=${errs.page.length}, unexpected HTTP errors=${errs.http.filter((h) => !/\/api\/offers\/accept/.test(h)).join(" ") || "none"} (the refused accept calls above are intentional)`);

await b.close();
writeFileSync(path.join(OUT, "smoke-live-results.json"), JSON.stringify({ ranAt: new Date().toISOString(), base: B, portal: P, results }, null, 2));
console.log(`SUMMARY ${results.filter((r) => r.ok).length}/${results.length} passed`);
