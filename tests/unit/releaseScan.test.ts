/** Release scan helpers on throwaway fixtures (the real .next/static and .env.example are scanned by the owner). */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditEnvTemplate, scanClientAssets } from "../../scripts/releaseScan";

describe("client asset scan", () => {
  it("finds configured values, secret shapes and sensitive names without reporting the values", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gw-scan-"));
    await mkdir(path.join(dir, "chunks"), { recursive: true });
    await writeFile(path.join(dir, "chunks", "clean.js"), "console.log('hello');");
    await writeFile(path.join(dir, "chunks", "leak.js"), "const a='configured-secret-value'; const k='sk-ant-abcdefghijklmnopqrstuv';");
    await writeFile(path.join(dir, "chunks", "name.js"), "process.env.PAYPAL_CLIENT_SECRET");
    const { findings, unreadable, scannedFiles } = await scanClientAssets(dir, { PAYPAL_CLIENT_SECRET: "configured-secret-value" });
    expect(unreadable).toEqual([]);
    expect(scannedFiles).toBe(3);
    expect(findings).toEqual(
      expect.arrayContaining([
        { file: path.join("chunks", "leak.js"), what: "anthropic-key" },
        { file: path.join("chunks", "leak.js"), what: "value of PAYPAL_CLIENT_SECRET" },
        { file: path.join("chunks", "name.js"), what: "name PAYPAL_CLIENT_SECRET" },
      ]),
    );
    expect(findings.some((f) => f.file.endsWith("clean.js"))).toBe(false);
    expect(JSON.stringify(findings)).not.toContain("configured-secret-value");
  });
});

describe("env template audit", () => {
  it("accepts placeholders and flags real-looking values or a non-sandbox PayPal env", () => {
    const ok = auditEnvTemplate("PAYMENT_MODE=mock\nPAYPAL_ENV=sandbox\nPAYPAL_CLIENT_ID=\nPAYPAL_CLIENT_SECRET=<your-sandbox-secret>\nSESSION_SECRET=change-me\n");
    expect(ok.problems).toEqual([]);
    expect(ok.documented).toContain("PAYPAL_CLIENT_SECRET");
    const bad = auditEnvTemplate("PAYPAL_ENV=live\nANTHROPIC_API_KEY=sk-ant-realkey1234567890\n");
    expect(bad.problems).toEqual(["PAYPAL_ENV is not sandbox", "ANTHROPIC_API_KEY has a non-placeholder value"]);
  });
});

/** Runs the real CLI against a fixture checkout; output must never contain the fake secret values. */
function runCli(root: string) {
  const r = spawnSync(path.join("node_modules", ".bin", "tsx"), ["scripts/release-scan.ts", "--root", root], { encoding: "utf8", shell: true });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gw-release-"));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), text);
  }
  return root;
}

describe("release:scan CLI on fixtures", () => {
  const FAKE_SECRET = "fake-paypal-secret-0123456789";
  const FAKE_KEY = "sk-ant-fakefakefakefakefake0000";

  it("passes a clean build and template with exit 0", async () => {
    const root = await fixture({ ".next/static/chunks/a.js": "console.log(1)", ".env.example": "PAYMENT_MODE=mock\nPAYPAL_ENV=sandbox\nPAYPAL_CLIENT_SECRET=\n" });
    const r = runCli(root);
    expect(r.out).toMatch(/PASS \.next\/static: 1 files/);
    expect(r.out).toMatch(/PASS \.env\.example/);
    expect(r.code).toBe(0);
  }, 60_000);

  it("fails on leaked values and keys, reports names only, and leaves .env.local untouched", async () => {
    const envLocal = `PAYPAL_CLIENT_SECRET=${FAKE_SECRET}\n`;
    const root = await fixture({
      ".next/static/chunks/leak.js": `const s="${FAKE_SECRET}";const k="${FAKE_KEY}";`,
      ".env.example": `ANTHROPIC_API_KEY=${FAKE_KEY}\n`,
      ".env.local": envLocal,
    });
    const r = runCli(root);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL \.next\/static\/chunks[\\/]leak\.js: value of PAYPAL_CLIENT_SECRET/);
    expect(r.out).toMatch(/FAIL \.next\/static\/chunks[\\/]leak\.js: anthropic-key/);
    expect(r.out).toMatch(/FAIL \.env\.example: ANTHROPIC_API_KEY has a non-placeholder value/);
    expect(r.out).not.toContain(FAKE_SECRET);
    expect(r.out).not.toContain(FAKE_KEY);
    expect(await readFile(path.join(root, ".env.local"), "utf8")).toBe(envLocal);
  }, 60_000);

  it("reports missing or unbuilt artifacts as INCOMPLETE with exit 1, never PASS", async () => {
    const root = await fixture({ "README.md": "x" });
    const r = runCli(root);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/INCOMPLETE \.next\/static/);
    expect(r.out).toMatch(/INCOMPLETE \.env\.example/);
    expect(r.out).not.toMatch(/PASS/);
  }, 60_000);
});
