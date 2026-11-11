// Replaces 07-apimatic/04 with a different operation's request and response examples (read-only static portal).
import { chromium } from "file:///D:/Gridwindow-flexpay/node_modules/@playwright/test/index.mjs";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("https://gridwindow-flexpay-developers.onrender.com/api/openapi/offers/requestOffers", { waitUntil: "networkidle", timeout: 90000 });
await p.waitForTimeout(1200);
await p.screenshot({ path: "D:/Gridwindow-flexpay/docs/evidence/final-release-2026-11-11/07-apimatic/04-request-response-example.png" });
console.log("title:", (await p.locator("h1").first().innerText()).slice(0, 120));
await b.close();
