# Deployment runbook (judge-accessible demo)

**Status: DEPLOYED.** Since 2026-11-11 the app runs on Render from the Blueprint `render.yaml` (free plan, auto-deploy from `main`): https://gridwindow-flexpay.onrender.com (PayPal Sandbox mode) and the APIMatic portal https://gridwindow-flexpay-developers.onrender.com (static site). The repository is public (MIT `LICENSE`). Payments are PayPal **Sandbox** only (`PAYPAL_ENV=sandbox`, enforced by the app) or MOCK. Verification of the deployed release: `docs/FINAL_RELEASE_VERIFICATION_2026-11-11.md`.

## Before deploying
1. `main` must be the verified commit (`git rev-parse origin/main`), with GitHub Actions CI green on it and the gates in `docs/FINAL_RELEASE_VERIFICATION_2026-11-11.md` passing.
2. Clean-clone check: `git clone <repo> && npm ci && npm run build` succeeds with no environment file.
3. Run `npm run release:scan` on the production build and the secret scan in `docs/LICENSE_AND_SECRETS_CHECKLIST.md`.

## Environment (set in the host's secret store, never committed)
Render applies a changed variable only on the next deploy. After saving variables with "Save only", start a deploy (Manual Deploy, "Deploy latest commit"); otherwise the running instance keeps the old values.

| Variable | Value for a judge demo |
|---|---|
| `PAYMENT_MODE` | `mock` for a no-provider demo, or `paypal_sandbox` with sandbox credentials (the only two accepted values) |
| `PAYPAL_ENV` | `sandbox` (anything else makes the app refuse to start) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | Sandbox application credentials, server-side only |
| `PAYPAL_EXPECTED_MERCHANT_ID` | required with `paypal_sandbox`: the Sandbox business account id; checkout refuses to authorize an order whose payee differs |
| `APP_BASE_URL` | the public HTTPS origin of the deployment |
| `TRUST_PROXY` | `true` only behind the host's trusted proxy (Render: `true`); leave unset otherwise (all callers then share one rate-limit bucket, which fails closed) |
| `SESSION_SECRET` | 32+ random characters (Render generates it) |
| `OPERATOR_PASSPHRASE` | 12+ characters; operator console is disabled without it |
| `DATABASE_URL` | PostgreSQL, if persistence is wanted; otherwise embedded PGlite on a writable `GW_DATA_DIR` (data is lost on redeploy on ephemeral disks) |
| `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL` | optional; without a key every AI feature uses its deterministic fallback. Verified model id: `gemini-3.6-flash` |
| `GEMINI_FALLBACK_MODEL` | optional second Gemini model on the same key (its own free quota), tried after the primary: `gemini-3.5-flash-lite` |
| `AI_FALLBACK_PROVIDER`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | optional last backup: `openrouter`, the key, and a free model (`baidu/ernie-5.5-flash-preview:free`, $0 per token). Tried after both Gemini models; off without the key |
| `CHANNEL3_API_KEY` | optional; enables the "Spend your savings" product cards and the MCP gear tool. The section hides itself without it |
| `DEMO_TOOLS` | demo seeding tools; only active in MOCK mode without `DATABASE_URL` |
| `GW_AUTO_MIGRATE` | never `true` for a persistent database |

`APIMATIC_API_KEY` is **not** read by the app at runtime. It is only needed on a developer machine to regenerate the portal and SDK with the APIMatic CLI (`docs/APIMATIC.md`). It can be removed from the Render web service.

## Database
- The app never migrates an external PostgreSQL at startup. If the schema does not match, the app fails closed with the exact command to run.
- Order: back up or branch the database, `npm run db:migrate -- --status` (note the fingerprint of host + port + database name), `--plan`, test on an isolated branch/copy, then `--apply --confirm-database <fingerprint>` on the intended database. Re-read the fingerprint for every target.
- Neon holds migrations 001-005 (read-only inspection 2026-11-10: 0 pending, ledger in legacy format without checksums; replay and app startup against Neon NOT TESTED). See `docs/MIGRATIONS.md`.

## Build and start
`npm ci && npm run build && npm start` (Node 22+). Health check: `GET /` returns 200; `/operator` shows the sign-in form when `OPERATOR_PASSPHRASE` is set.

## Webhook (PayPal Sandbox only)
Register `https://<APP_BASE_URL host>/api/webhooks/paypal` for the Sandbox application and put its id in `PAYPAL_WEBHOOK_ID`. Webhook handling verifies the signature against the unaltered body and re-reads provider state; a webhook alone never sets CAPTURED or VOIDED.

## Rollback
Redeploy the previous commit. Migrations are additive (001-005), so the previous build still reads a migrated database only if it knows those migrations; take a database backup or branch before migrating and restore it if you need an older build.

## Smoke test after deploy (read-only, no money)
Open `/`, `/drive`, `/how-it-works`, `/impact-lab`, `/rewards`; sign in to `/operator`; in MOCK mode run one booking to a FlexReceipt. Confirm every provider-related label reads "MOCK" or "PayPal Sandbox (test money)" and that disturbances are labelled SYNTHETIC.
