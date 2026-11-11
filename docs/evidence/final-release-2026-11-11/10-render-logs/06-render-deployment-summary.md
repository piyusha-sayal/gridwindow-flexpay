# Render deployment summary, 2026-11-11

Source: Render REST API (`GET /v1/services/{id}`, `GET /v1/services/{id}/deploys`, `GET /v1/logs`), read with the owner's API key on 2026-11-11 at 17:35 UTC. Log capture window: **17:05:00Z to 17:35:36Z**.

## Services

| Service | Render id | Type | Region | Branch | Auto-deploy | URL |
|---|---|---|---|---|---|---|
| `gridwindow-flexpay` | `srv-dbq002tg1s2s739p32sg` | web service (Node) | oregon | `main` | yes | https://gridwindow-flexpay.onrender.com |
| `gridwindow-flexpay-developers` | `srv-dbq1578ae00c73d0f9d0` | static site (APIMatic portal) | global CDN | `main` | yes | https://gridwindow-flexpay-developers.onrender.com |

## Deploys

| Service | Deploy id | Commit | Trigger | Created (UTC) | Finished (UTC) | Status at capture |
|---|---|---|---|---|---|---|
| app | `dep-dbq8ft6c6qcc739gic2g` | `19fa76e` (before the release) | service_updated (environment change) | 15:21:24 | 15:24:14 | deactivated |
| app | `dep-dbqa3gp5efls73ahkn70` | `6265654` (PR #9, release) | new_commit | 17:11:31 | 17:14:13 | deactivated (replaced by the hotfix) |
| app | **`dep-dbqaakk9v7es73fr7t30`** | **`7959a1b` (PR #10, Gemini hotfix)** | new_commit | 17:26:42 | 17:29:05 | **live** |
| portal | `dep-dbqa3gp5efls73ahknkg` | `6265654` | new_commit | 17:11:31 | 17:12:41 | deactivated |
| portal | **`dep-dbqaakk9v7es73fr7tgg`** | **`7959a1b`** | new_commit | 17:26:42 | 17:27:09 | **live** |

Every deploy in the window built and started without an error (`01`, `02`, `04`). The verified release code is `7959a1b`; GitHub Actions CI passed on it (push to `main`) and on both PRs.

## Logs in this folder

| Category | File | Entries | Notes |
|---|---|---:|---|
| App build and deploy | `01-app-build-deploy.log` | 197 | both builds, clone to "Build successful" |
| App startup and runtime | `02-app-startup-runtime.log` | 50 | both startups and the verification window |
| App warnings and errors | `03-app-warnings-errors.log` | 6 | subset of 01 and 02: 2 CSS-optimizer warnings, 3 Gemini HTTP 400 (fixed by PR #10), 1 Gemini HTTP 429 handled by the backup chain |
| Portal build and deploy | `04-apimatic-portal-deploy.log` | 80 | both static-site deploys |
| Portal runtime | none | n/a | a static site has no runtime; Render emits no runtime logs for it |
| HTTP request logs | not archived | n/a | per-request access logs were not part of the required categories |

Redactions: none were needed (no secret, cookie, email address, payment identifier or secret URL parameter appeared in the 327 entries); terminal colour codes were removed. Rules and checks: `README.md`.

## The documentation-only deploy that follows

Merging this folder into `main` (evidence PR) triggers one more deploy of both services with identical runtime code. Its logs and deploy records are not committed (a commit would trigger yet another deploy). They are attached, sanitized the same way, to the GitHub Release `release-2026-11-11` created on that final commit: https://github.com/piyusha-sayal/gridwindow-flexpay/releases/tag/release-2026-11-11
