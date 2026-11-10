# Recording-ready demo package

Reviewed against the running production build and the captured screenshots (`docs/evidence/`). Timing target 2:50, hard limit 2:55. Do not upload or publish until the owner approves.

**Truth label for this recording.** MOCK payments, SYNTHETIC charging and disturbances, and the recovery decision is DETERMINISTIC_FALLBACK (the console itself shows "Source FALLBACK" and a "DETERMINISTIC (NO AI)" badge). It is not a live Gemini decision and not a PayPal transaction, and the narration says so. If a REAL_GEMINI or PayPal Sandbox certification later passes, a second take may say so, with that evidence on screen.

## A. Browser and server setup
- Machine: Windows or macOS, Node 22 or newer, Chromium-based browser at 1440x900, 100 % zoom, one clean profile, bookmarks bar and extensions hidden, notifications off.
- **Browser time zone: America/Los_Angeles** (OS setting). Required because of QA-3; the Bryntum axis follows the browser zone.
- Server: `npm ci`, `npm run build`, `npm start` (port 3000). Fresh database: stop the server and delete `.data/pglite` before the take.

## B. Environment variables (local env file, never committed, no secrets shown on screen)
```
PAYMENT_MODE=mock
PAYPAL_ENV=sandbox
APP_BASE_URL=http://localhost:3000
SESSION_SECRET=<32+ random characters>
OPERATOR_PASSPHRASE=<12+ characters>
DEMO_TOOLS=true
# leave DATABASE_URL, MIGRATION_DATABASE_URL, GEMINI_API_KEY, ANTHROPIC_API_KEY empty or unset
```
With `DATABASE_URL` set the demo tools are disabled, and the app will not start against an unmigrated external database (QA-1). Keep the file out of the screen capture.

## C. Fixture and scenario
| Item | Value |
|---|---|
| Night | any date at least 2 days ahead (the evidence run used 2027-01-02); never "tonight" |
| Request | Port B, plug-in 19:00, ready by 07:00, 30 kWh into battery, budget $20.00, lowest-cost flexible offer |
| Agreed price | about $13 (the evidence runs showed $13.03 and $13.04; it varies slightly with the night) |
| Disturbance 1 (main take) | Early departure, 60 minutes early, effective slot 0. Expected: "Waiting for your approval", nothing committed until consent |
| Disturbance 2 (optional second take) | Charger power reduced, 4800 W, effective slot 16 (22:00). Expected: also needs approval, then version 2. At 3600 W the engine reports "No feasible recovery" (honest-failure example) |
| Benchmark seeds on the impact slide | 1..200; known shortfall seeds 91, 134, 152 |

## D. Click-by-click sequence (labels verified against the UI source and the passing browser specs)
1. `http://localhost:3000/drive`. Heading "What does your car need tonight?". Select radio **Port B**. Fill **Night of**, **Plug in** 19:00, **Ready by (next morning)** 07:00, **Energy into battery (kWh)** 30, **Budget (USD)** 20.00. Click **See offers**.
2. Heading "...flexible offer". Pause on the offer and its assumptions. Click **Review and approve**.
3. Tick the consent checkbox. Click **Approve $13.0x with mock provider**, then **Approve (mock)**. The page shows "Authorized, not captured."
4. New tab `http://localhost:3000/operator/schedule?night=<night>`. The Bryntum timeline shows one parked car on Port B (`01-original-schedule.png`).
5. New tab `/operator`, sign in. Type the night into **Night of**, click **Load**. Scroll to the **Recovery engine** panel.
6. **Session** = Port B, **Disturbance** = Early departure, **Effective slot** 0, **Minutes early** 60. Click **Inject SYNTHETIC disturbance**. Banner: "Early departure recorded as SYNTHETIC (...). Recovery is running."
7. Show **Scenario C: recovery steps**: 1 Disturbance detected, 2 Agent run (Source FALLBACK, 7 trace entries), 3 Deterministic validation, 4 Schedule (proposal only, no version written), 5 Consent state NEEDS_DRIVER_APPROVAL, 6 Financial outcome AUTHORIZED and not settled, 7 FlexReceipt waiting. Show **Candidates considered** (one chosen, one proposed, one rejected as a duplicate) and expand **Tool trace (7 entries)**.
8. Switch to the schedule tab: without reloading, the board shows the hatched proposal lane (`03b-bryntum-pending-proposal-lane.png`).
9. Driver tab (reservation page): heading **Charging change proposed**. Read what changes and what does not (price unchanged, expiry). Click **Approve change**.
10. Schedule tab: banner "Schedule updated by recovery ... version 2", then reload to show it persists (`05-...`, `06-...`).
11. Driver tab: click **Run the synthetic overnight charge**. Wait about 8 seconds: the charging panel counts up slowly (it showed 25.60 kWh at 3 s before reaching the delivered total).
12. FlexReceipt: amount captured after delivery, energy delivered (about 30 kWh simulated), MOCK and SYNTHETIC badges (`14-flexreceipt.png`).
13. Impact slide (static text from `docs/IMPACT_SUMMARY.md`).

## E. Screen recording plan
- One continuous screen recording at 1080p, 30 fps, system audio off, voice-over recorded separately and laid over (so pauses can be trimmed). Cursor highlighted. Three tabs pre-arranged: driver, operator console, schedule.
- Cut points: 0:35 (after approval), 1:20 (after injection), 2:05 (after reload). Speed up only the 8-second count-up and the Bryntum load, never any result.
- Captions: "SYNTHETIC" and "MOCK payment" lower-third visible for at least 3 s at the start and at the receipt.

## F. Voice-over narration
Use the narration column of `docs/FINAL_DEMO_SCRIPT.md` for timing, keeping these truth-critical lines verbatim:
- At step 7: "In this recording no model key is configured, so the labelled deterministic path decides. A model, when present, can only choose among options the server has already validated. This is not a live Gemini decision."
- At step 12: "Payments are a mock provider, not PayPal. Charging is simulated."
- Closing: "These are synthetic model results, not measured savings."

## G. Expected actual results (from the evidence runs)
| Step | Expected |
|---|---|
| 3 | "Authorized, not captured." Price about $13, unchanged for the rest of the demo |
| 7 | Run status "Waiting for your approval", source FALLBACK, 7 trace entries, nothing committed |
| 9 | Schedule version stays 1 until the click |
| 10 | Version 2 (source RECOVERY); agreed terms and terms hash unchanged |
| 12 | Payment "CAPTURED - PAID", provider "MOCK (NOT PAYPAL)", energy delivered about 30 kWh (simulated) |

Known cosmetic issues on screen (do not hide them; do not call them out unless asked): the approved run card reads "Recovered automatically" (QA-4); the proposal text says "An earlier departure at 18:00" (QA-5); port labels are clipped in the Bryntum column (QA-6). All three are specified in `docs/QA_FINDINGS_AND_FIX_SPECS.md`. If they are fixed before recording, recapture the screenshots.

## H. Fallbacks
| Failure | Action |
|---|---|
| Bryntum chunk does not load | Show the accessible table under the timeline (same data) and say so; do not claim the timeline rendered |
| Run stays "Recovery running" | Wait 15 s; if it persists, reload the console; restart from a fresh database if needed |
| No feasible offer on the chosen night | Choose another future night |
| External service | None is used in this recording. If a Gemini key is configured and fails, the run is labelled fallback; keep the key unset for the take |
| Live Gemini or PayPal evidence absent | Keep the labels above; never describe the fallback as live |

## I. Evidence references
`01`, `02`, `03`, `03b`, `04`, `05`, `06` (early-departure journey); `10` to `14` (charger-slows journey to FlexReceipt); `20-operator-form-injection.png` (console with the recovery steps); `recovery-trace.json`, `recovery-trace-power-cut.json`; `bryntum-axe.json`; `bryntum-axis-by-browser-zone.json`. Regenerate with `docs/DEMO_RUNBOOK.md` section A and `tests/e2e/independent-operator-form.spec.ts`.

## J. Final video quality checklist
- [ ] Under 2:55; opens with the problem in one sentence
- [ ] "SYNTHETIC" and "MOCK" visible and spoken; no claim of live Gemini, PayPal certification, real chargers or measured savings
- [ ] Every number on screen readable for 2 s or more; price shown unchanged before and after recovery
- [ ] The consent click is shown, and the version stays 1 until then
- [ ] Bryntum update shown without reload, then after reload
- [ ] FlexReceipt shows amount, delivered energy and provider label
- [ ] Browser zone Pacific; no env file, key, token or personal account visible; tabs and bookmarks clean
- [ ] Audio clear, no clipping; captions on; export 1080p MP4
- [ ] Owner has watched it once end to end and approved before any upload
