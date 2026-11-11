# Final release verification, 2026-11-11

Engineering closure for GridWindow FlexPay (PayPal AI Hackathon 2026). Status words: **PASS**, **FAIL**, **BLOCKED**, **NOT TESTED**, **NEEDS USER APPROVAL**. MOCK results are never counted as PayPal results, and a deterministic fallback is never counted as a model decision. Screenshots: [`docs/evidence/final-release-2026-11-11/`](evidence/final-release-2026-11-11/SCREENSHOT_INDEX.md).

## A. Release identity

| Item | Value |
|---|---|
| Repository | https://github.com/piyusha-sayal/gridwindow-flexpay (public, MIT) |
| Verified branch | `chore/final-release-verification-satyam`, from `main` at `19fa76e` |
| Verified code commit | `11cf209` (last source change; later commits on the branch add evidence and documentation only) |
| Commits on the branch | `81d1d63` AI backup chain and removal of the driver-screen provenance label; `4933aca` booking fix; `11cf209` recovery fix; `515a625` API contract fix with the portal and SDK regenerated (spec and generated files only); then this evidence and documentation |
| Deployed (Render) | `main` at `19fa76e`: app deployed 08:29 UTC and redeployed 15:21 UTC (environment change), portal 08:29 UTC, both SUCCESS. The branch is **not pushed and not deployed** (needs your approval) |
| Source to deployment | Live runs `19fa76e`. The branch changes runtime behaviour in four places: the AI provider chain, the removed label, the booking capacity check and the recovery capacity check. It also regenerates the API portal and SDK. Until it is merged, the live site still has the two defects in section F |
| Environment checked | Live: `PAYMENT_MODE=paypal_sandbox`, Gemini `gemini-3.6-flash` with `gemini-3.5-flash-lite` fallback, Channel3 key active. Your OpenRouter variables are saved on Render but **not yet active**: the live AI status still reads "fallback gemini-3.5-flash-lite" (no deploy since 15:21 UTC) |

## B. Automated verification (on `11cf209` unless stated)

| Gate | Result | Status |
|---|---|---|
| TypeScript (`tsc --noEmit`) | 0 errors | PASS |
| ESLint | 0 problems | PASS |
| Vitest | 1,002 passed, 12 skipped (1,014 tests, 96 files, 1 file skipped). The 12 skips are the real-PostgreSQL suite, which needs a disposable `TEST_DATABASE_URL` | PASS |
| Playwright (desktop, tablet, mobile; axe, keyboard, payment states) | 132 collected in 24 files: **126 passed, 6 skipped, 0 failed** (desktop 111 in 9.8 min, mobile 14 + 3 skipped, tablet 3 + 3 skipped; the operator sign-in setup runs once per device profile). The 2 known Bryntum time-zone residuals (QA-3) are marked expected-to-fail and failed as expected. The 6 skips are the keyboard-only journeys, which run on desktop only. Run 16:35–16:47 UTC on build `11cf209` | PASS |
| Production build (`next build`) | exit 0 on `11cf209` | PASS |
| Release scan | `.next/static` 46 files, no secret shapes, sensitive names or configured values; `.env.example` placeholders only | PASS |
| Dependency audit (`npm audit --omit=dev`) | 0 vulnerabilities | PASS |
| Real PostgreSQL suite | not run this round (needs a disposable local PostgreSQL); last PASS on a disposable PG 18.1 cluster (2026-11-07 and 2026-11-09) | NOT TESTED today |
| Migration guards, payment safety, recovery, MCP, AI failover suites | inside the Vitest run above (`migrationSafety`, `paymentSafety`, `lifecycle`, `providerFailover`, `recoveryOrchestrator`, `bookingAfterDisturbance`, `recoveryAfterDisturbance`, ...) | PASS |
| Recovery benchmark (200 seeds, 5,820 scenarios) | deterministic; regenerated after the recovery fix (`docs/RECOVERY_BENCHMARK.md`) | PASS |
| Generated TypeScript SDK typecheck (its own TypeScript 7.0.2 toolchain) | exit 0 | PASS |
| SDK contract (OpenAPI → APIMatic SDK → HTTP → response decoded by the SDK's schemas) | 13 of 13 operations (2 live read-only, 11 on an isolated MOCK server) | PASS |
| APIMatic validator (`apimatic api validate`) | Succeeded; warnings only (missing parameter descriptions and examples) | PASS |

## C. Sponsor integrations

| Integration | What was verified | Status |
|---|---|---|
| PayPal | Live Sandbox on the deployed runtime: one provider-confirmed capture (`…2XfQtp`, $15.56, COMPLETED) and one provider-confirmed void (`…afKCrn`, $15.56 held, VOIDED after an operator outage run delivered 0 Wh), each with signature-verified webhooks. Both transactions were run by you through the UI; this session only read them back. Idempotency, capture-after-void prevention, webhook forgery, duplicate settlement and concurrency: automated tests on the MOCK provider and the offline provider fake | PASS (live capture and void); a void decided by the fault-attribution policy after a *recovery run* is MOCK-tested only |
| Gemini | Live config `gemini-3.6-flash` plus `gemini-3.5-flash-lite`. No new live Gemini call was made (needs your approval; free quota). Earlier today Gemini drove recovery tool steps in two runs, but the final step got HTTP 503 | AI assistance and fallback PASS; live model *final* decision NOT achieved |
| OpenRouter (free backup) | Best free model with strict structured output whose endpoint passes `data_collection: deny`: `baidu/ernie-5.5-flash-preview:free`. Live: a schema-valid parse answer; in a capped recovery run it answered a tool step, then got HTTP 429. 3 of its 7 calls today got 429 | PASS (wired and safe); model final decision NOT achieved; active on Render only after a deploy |
| Bryntum | Persisted original plan, a proposal shown without being committed, driver consent, committed version 2 shown without a reload and after a reload, accessible table equal to the chart (isolated MOCK server) | PASS; 3 vendor axe findings stay documented |
| AG Grid | Live: 11 rows, "Needs attention only" leaves 4, sorting by payment (`aria-sort` ascending), CSV export (11 data rows with headers), row click opens the detail drawer with provider evidence | PASS |
| APIMatic | Portal live (desktop and phone), spec validated, SDK typechecks, contract 13 of 13. Three spec errors found and fixed: accept-offer `consent` was generated as the string `"True"` (the SDK could not accept an offer), the deal-agent `source` was typed as an object, and sign-in/sign-out bodies were declared empty. Portal and SDK regenerated on the branch; the live portal is the previous generation until the merge | PASS on the branch |
| Channel3 | Live `/api/gear` `enabled: true`, 6 in-stock products, USD prices, images load, every link HTTPS, new tab, `rel="noopener noreferrer sponsored"`, through `buy.trychannel3.com`; also reachable through the MCP `find_ev_gear` tool | PASS |
| Render | App and portal deployed from `render.yaml`; all live pages return 200 | PASS |

`APIMATIC_API_KEY` is not read by the app at runtime (only the CLI uses it to regenerate the portal and SDK). The copy on the Render web service is unused; remove it when convenient (not changed by this session).

## D. Financial and AI safety

| Property | Evidence | Status |
|---|---|---|
| Consent preserved | A recovery that moves the finish or departure time waits for the driver: run `NEEDS_APPROVAL`, version stays 1 until "Approve change", then version 2 (`04-bryntum-recovery/05` and `06`; `recoveryAfterDisturbance.test.ts`) | PASS |
| AI has no payment authority | MCP exposes 7 tools, none can capture, void, refund or set a price; no tool accepts a price; a tampered terms hash is refused (409 `TERMS_MISMATCH`); `driverConfirmed: false` is refused; the agent stops at an approval link (`09-verification/mcp-local.txt`). Recovery tool allowlist: 0 gateway calls in every live and test run | PASS |
| Deterministic validation | Every candidate passes `validateRecoveryPlan`; the commit is re-checked under the night lock | PASS |
| No unauthorized settlement | Settlement follows the delivered-energy ledger: 30.015 kWh delivered then captured; 0 Wh delivered then voided | PASS |
| Idempotency | keyed capture and void, one provider operation per reservation (`paymentSafety`, `lifecycle` tests) | PASS (automated) |
| Recovery auditability | persisted run, trace, outcome and versions; provenance label from the record (`DETERMINISTIC_FALLBACK · no model decision`) | PASS |
| Synthetic disclosures | SYNTHETIC, MOCK and PayPal Sandbox badges on every relevant screen; savings labelled modeled | PASS |

## E. Screenshot evidence

Folder: `docs/evidence/final-release-2026-11-11/`, with [`SCREENSHOT_INDEX.md`](evidence/final-release-2026-11-11/SCREENSHOT_INDEX.md) and [`EVIDENCE_MANIFEST.md`](evidence/final-release-2026-11-11/EVIDENCE_MANIFEST.md).

- **53 screenshots: the 49 requested, none missing, plus 4 extras.** 30 come from the live deployment (29 captured in this session plus the re-used Sandbox checkout page); 5 of those show PayPal Sandbox states. 23 come from an isolated MOCK server. The 4 extras show behaviour worth keeping: a savings goal reported rather than relaxed, the deal agent's "goal not met" panel, the live MCP gear search, and the developer portal on a phone.
- **Every image was opened and checked by eye.** Navigation that overlapped cropped elements was fixed and re-captured, and a duplicate portal shot was replaced. PayPal-shaped identifiers on live pages are masked; the app itself shortens provider references in the operator drawer.
- **Honest labels.** Fallback results carry "fallback" in their file names. Nothing claims a live Gemini answer. The Sandbox checkout page is a capture from earlier the same day (no new Sandbox order was created), and MCP images are labelled terminal transcripts.
- **Public-sharing readiness:** all 53 are marked suitable. They show no secrets, no personal data and no full payment identifiers; synthetic and Sandbox labels are visible.
- `09-verification/` holds the raw check records, transcripts, OpenRouter run artifacts, the APIMatic validator output, test results and the scripts used.

## F. Defects found and fixed in this closure

| # | Severity | Defect | Fix | Proof |
|---|---|---|---|---|
| 1 | High | After a disturbance left one session above its new limit (for example a power cut with no feasible recovery), every new booking that night was shown offers and then refused with "Station capacity changed" (HTTP 409). The check after PayPal authorization would have cancelled such a booking and voided its authorization | Acceptance and the post-authorization commit use the quote's rule (count only violations the new plan introduces; never add load to an overloaded slot) | `bookingAfterDisturbance.test.ts`, mutation-checked twice (original code: 409; commit check alone: `VOIDED/CANCELLED`) |
| 2 | High | After one infeasible disturbance, every later recovery on the night was "no feasible recovery" (candidates rejected for another session's port-cap violation). With a site-cap cut that overloaded several sessions, none could ever recover (each blocked by the others) | Candidate validation and the recovery commit use the same rule | `recoveryAfterDisturbance.test.ts`, mutation-checked (original code: `INFEASIBLE`) |
| 3 | Medium | Generated SDK could not accept an offer (`consent` became the string `"True"`); deal-agent and operator sign-in responses did not match the spec | OpenAPI corrected, portal and SDK regenerated | SDK contract 13 of 13 |
| 4 | Medium | An OpenRouter answer at the end of a failover chain would have been labelled with the wrapper's provider (Gemini) | Provider of the adapter that answered is kept; health reports DEGRADED whenever a fallback answered | 3 tests, mutation-checked |

Effect of fix 2 on the synthetic benchmark (only the site-cap-reduction scenarios change): reached the energy target 704 → 736; of those, finishing after the agreed time with consent 592 → 624 (112 on time, unchanged); no feasible recovery 3,832 → 3,765; delivered energy with approval +2.6 % → +2.9 %. Unchanged: 71 automatic changes, the 1 c minimum operator margin, the 3 known shortfall seeds.

## G. Remaining limitations

| Item | Status |
|---|---|
| Branch with the fixes (sections C and F) is not on `main`, so the live site still has defects 1 to 4 | NEEDS USER APPROVAL (push, PR, merge; Render then auto-deploys) |
| OpenRouter backup variables saved on Render but not active until the next deploy | NEEDS USER APPROVAL (merge, or Manual Deploy) |
| A live Gemini or OpenRouter model making the *final* recovery decision: not achieved (Gemini HTTP 503 at the final step in both runs; free OpenRouter endpoint HTTP 429 after one tool step). Every final decision was the labelled deterministic fallback | NOT ACHIEVED; a further bounded Gemini attempt needs your approval |
| Live Gemini assistant answers (parse, explain, deal agent) were not re-run in this closure | NOT TESTED today (quota; needs approval) |
| PayPal void decided by the fault-attribution policy after a recovery run, duplicate webhook delivery and provider timeouts: tested on the MOCK provider and offline fakes, not live | NOT TESTED live |
| Real-PostgreSQL suite (12 tests): not run this round | NOT TESTED today |
| Bryntum timeline: 3 vendor axe findings (1 critical, 2 serious); the HTML table is the accessible alternative. Axis ticks follow the browser zone in half-hour-offset zones (QA-3, 2 expected-failure tests) | Known, documented |
| After a driver approves a recovery, the operator schedule's note for that disturbance still shows the proposal-time sentence ("needs your approval") next to "run COMMITTED" | Low, copy only; not changed |
| `.env` contains duplicate `PAYMENT_MODE` and `PAYPAL_ENV` lines (the later one wins) | Info, local file only |
| The live database still holds the 2026-11-05 MOCK test rows (flagged MOCK in the grid) | Info; decide whether to keep them |
| Free-tier quotas: Gemini 20 requests per model per day; OpenRouter free 50 per day | Info; beyond them every AI feature uses its labelled fallback |

## H. Release decision

**CONDITIONAL GO.** The core product works and is verified: driver flow, Bryntum recovery with consent, AG Grid, Channel3, the APIMatic SDK and portal, MCP and live PayPal Sandbox capture and void, with the full automated suite green on `11cf209`. The condition: two high-severity defects (one disturbed session blocking every later booking and every later recovery on that night) are fixed on the branch but still present on the live site. A judge who injects a severe disturbance and then books or injects again would see false "capacity changed" or "no feasible recovery" results. Merge and deploy the branch, then run the read-only smoke in `docs/DEPLOYMENT_RUNBOOK.md` and confirm the operator AI status shows the OpenRouter fallback. With that done the release is GO; the provider-dependent items in section G stay disclosed limitations, not blockers.

## I. Facts to reflect in Devpost (not written here)

`docs/DEVPOST_FINAL.md` and `docs/FINAL_DEMO_SCRIPT.md` were not edited. Facts that changed:

- Synthetic impact (after fix 2): 736 of 4,672 disturbed scenarios reached the energy target (16 %, was 704 / 15 %); 624 of them only by finishing later with the driver's consent (was 592); 3,765 with no feasible recovery (was 3,832); modeled delivered energy with approval +2.9 % (was +2.6 %). Source: `docs/IMPACT_SUMMARY.md`.
- Tests on the final code: 1,002 Vitest passed (12 skipped) and the Playwright results in section B (the Devpost draft says 993 and 126).
- PayPal: a live Sandbox **void** now exists on the deployed build (the draft says "a live Sandbox void was not run for this build"), alongside the live capture; both with verified webhooks.
- AI: the backup chain is Gemini 3.6 Flash, then Gemini 3.5 Flash-Lite, then OpenRouter `baidu/ernie-5.5-flash-preview:free` ($0). A live model *final* recovery decision is still not claimed.
- The driver screens no longer show the "How this was generated" label; provenance stays in the API and on the operator's run detail.
- Channel3 is live: 6 in-stock products in the "Spend your savings" section ("Gear for smarter overnight charging") on Rewards.
- APIMatic: the SDK now covers the full booking flow (contract 13 of 13) after the spec fixes.
