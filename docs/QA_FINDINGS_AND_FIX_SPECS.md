# Outstanding QA findings: status, minimal correction specs, retest plan

Baseline reviewed: `e066bdf` on `feature/combined-release-V2`. No production code was changed in this update. "Fixed" means a commit exists that changes the cited file and the retest below passes on it; until then the answer is NO.

| ID | Judge-visible in the demo? | Fixed? | Priority |
|---|---|---|---|
| QA-4 recovery approval wording | YES (reservation page and FlexReceipt screen) | NO | 1 |
| QA-5 departure time vs event time | YES (consent card, operator checklist) | NO | 2 |
| QA-3 Bryntum axis in browser zone | Only if recorded outside Pacific time | NO | 3 (mitigated by recording setup) |
| QA-6 clipped port labels | YES (Bryntum column) | NO | 4 |
| QA-2 login rate limit | NO | NO | 5 (security hygiene) |
| QA-1 external migration | n/a | YES, `f089afc` | done |

## QA-4: "Recovered automatically" shown after the driver approved
- Reproduction evidence: `docs/evidence/14-flexreceipt.png` (card reads "Recovered automatically ... so it needs your approval. Nothing changes until you approve it."); `docs/evidence/recovery-trace-power-cut.json`.
- Cause: after approval the run status is `COMMITTED`, whose label is "Recovered automatically" (`src/components/recoveryCopy.ts`, `RUN_STATUS_LABEL`), and the stored narrative is the `NEEDS_APPROVAL` text written at proposal time (`src/server/services/recoveryNarrative.ts`, `deterministicExplanation`).
- Minimal correction: when the run's consent method is a driver approval, label it "Approved by you and applied" and regenerate the narrative with the `COMMITTED` wording plus "You approved this change". Keep "Recovered automatically" only for consent method `AUTO_WITHIN_PRE_APPROVED_BOUNDS`. No change to consent logic or stored data.
- Retest: `npx playwright test tests/e2e/independent-recovery-evidence.spec.ts` plus a new assertion that the approved path never contains "Recovered automatically" or "Nothing changes until you approve"; existing `recoveryDriver.spec.ts` and `tests/unit/recoveryTools.test.ts` must still pass; recapture `14-flexreceipt.png` and `04-validated-recovery-committed.png`.
- Commit needed: the commit that edits `recoveryCopy.ts` / `recoveryNarrative.ts`.

## QA-5: "An earlier departure at 18:00"
- Evidence: `docs/evidence/recovery-trace.json` (outcome reason), `docs/evidence/20-operator-form-injection.png` (step 3 text). 18:00 is the disturbance's effective time (slot 0), not the new departure (06:00 in the evidence run).
- Cause: `deterministicExplanation` builds every head as `${eventLabel} at ${effectiveAt}`.
- Minimal correction: for `EARLY_DEPARTURE`, build the head from the new departure ("Your departure moved to 06:00 on charger B") and keep "at {time}" for power and capacity events. Add the new departure to the narrative facts.
- Retest: unit test on `deterministicExplanation` for each disturbance type; `tests/unit/recoveryTools.test.ts` grounding tests (the new time must be an allowed backend figure); recapture the consent card.
- Commit needed: the commit that edits `recoveryNarrative.ts` and its facts builder.

## QA-3: Bryntum axis follows the browser zone
- Evidence: `docs/evidence/bryntum-axis-by-browser-zone.json`; four `test.fail` tests in `tests/e2e/independent-bryntum-tz.spec.ts`.
- Finding added in this update: the installed Community build exposes no `timeZone` option (no match in the package typings), so the fix cannot be a prop.
- Minimal correction: give the scheduler a custom view preset whose header renderers format tick labels with `Intl.DateTimeFormat` in the station zone (the app already does this for table and event labels via `timeLabel`). Verify that tick boundaries stay hour-aligned in half-hour-offset browser zones (Asia/Kolkata); if they do not, show the station zone name in the axis title and keep the table as the reference.
- Retest: the four QA-3 tests flip to "unexpected pass" and must then have `test.fail` removed in the same commit; DST tests (spring forward, fall back) must still pass.
- Commit needed: the commit that edits `src/app/operator/schedule/ScheduleChart.tsx`.
- Until fixed: record the demo in a browser set to America/Los_Angeles.

## QA-6: clipped resource labels
- Evidence: `docs/evidence/05-updated-bryntum-schedule.png`.
- Cause: `ScheduleChart.tsx` renders `Port B (7.2 kW)` in a 150 px `resourceInfo` column with an avatar.
- Minimal correction: widen the column (about 200 px) or shorten to "Port B . 7.2 kW" and hide the avatar.
- Retest: `recoveryScheduler.spec.ts` (mobile and tablet overflow checks must still pass); recapture the schedule screenshots.

## QA-2: operator-login limiter
- Evidence: `tests/integration/independent-ratelimit.test.ts` (4 tests; reproduces the lockout without `TRUST_PROXY`, bounded brute force with it).
- Minimal correction: (1) require `TRUST_PROXY=true` for any deployed run (documented, and the payment preflight already checks it); (2) count only failed attempts toward the per-client and global limits, so a correct passphrase from a client that has not failed is never refused.
- Retest: the QA-2 tests are rewritten in the same commit to assert the new behavior (the "REPRODUCED" test inverts); `tests/e2e/operator.setup.ts` login must still work.
- Not demo-visible; do after the three UI items.
