# Bryntum Scheduler notes (operator schedule)

Scope: the operator schedule route `/operator/schedule` only. Bryntum is loaded with `next/dynamic` (`ssr: false`) from `src/app/operator/schedule/ScheduleBoard.tsx`. Verified on branch `feature/combined-release`, 2026-11-09.

## Verification summary

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Shows real backend allocations, occupied ports, deadlines, station power, committed schedule | PASS | Chart and table read only `GET /api/schedule` (persisted versions). `tests/unit/scheduleModel.test.ts`, `tests/unit/scheduleProposal.test.ts`. E2E `recoveryScheduler.spec.ts` test 1. |
| 2 | Reacts to recovery events without reload | PASS | E2E test 1: injected disturbance shows "Schedule updated by recovery" after polling (3 s), persists after reload. |
| 3 | BEFORE/AFTER: original agreed plan vs current recovered plan | PASS for the data, PARTIAL for the layout | Chart has an "Original plan" / "Current (recovered)" toggle, so only one lane is drawn at a time; there is no side-by-side drawing. Table shows agreed and current kWh, plan version, and departure. Unit: `scheduleProposal.test.ts` "before and after". E2E: `recoveryScheduler.spec.ts` "before and after" checks the chart, table and summary against the persisted run status (see the branch note below). |
| 4 | Proposals awaiting driver approval are "proposed, not committed" | PASS (unit), PASS (e2e for whichever run status occurred) | Proposal bursts are labelled "Proposal …", never "Recovered …"; they are excluded from the table's current kWh and from the committed lanes; the summary says "N proposal(s) awaiting driver approval, not committed."; a note sits under the chart. Source: `buildScheduleModel(view, proposals)`, proposals from `session.pendingApproval` only. |
| 5 | Meaningful validation feedback (why a recovery was rejected or infeasible) | PASS (unit), PARTIAL (e2e) | The disruption list shows the persisted run's `outcome.reason` (`runReason`). Unit: `scheduleProposal.test.ts` "why a recovery run ended". The e2e test asserts the reason text only if the run it injects is not committed and not awaiting approval. |
| 6 | Accessible table alternative equivalent to the chart | PASS | `ScheduleTable` renders from the same `ScheduleModel` as the chart. Unit: `scheduleTimeZone.test.ts` ("the table's current kWh equals the sum of the chart's burst energy"). |
| 7 | Time zone and DST in a real browser | DEFECT FOUND AND FIXED (axis labels); PASS after fix | See "Time zones" below. |
| 8 | Accessibility of the timeline (axe, `.b-scheduler` scope) | FAIL for the timeline (vendor DOM); table path PASS | See "Accessibility" below. |
| 9 | Licensing | PARTIAL (resolved to MIT per two Bryntum-published sources; in-package license text NOT VERIFIED) | See `THIRD_PARTY_NOTICES.md`. |

Commands run for this review (targeted only):
- `npx vitest run` on `scheduleAxis`, `scheduleProposal`, `scheduleTimeZone`, `scheduleModel`, `heroSchedule`: 40 of 40 pass.
- `npx tsc --noEmit`: no errors in files owned by this review. Errors remain in other agents' files (see "Not verified").
- `npx eslint` on owned files: 0 problems.
- `next build` through the lock: passes (`BUILD_RC=0`).
- `npx playwright test tests/e2e/recoveryScheduler.spec.ts --workers=1` through the lock: 9 of 9 pass (last run). Earlier run: 7 pass, 2 failed on wrong assertions in the new tests, now corrected.

Not run: the full vitest suite and the full Playwright suite (by instruction).

### Before and after: what the chart draws

- The chart shows one lane at a time. "Original plan" draws the agreed bursts and parked occupancy. "Current (recovered)" draws the latest committed version plus pending proposal bursts, labelled as such.
- The table shows both kWh columns and the plan version for each session, so the change is visible without the chart.
- A side-by-side chart is not implemented. It was not required to pass item 3, and Bryntum Community events on the same row would overlap without a layout change that was not tested.

### E2E branch note (item 3 and item 5)

The "before and after" e2e test injects one disturbance and then checks the page against the persisted run status. Which branch ran (COMMITTED, NEEDS_APPROVAL, or other) depends on the seeded session and the recovery engine. The run output does not record which branch ran. The test passes for whichever branch the persisted status selects. The other branches are not exercised in this run and are not verified.

## Time zones (item 7)

Station zone: `America/Los_Angeles`. Browser zones tested in a real Chromium page: `UTC`, `Asia/Kolkata` (reported as `Asia/Calcutta`), and `America/Los_Angeles`.

### Defect found

Before the fix, Bryntum's default header labels used the browser's zone, not the station's. Measured DOM (probe, before the fix): UTC and Kolkata rows on the night of 2026-12-05 (grid start 18:00 PST); Pacific row on the night of 2027-03-13:

| Browser zone | Axis labels from the DOM (first ticks) | Expected station labels |
|---|---|---|
| UTC | `2 AM 3 AM 4 AM …` | `6 PM 7 PM 8 PM …` |
| Asia/Kolkata | `7 AM 8 AM 9 AM …` (in the 2026 probe, the tick at 7 AM IST = 17:30 PST) | half-hour station ticks, e.g. `6:30 PM` |
| America/Los_Angeles | `6 PM 7 PM …` (2027-03-13 probe) | `6 PM 7 PM …` (matched) |

Event bar text (`Charging … 00:00-06:30`) was already station time in every zone, so axis and bar text disagreed in the UTC and Kolkata browsers.

### Fix

`src/app/operator/schedule/scheduleAxis.ts` builds the chart's `viewPreset` with a `day` and an `hour` header whose `renderer` formats the tick start in the station zone with `Intl.DateTimeFormat`. The mechanism is the `viewPreset` `headers[].renderer` option. The installed package's typings (checked with `tsc`) accept it with the signature `(startDate: Date, endDate: Date, headerConfig, index, timeline) => string`. The chart passes the memoized preset, so polling does not reset zoom or scroll.

### What remains after the fix

- Tick boundaries are still placed by Bryntum on browser-local hours. Labels are station time, and each label is the correct absolute time for its tick. For a zone that is a whole number of hours from the station, the ticks fall on station hours. For Kolkata (13.5 hours ahead in winter), the ticks fall on station half hours, so labels read `6:30 PM` and not `6 PM`. This is tested, not hidden.
- Bryntum's own time-zone option is not available in the installed Community package. `project={{ timeZone }}` and a `timeZone` prop on the React wrapper are rejected by `tsc` (TS2769, "does not exist in type ProjectModelCommunityConfig"). A third-party mirror of Bryntum's 5.6 docs describes a project-level `timeZone` option; it is not the 8.0.0 Community API and was not used.

### What is covered where

| Coverage | Test | Result |
|---|---|---|
| Spring-forward night 2027-03-13 (60 slots, 15 elapsed hours) and fall-back night 2027-11-06 (68 slots, 17 elapsed hours; the 2027-11-07 transition is inside it), including station hour labels and the repeated hour | `tests/unit/scheduleAxis.test.ts`, `tests/unit/scheduleTimeZone.test.ts` (2026 and 2027 nights) | PASS |
| Header renderer produces station labels, day and hour | `tests/unit/scheduleAxis.test.ts` | PASS |
| Axis labels in UTC, Kolkata and Pacific browsers on a winter night: UTC equals Pacific exactly, Kolkata shows half-hour ticks; bar text identical in all three; bar offsets from the leftmost bar match within 2 px across zones | `tests/e2e/recoveryScheduler.spec.ts` "axis labels are station time in every browser zone" | PASS |
| Spring-forward night in a Pacific browser and a UTC browser: no `2 AM`, `1 AM` followed by `3 AM` | e2e "spring-forward night" | PASS |
| Fall-back night in a Pacific browser: `1 AM` twice, `2 AM` once | e2e "fall-back night" | PASS |

Not covered: the fall-back night in the UTC and Kolkata browsers (not run); bar pixel positions across the DST transitions themselves (checked as text and offsets for the winter night only).

## Accessibility (item 8)

Scoped axe scan of `.b-scheduler` on the operator schedule (`@axe-core/playwright` 4.13.0, the night 2027-01-16, desktop viewport, run on 2026-11-09 through the lock). Results of the last run:

| Rule id | Impact | Nodes | Where |
|---|---|---|---|
| `aria-required-children` | critical | 2 | `.b-grid-panel-body`, `#b-scheduler-1-normalSubgrid` |
| `color-contrast` | serious | 2 | `.b-resource-info` cells in the resource column |
| `scrollable-region-focusable` | serious | 1 | `.b-grid-headers-normal` |

Same three rules with the `best-practice` tag added: no further rules. 17 WCAG checks pass inside `.b-scheduler`.

- These findings are in Bryntum's own grid DOM. App code cannot fix them without overriding Bryntum internals, which was not done.
- The e2e axe test (`recoveryScheduler.spec.ts`, test 2) excludes `.b-scheduler` and fails on serious or critical violations elsewhere on the page. It does not prove the Bryntum timeline is accessible.
- Keyboard path: the lane toggle is reachable and operable by keyboard (e2e test 2); the table is the accessible alternative, in a labelled scroll region with tab focus.
- Complete accessibility is NOT claimed for the timeline. The table and the text summary are the accessible path.

## Licensing (item 9)

Summary (details in `THIRD_PARTY_NOTICES.md`):
- Registry (`npm view @bryntum/scheduler-community@8.0.0 license`): `MIT`. Also `@bryntum/scheduler-react-community@8.0.0`: `MIT`.
- Bryntum features page (https://bryntum.com/products/scheduler/features/, summarised fetch 2026-11-09): the Community tier is labelled "Free · MIT license".
- Bryntum license page (https://bryntum.com/products/scheduler/license/, summarised fetch 2026-11-09): lists only the End-User and OEM licenses; it does not mention a Community edition. It does not contradict the MIT statement, but it does not state it.
- In-package LICENSE file and copyright text: NOT VERIFIED (`node_modules/**` is not read).

## Packages and how each API was verified

| Item | Version | Verified by |
|---|---|---|
| `@bryntum/scheduler-react-community` | 8.0.0 | `npm ls` (installed), `npm view` registry metadata |
| `@bryntum/scheduler-community` | 8.0.0 | `npm ls` (installed), `npm view` registry metadata |

- Props used: `startDate`, `endDate`, `viewPreset`, `resources`, `events`, `columns`, `readOnly`, `rowHeight`, `height`. Accepted by `tsc` against the package types.
- `viewPreset.headers[].renderer`: accepted by `tsc`; signature read from the TS2769 diagnostic (`(startDate: Date, endDate: Date, headerConfig, index, timeline) => string`).
- `timeZone` on the component or on `project`: rejected by `tsc` (not in the Community 8.0.0 types).
- CSS: `@bryntum/scheduler-community/scheduler.css` and `svalbard-light.css` resolve in `next build`.
- Docs used: https://bryntum.com/agents/common-mistakes (CSS order; config as JSX props; `useRef` for the instance). https://bryntum.com/products/scheduler/features/ (Community tier). The official Scheduler API and guide pages were not retrievable through the fetch tool (the suite overview page does not document the time axis).

## FontAwesome (not imported)

The `@bryntum/scheduler-community/fontawesome/css/*` paths did not resolve in `next build`. They are not imported. The chart draws no icon glyphs (read-only, no toolbar), so this has no visible effect today.

## Community tier limitations relied on

Source: https://bryntum.com/products/scheduler/features/

Not used (not in Community): time ranges and current-time line (disruption windows are a plain React list), resource time ranges, summary row (the capacity strip is plain React), dependency editor, drag to select, drag to pan, row resize, drag to reorder resources, PDF export and print.

Used: custom event rendering, event tooltips, resize and drag events (disabled by `readOnly`), show dependencies (not used for the schedule).

## Not verified

- Bryntum axis behaviour on a full DST-transition night in a non-Pacific browser (only the winter night was run in all three zones).
- Side-by-side BEFORE/AFTER drawing (not implemented).
- The in-package LICENSE text.
- Complete accessibility of the Bryntum timeline.
- Historical (this review's session only): `tests/unit/recoveryScheduler.test.ts` failed on `InjectionDraft.attribution`, and `tsc` reported errors in `tests/integration/recoveryAgentBoundary.test.ts` and `tests/unit/paymentCopy.test.ts`. Those were not edited here. On the final combined tree, `tsc` reports 0 errors and the full Vitest run passes (740 passed, 12 skipped).
