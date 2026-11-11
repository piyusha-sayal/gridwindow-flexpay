// MCP evidence images. MCP has no UI: the tool list and the booking walk are the literal transcripts printed by
// mcp-check.mts, rendered as plain monospace text. The approval page is the real page the returned link opens.
import { chromium } from "file:///D:/Gridwindow-flexpay/node_modules/@playwright/test/index.mjs";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const [OUT, SCRATCH] = process.argv.slice(2);
const dir = path.join(OUT, "05-ai-agentic-commerce");
mkdirSync(dir, { recursive: true });
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const page = (title, text) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;color:#1d1d1f;font:15px/1.55 Consolas,'Courier New',monospace">
<div style="padding:28px 32px;max-width:1360px"><div style="font:600 13px system-ui,sans-serif;color:#555;margin-bottom:14px;letter-spacing:.02em">${esc(title)}</div><pre style="margin:0;white-space:pre-wrap">${esc(text)}</pre></div></body>`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const local = readFileSync(path.join(SCRATCH, "mcp-local.txt"), "utf8");
const live = readFileSync(path.join(SCRATCH, "mcp-live.txt"), "utf8");
const toolPart = local.split("\n").filter((l) => /^(# MCP|tools \(|  [a-z_]+\(|payment-moving|tools that accept)/.test(l)).join("\n");
await p.setContent(page("Terminal transcript: MCP server tool list (scripts/mcp-server.ts over stdio), 2026-11-11", toolPart));
await p.locator("div").first().screenshot({ path: path.join(dir, "04-mcp-tools.png") });
const walk = local.split("\n").filter((l) => !/^(tools \(|  [a-z_]+\(|payment-moving|tools that accept)/.test(l)).join("\n");
await p.setContent(page("Terminal transcript: an MCP client books a charge on the isolated MOCK server and stops at the approval link, 2026-11-11", walk));
await p.locator("div").first().screenshot({ path: path.join(dir, "05-mcp-booking-preparation.png") });
await p.setContent(page("Terminal transcript: read-only MCP calls against the live Render deployment (site info, Channel3 gear search), 2026-11-11", live));
await p.locator("div").first().screenshot({ path: path.join(dir, "05b-mcp-live-gear-search.png") });

const approveUrl = readFileSync(path.join(SCRATCH, "mcp-local-stdout.txt"), "utf8").match(/APPROVE_URL=(\S+)/)?.[1];
if (approveUrl) {
  const h = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await h.goto(approveUrl, { waitUntil: "networkidle" });
  await h.waitForTimeout(800);
  await h.screenshot({ path: path.join(dir, "06-agent-stops-at-paypal-approval.png") });
  console.log("approval page:", (await h.locator("main, body").first().innerText()).replace(/\s+/g, " ").slice(0, 200));
}
await b.close();
console.log("saved MCP images");
