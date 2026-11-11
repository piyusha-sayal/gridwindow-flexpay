// Fetches real Render deploy metadata and logs through the official Render REST API (https://api.render.com/v1),
// redacts them, and writes the sanitized archive. The API key is read from .env (RENDER_API_KEY) and never printed.
// Usage: node render-logs.mjs <outDir> <startISO> <endISO> <commitSha> [label]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const [OUT, START, END, SHA, LABEL = "release"] = process.argv.slice(2);
const envText = readFileSync("D:/Gridwindow-flexpay/.env", "utf8");
const KEY = envText.match(/^RENDER_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!KEY) throw new Error("RENDER_API_KEY is not set in .env");
const API = "https://api.render.com/v1";
const get = async (p) => {
  const r = await fetch(API + p, { headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" } });
  if (!r.ok) throw new Error(`GET ${p.split("?")[0]} -> HTTP ${r.status}`);
  return r.json();
};

// ---------- redaction ----------
const secretValues = envText.split(/\r?\n/).map((l) => l.match(/^[A-Z0-9_]+=(.*)$/)?.[1]?.trim().replace(/^["']|["']$/g, "")).filter((v) => v && v.length >= 8 && !/^(true|false|mock|sandbox|paypal_sandbox|gemini|openrouter)$/.test(v) && !/^https?:\/\/(localhost|gridwindow-flexpay)/.test(v) && !/^(gemini-|baidu\/)/.test(v));
const redactions = {};
const bump = (k) => (redactions[k] = (redactions[k] ?? 0) + 1);
function redact(s) {
  let t = String(s);
  for (const v of secretValues) if (t.includes(v)) { t = t.split(v).join("[REDACTED:env-secret]"); bump("env secret value"); }
  const rules = [
    ["bearer token", /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/g, "Bearer [REDACTED]"],
    ["authorization header", /(authorization|cookie|set-cookie|x-api-key)(["'\s:=]+)[^\s"',;]+/gi, "$1$2[REDACTED]"],
    ["session cookie", /\b(gw_drv|gw_op)=[^;\s"']+/g, "$1=[REDACTED]"],
    ["database url", /postgres(ql)?:\/\/[^\s"']+/gi, "postgres://[REDACTED]"],
    ["api key shape", /\b(sk-or-v1-[A-Za-z0-9]{10,}|sk-ant-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{20,}|rnd_[A-Za-z0-9]{10,})\b/g, "[REDACTED:key]"],
    ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED:email]"],
    ["paypal id", /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{17}\b/g, "[REDACTED:paypal-id]"],
    ["secret query parameter", /([?&](token|state|key|secret|signature|code|PayerID|ba_token)=)[^&\s"']+/gi, "$1[REDACTED]"],
  ];
  for (const [name, re, rep] of rules) { const n = (t.match(re) ?? []).length; if (n) { t = t.replace(re, rep); redactions[name] = (redactions[name] ?? 0) + n; } }
  return t;
}

// ---------- services and deploys ----------
const services = (await get("/services?limit=50")).map((x) => x.service ?? x);
const app = services.find((s) => s.name === "gridwindow-flexpay");
const portal = services.find((s) => s.name === "gridwindow-flexpay-developers");
if (!app || !portal) throw new Error(`services not found: ${services.map((s) => s.name).join(", ")}`);
const deploysOf = async (s) => (await get(`/services/${s.id}/deploys?limit=20`)).map((x) => x.deploy ?? x);
const summary = {};
for (const [k, s] of [["app", app], ["portal", portal]]) {
  const deploys = await deploysOf(s);
  summary[k] = {
    service: { id: s.id, name: s.name, type: s.type, region: s.serviceDetails?.region ?? s.region ?? null, autoDeploy: s.autoDeploy, branch: s.branch },
    deploys: deploys.filter((d) => new Date(d.createdAt) >= new Date(Date.parse(START) - 6 * 3600_000)).map((d) => ({ id: d.id, commit: d.commit?.id ?? null, status: d.status, trigger: d.trigger ?? null, createdAt: d.createdAt, finishedAt: d.finishedAt ?? null })),
  };
}

// ---------- logs (paginated) ----------
async function logs(resource, type) {
  const out = [];
  let start = START;
  let end = END;
  for (let page = 0; page < 60; page++) {
    const q = new URLSearchParams({ ownerId: app.ownerId, resource, startTime: start, endTime: end, direction: "forward", limit: "100" });
    if (type) q.set("type", type);
    const r = await get(`/logs?${q}`);
    for (const l of r.logs ?? []) out.push(l);
    if (!r.hasMore || !r.nextStartTime) break;
    start = r.nextStartTime;
    end = r.nextEndTime ?? end;
  }
  return out;
}
const label = (l, n) => l.labels?.find((x) => x.name === n)?.value ?? "";
const line = (l) => `${l.timestamp} [${label(l, "type") || "-"}] [${(label(l, "level") || "info").toUpperCase()}]${label(l, "instance") ? ` [${label(l, "instance")}]` : ""} ${redact(l.message).replace(/\s+$/g, "")}`;

mkdirSync(OUT, { recursive: true });
const appBuild = await logs(app.id, "build");
const appRuntime = await logs(app.id, "app");
const portalBuild = await logs(portal.id, "build");
const warn = appRuntime.concat(appBuild).filter((l) => /warn|error|fatal/i.test(label(l, "level")) || /\b(error|warn(ing)?|exception|failed|unhandled|ECONN|timeout)\b/i.test(l.message)).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
const header = (title, n) => `# ${title}\n# Source: Render REST API GET /v1/logs (official), captured ${new Date().toISOString()}\n# Window (UTC): ${START} to ${END}; release commit ${SHA}; ${n} entries; sanitized (see README.md)\n`;
const write = (f, title, arr, empty) => writeFileSync(path.join(OUT, f), header(title, arr.length) + (arr.length ? arr.map(line).join("\n") + "\n" : `# ${empty}\n`));
write(`01-app-build-deploy${LABEL === "release" ? "" : "-" + LABEL}.log`, `Application build and deploy logs (${app.name}, ${app.id})`, appBuild, "Render returned no build log entries for this window.");
write(`02-app-startup-runtime${LABEL === "release" ? "" : "-" + LABEL}.log`, `Application startup and runtime logs (${app.name}, ${app.id})`, appRuntime, "Render returned no runtime log entries for this window.");
write(`03-app-warnings-errors${LABEL === "release" ? "" : "-" + LABEL}.log`, `Application warnings and errors (filtered from the two logs above)`, warn, "No warning or error entries in this window.");
write(`04-apimatic-portal-deploy${LABEL === "release" ? "" : "-" + LABEL}.log`, `Developer portal build and deploy logs (${portal.name}, ${portal.id}; static site: no runtime logs exist)`, portalBuild, "Render returned no build log entries for the static site in this window.");
writeFileSync(path.join(OUT, `render-summary${LABEL === "release" ? "" : "-" + LABEL}.json`), JSON.stringify({ capturedAt: new Date().toISOString(), window: { start: START, end: END }, commit: SHA, ...summary, counts: { appBuild: appBuild.length, appRuntime: appRuntime.length, warningsErrors: warn.length, portalBuild: portalBuild.length }, redactions }, null, 2));
console.log(JSON.stringify({ app: summary.app.service.id, portal: summary.portal.service.id, deploys: { app: summary.app.deploys.slice(0, 4), portal: summary.portal.deploys.slice(0, 4) }, counts: { appBuild: appBuild.length, appRuntime: appRuntime.length, warn: warn.length, portalBuild: portalBuild.length }, redactions }, null, 1));
