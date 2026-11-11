# Render logs: final release, 2026-11-11

Real log entries from Render, retrieved through the official Render REST API (`GET https://api.render.com/v1/logs`, `GET /v1/services/{id}/deploys`) with the owner's API key, then sanitized before publication. Nothing in this folder was written by hand except this README and the two summary documents (`05`, `06`), which only restate API results.

| File | Contents |
|---|---|
| [`01-app-build-deploy.log`](01-app-build-deploy.log) | Build and deploy output of the web service `gridwindow-flexpay` (Render `type=build`) |
| [`02-app-startup-runtime.log`](02-app-startup-runtime.log) | Startup and runtime output of the web service (Render `type=app`), including the production verification window |
| [`03-app-warnings-errors.log`](03-app-warnings-errors.log) | Entries from 01 and 02 at warning or error level, or containing error, warning, exception, failed or timeout |
| [`04-apimatic-portal-deploy.log`](04-apimatic-portal-deploy.log) | Build and deploy output of the static site `gridwindow-flexpay-developers`. A static site has no runtime, so Render emits no runtime logs for it |
| [`05-production-health-verification.md`](05-production-health-verification.md) | The hosted smoke test results and the live configuration checks |
| [`06-render-deployment-summary.md`](06-render-deployment-summary.md) | Services, deploy ids, commits, timestamps, statuses, capture window, redactions |
| [`render-summary.json`](render-summary.json) | The same deploy and count data as returned by the API (sanitized) |

## Sanitization

Before writing, every line passed through a redaction step (`09-verification/scripts/render-logs.mjs`):

- every secret value from the deployment's environment file (API keys, PayPal client credentials, database URL, passphrase, session secret) replaced with `[REDACTED:env-secret]`;
- bearer tokens, authorization, cookie and API-key headers, session cookies (`gw_drv`, `gw_op`), database URLs and known API-key shapes;
- email addresses, PayPal-shaped identifiers (17 upper-case letters and digits) and secret URL query parameters (`token`, `state`, `key`, `secret`, `signature`, `code`, `PayerID`, `ba_token`).

Afterwards the files were scanned again for every secret value and secret shape, and read by eye before commit. Reservation ids, request paths and timestamps are kept: they are not credentials and are needed to tie entries to the evidence.

Two presentation changes were made after redaction, nothing else: terminal colour codes (ANSI escape sequences) were removed, and each line is printed as `timestamp [type] [level] [instance] message` from the API's fields. Render labels every entry of these services `type=app`, including build output; the split between `01` (build) and `02` (startup and runtime) comes from the API's `type=build` / `type=app` filter, not from that label. No redaction was needed in this window: none of the 327 entries contained a secret, cookie, email address or payment identifier.

## What the logs show

- Two complete app builds (`npm ci && npm run build`, "Build successful") and startups ("Ready", "Your service is live"): commit `6265654` (release, PR #9) at 17:11–17:14 UTC and commit `7959a1b` (Gemini hotfix, PR #10) at 17:26–17:29 UTC. No build or startup error in either.
- On `6265654`, three `model call failed: REQUEST_REJECTED (gemini) http=400 status=INVALID_ARGUMENT` lines at 17:15 UTC: the defect fixed by PR #10 (Gemini rejected an 8 s server deadline).
- On `7959a1b`, the backup chain working: `QUOTA_EXHAUSTED (gemini) http=429`, then `ai failover: gemini QUOTA_EXHAUSTED -> gemini ok` and `deal-agent ... source=MODEL` at 17:32 UTC (the second Gemini model answered).
- Two static-site deploys of the developer portal ("Your site is live"). A static site has no runtime, so no runtime logs exist for it.
- Build-time notes: `npm` reports 7 moderate advisories (all dev-only; `npm audit --omit=dev` reports 0), Render builds with Node 26.13.1 selected from the `engines` field (`render.yaml` sets 22; CI uses 22), and LightningCSS warns about the `::highlight(fd-search)` pseudo-element in one generated utility class (cosmetic).

The final deployment, triggered by the documentation-only merge that adds this folder, is archived separately as a GitHub Release asset (see `06-render-deployment-summary.md`), so archiving its logs does not trigger another deployment.
