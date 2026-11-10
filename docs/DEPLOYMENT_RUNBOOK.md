# Deployment runbook (judge-accessible demo)

**Status: PREPARED, NOT EXECUTED.** Nothing here has been deployed. Deployment, a public repository and any provider call each need the owner's separate approval. Payments are PayPal **Sandbox** only (`PAYPAL_ENV=sandbox`, enforced by the app) or MOCK.

## Before deploying
1. `main` must be the certified commit (`git rev-parse origin/main`) and `docs/FINAL_AUTOMATED_CERTIFICATION.md` must show all gates PASS for it.
2. Clean-clone check: `git clone <repo> && npm ci && npm run build` succeeds with no environment file.
3. The repository stays PRIVATE until the owner approves publishing it. Run `npm run release:scan` on the production build and the secret scan in `docs/LICENSE_AND_SECRETS_CHECKLIST.md`.

## Environment (set in the host's secret store, never committed)
| Variable | Value for a judge demo |
|---|---|
| `PAYMENT_MODE` | `mock` for a no-provider demo, or `paypal` with sandbox credentials |
| `PAYPAL_ENV` | `sandbox` (anything else makes the app refuse to start) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | Sandbox application credentials, server-side only |
| `APP_BASE_URL` | the public HTTPS origin of the deployment |
| `TRUST_PROXY` | `true` only behind the host's trusted proxy; leave unset otherwise (all callers then share one rate-limit bucket, which fails closed) |
| `SESSION_SECRET` | 32+ random characters |
| `OPERATOR_PASSPHRASE` | 12+ characters; operator console is disabled without it |
| `DATABASE_URL` | PostgreSQL, if persistence is wanted; otherwise embedded PGlite on a writable `GW_DATA_DIR` (data is lost on redeploy on ephemeral disks) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | optional; without them the deterministic fallback runs and is labelled as such. Verified model id: `gemini-3.6-flash` |
| `GW_AUTO_MIGRATE` | never `true` for a persistent database |

## Database
- The app never migrates an external PostgreSQL at startup. If the schema does not match, the app fails closed with the exact command to run.
- Order: back up or branch the database, `npm run db:migrate -- --status` (note the fingerprint of host + port + database name), `--plan`, test on an isolated branch/copy, then `--apply --confirm-database <fingerprint>` on the intended database. Re-read the fingerprint for every target.
- Neon currently lacks migrations 003-005. See `docs/MIGRATIONS.md` and `docs/EXTERNAL_PREFLIGHT.md`.

## Build and start
`npm ci && npm run build && npm start` (Node 22+). Health check: `GET /` returns 200; `/operator` shows the sign-in form when `OPERATOR_PASSPHRASE` is set.

## Webhook (PayPal Sandbox only)
Register `https://<APP_BASE_URL host>/api/webhooks/paypal` for the Sandbox application and put its id in `PAYPAL_WEBHOOK_ID`. Webhook handling verifies the signature against the unaltered body and re-reads provider state; a webhook alone never sets CAPTURED or VOIDED.

## Rollback
Redeploy the previous commit. Migrations are additive (001-005), so the previous build still reads a migrated database only if it knows those migrations; take a database backup or branch before migrating and restore it if you need an older build.

## Smoke test after deploy (read-only, no money)
Open `/`, `/drive`, `/how-it-works`, `/impact-lab`, `/rewards`; sign in to `/operator`; in MOCK mode run one booking to a FlexReceipt. Confirm every provider-related label reads "MOCK" or "PayPal Sandbox (test money)" and that disturbances are labelled SYNTHETIC.
