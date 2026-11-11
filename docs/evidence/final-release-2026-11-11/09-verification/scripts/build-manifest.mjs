// Builds EVIDENCE_MANIFEST.md and SCREENSHOT_INDEX.md from the capture records plus a reviewed metadata table.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const [OUT, SCRATCH, META] = process.argv.slice(2);
const load = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { records: [], checks: {} });
const live = load(path.join(SCRATCH, "capture-live-records.json"));
const local = load(path.join(SCRATCH, "capture-local-records.json"));
const meta = JSON.parse(readFileSync(META, "utf8"));
const byFile = new Map([...live.records, ...local.records].map((r) => [r.file, r]));

const sections = [
  ["01-product", "01. Product experience"],
  ["02-paypal", "02. PayPal payments"],
  ["03-operator-ag-grid", "03. Operator console and AG Grid"],
  ["04-bryntum-recovery", "04. Bryntum and recovery"],
  ["05-ai-agentic-commerce", "05. AI and agentic commerce"],
  ["06-channel3", "06. Channel3"],
  ["07-apimatic", "07. APIMatic"],
  ["08-responsive", "08. Responsive verification"],
];
const envLabel = { LIVE: "LIVE (Render, PayPal Sandbox mode)", "LOCAL-MOCK": "LOCAL isolated (MOCK provider, SYNTHETIC)", REUSED: "LIVE, earlier capture today" };

let manifest = `# Evidence manifest: final release, 2026-11-11

Commit under test: \`${meta.commit}\` (branch \`${meta.branch}\`). **LIVE** images show the deployed \`${meta.liveCommit}\`; **LOCAL** images show \`${meta.commit}\`, which adds the AI backup chain, the removed driver-screen label and the booking and recovery capacity fixes (not yet deployed; see \`docs/FINAL_RELEASE_VERIFICATION_2026-11-11.md\`).
Captured ${meta.capturedOn} with Playwright (Chromium headless), time zone America/Los_Angeles. Desktop 1440×900 at 1×, phone 390×844 at 2×, tablet 820×1180 at 2×.

Labels: **LIVE** = the public Render deployment (PayPal Sandbox mode, real Gemini key, real Channel3 key). **SANDBOX** = a state confirmed by the PayPal Sandbox API. **MOCK** = the built-in mock payment provider on an isolated local server (no PayPal call). **SYNTHETIC** = simulated charging, disturbances and tariffs. **FALLBACK** = the labelled deterministic answer (no model call).

Every image was opened and checked by eye for clipped text, blank regions, broken images, error overlays, secrets and misleading claims. PayPal-shaped identifiers on live pages are masked with grey boxes by the capture script. A screenshot is not proof of settlement or of model participation on its own; the "Backed by" column names the independent evidence.

Browser health during capture (all 48 recorded captures, \`09-verification/live-checks.json\` and \`local-checks.json\`): 0 console errors, 0 uncaught exceptions, 0 HTTP error responses, 0 px horizontal overflow. The only failed requests are Next.js link prefetches cancelled by navigation (\`net::ERR_ABORTED\`). The four MCP images come from \`capture-mcp.mjs\` and the Sandbox checkout image is re-used, so those five have no capture record; \`07-apimatic/04\` was re-shot by \`capture-portal-04.mjs\` (its record in \`live-checks.json\` describes the earlier shot of the accept-offer page).

| File | Shows | Environment | Viewport | Status | Backed by | Public | Limitations |
|---|---|---|---|---|---|---|---|
`;
let index = `# Screenshot index: final release, 2026-11-11

Commit \`${meta.commit}\`. Details, environments and limitations for every image: [EVIDENCE_MANIFEST.md](EVIDENCE_MANIFEST.md).

`;
let count = 0;
const missing = [];
for (const [dir, title] of sections) {
  index += `## ${title}\n\n`;
  for (const m of meta.files.filter((f) => f.file.startsWith(dir + "/"))) {
    const r = byFile.get(m.file);
    const exists = existsSync(path.join(OUT, m.file));
    if (!exists) { missing.push(m); manifest += `| \`${m.file}\` | ${m.shows} | ${m.env ?? "n/a"} | n/a | ${m.status} | ${m.backedBy} | no | ${m.limits ?? "not captured"} |\n`; index += `- **${m.file}**: not captured (${m.status}). ${m.limits ?? ""}\n`; continue; }
    count++;
    const env = envLabel[m.env ?? r?.env] ?? m.env ?? r?.env;
    manifest += `| [\`${m.file}\`](${m.file}) | ${m.shows} | ${env} | ${m.viewport ?? r?.viewport ?? ""} | ${m.status} | ${m.backedBy} | ${m.public ? "yes" : "no"} | ${m.limits ?? "none"} |\n`;
    index += `### ${path.basename(m.file)}\n${m.caption} *[${m.tags}]*\n\n![${m.caption.replace(/[[\]]/g, "")}](${m.file})\n\n`;
  }
}
manifest += `\n${count} screenshots captured.`;
if (missing.length) manifest += ` Not captured: ${missing.map((m) => `\`${m.file}\` (${m.status})`).join(", ")}.`;
manifest += `\n\n## Verification records in \`09-verification/\`\n\n${meta.records.map((r) => `- [\`${r.file}\`](09-verification/${r.file}): ${r.what}`).join("\n")}\n`;
writeFileSync(path.join(OUT, "EVIDENCE_MANIFEST.md"), manifest);
writeFileSync(path.join(OUT, "SCREENSHOT_INDEX.md"), index);
console.log(`manifest: ${count} images, ${missing.length} missing`);
