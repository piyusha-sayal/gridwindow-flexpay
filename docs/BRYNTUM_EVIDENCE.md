# Bryntum evidence

Status vocabulary: PASS / FAIL / NOT TESTED. All schedule data in these screenshots is SYNTHETIC (MOCK payments, simulated charging). The same schedule runs on the live site with PayPal Sandbox bookings.
Evidence files are in `docs/evidence/`. Screenshots were captured from the running production build by `tests/e2e/independent-recovery-evidence.spec.ts`, not mocked up.

## What the judge should see

A real recovery event produces a validated, persisted scheduling change that appears in the Bryntum Scheduler without a page reload and survives a reload.

| # | Moment | Screenshot | Result |
|---|---|---|---|
| 1 | Original charging schedule, one parked car on Port B | `evidence/01-original-schedule.png` | PASS |
| 2 | Disruption recorded; the open board picks it up by polling | `evidence/02-disruption-detected-bryntum.png` | PASS |
| 3 | Agent recommendation waiting for the driver (hatched proposal lane; driver consent card) | `evidence/03b-bryntum-pending-proposal-lane.png`, `evidence/03-agent-recommendation-needs-consent.png` | PASS |
| 4 | Validated recovery committed as version 2 after consent | `evidence/04-validated-recovery-committed.png` | PASS |
| 5 | Updated Bryntum schedule: "Recovered 7.2 kW" burst, notice "Schedule updated by recovery ... version 2" | `evidence/05-updated-bryntum-schedule.png` | PASS |
| 6 | Same result after a full reload (read from the database, not browser state) | `evidence/06-persisted-after-reload.png` | PASS |

A second journey (charger power limit, consent, delivery, FlexReceipt) is `evidence/10-...` to `evidence/14-flexreceipt.png`.
Recorded IDs, tool trace, candidates, validator outcome and committed versions: `evidence/recovery-trace.json` and `evidence/recovery-trace-power-cut.json`.

## What is verified

| Claim | Evidence | Result |
|---|---|---|
| The real Bryntum Scheduler is mounted (`.b-scheduler`, one row per port) | `tests/e2e/recoveryScheduler.spec.ts`, `independent-recovery-evidence.spec.ts` | PASS |
| Allocations come from persisted backend data (`GET /api/schedule`), not client state | same specs; the board is read-only and polls every 3 s | PASS |
| Original and recovered plans are both shown (lane toggle, "Original plan" / "Current (recovered)") | screenshots 05, 06 | PASS |
| Invalid changes cannot reach the schedule | the chart is read-only; commits go through the server validator (`commitScheduleVersion` tests; stale version, expired approval, lease fencing) | PASS |
| Accessible table alternative carries every session, with caption, column headers, original vs current kWh | `tests/e2e/independent-bryntum-a11y.spec.ts` | PASS |
| Keyboard reaches the lane toggle (Enter/Space) | `recoveryScheduler.spec.ts`, `independent-bryntum-a11y.spec.ts` | PASS |
| No serious/critical accessibility finding outside Bryntum's own DOM | axe, WCAG 2 A/AA + 2.1 AA, `evidence/bryntum-axe.json` | PASS |
| DST: station-zone axis skips 2 AM on spring forward and shows 1 AM twice on fall back (nights 2027-03-13 and 2027-11-06, real browser) | `tests/e2e/independent-bryntum-tz.spec.ts` | PASS |
| Tablet and phone widths: no page-level horizontal overflow | `recoveryScheduler.spec.ts` (Pixel 7, iPad gen 7) | PASS |
| Package license | installed `node_modules/@bryntum/scheduler-community/LICENSE` is the MIT text, "Copyright (c) 2009-2026 Bryntum AB"; `package.json` `license: MIT`; registry metadata also MIT; version 8.0.0 (React wrapper 8.0.0) | PASS (see caveat) |

License caveat: Bryntum's website describes an end-user and an OEM license and does not name a Community edition. The installed package ships the MIT text. The owner should keep that file's content in the submission evidence and confirm the package is the one intended.

## Known defects and vendor issues (not hidden)

### QA-3: the Bryntum time axis and the browser's time zone (labels fixed, one residual)
- Where: `src/app/operator/schedule/ScheduleChart.tsx` and `scheduleAxis.ts`. The table and all app labels use the station zone `America/Los_Angeles`.
- What we found first (real browser, `evidence/bryntum-axis-by-browser-zone.json`): the axis followed the browser's zone. For the night 2027-11-06, a Los Angeles browser showed 6 PM to 7 AM, an `Asia/Kolkata` browser 6 AM to 8 PM, and a UTC browser 1 AM to 3 PM, while the table said parked 18:30, departs 06:30. Bars were always placed by absolute time, so the data was right; the labels were not.
- Fix: the axis headers are now formatted in the station zone (`scheduleAxis.ts`), so labels match the table in Pacific, UTC and Kolkata browsers. See [BRYNTUM_NOTES.md](BRYNTUM_NOTES.md).
- Residual: Bryntum still places tick boundaries on the browser's own hours. In a half-hour-offset zone such as Kolkata, the ticks read 6:30 PM, 7:30 PM and so on, still in station time.
- Tests: `independent-bryntum-tz.spec.ts` checks two DST nights in UTC and Kolkata browsers. The two UTC tests pass. The two Kolkata tests are marked `test.fail()` for the residual and will report "unexpected pass" if Bryntum ever lines the ticks up.

### Vendor accessibility findings inside Bryntum's DOM (recorded by axe on 2026-11-09)
| Rule | Impact | Nodes |
|---|---|---|
| `aria-required-children` | critical | 2 |
| `color-contrast` | serious | 2 |
| `scrollable-region-focusable` | serious | 1 |

These are in Bryntum's own grid markup; app code does not override them. The timeline is not claimed to be fully accessible. The table view and the text summary are the accessible path.

### UX observations from the screenshots
- An earlier build clipped the port labels in the resource column ("Port A (3.6 k"). At desktop width they now show in full.
- The chart is read-only. Drag-to-edit is not a feature, which is the safe choice because no endpoint would persist it.

## Limitations to state in the submission
- Bryntum displays committed and proposed schedules; it does not originate changes. The engine validates and commits, then Bryntum reflects the persisted result.
- Charging energy and disturbances are SYNTHETIC. No real charger is integrated.
