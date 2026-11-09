# Bryntum Scheduler notes (operator schedule)

Scope: the operator schedule route `/operator/schedule` only. Bryntum is loaded with `next/dynamic` (`ssr: false`) from `src/app/operator/schedule/ScheduleBoard.tsx`.

## Final validation (2026-11-09, branch feature/recovery-engine)

Summary: Community 8.0 only, no commercial dependency. Items 2, 3, 5 and 6 PASS on e2e runs. Item 4 is PASS for the app's own time handling and NOT VERIFIED for the Bryntum axis. Item 1 is PARTIAL (license text not read locally).

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Installed versions and license evidence | PASS for versions, PARTIAL for license | See "Packages" below |
| 2 | Schedule persists after reload | PASS | `tests/e2e/recoveryScheduler.spec.ts`, test 1: the disturbance text is still shown after `page.reload()` and the server reports it |
| 3 | Agent-driven change appears without reload | PASS | Same test: the page polls every 3 s and shows the "Schedule updated by recovery" notice without navigation |
| 4 | UTC vs station time zone | PASS for the app mapping; NOT VERIFIED for the Bryntum axis; browser e2e NOT ADDED | `tests/unit/scheduleTimeZone.test.ts` (see below) |
| 5 | Responsive | PASS | `recoveryScheduler.spec.ts`: no page-level horizontal overflow at Pixel 7 and at iPad (gen 7) |
| 6 | Table fallback equals chart data | PASS | Unit test: the table's current kWh equals the sum of the chart burst energy per session (`scheduleTimeZone.test.ts`). Both read the same `ScheduleModel`. |

Commands run (targeted only, not the full suites):
- `npx vitest run` on `tests/unit/scheduleTimeZone.test.ts`, `tests/unit/recoveryDemoSteps.test.ts`, `tests/unit/scheduleModel.test.ts`: 27 of 27 pass. Repeated with `TZ=UTC`, `TZ=Asia/Kolkata` and `TZ=America/Los_Angeles`: 27 of 27 pass each time.
- `npx playwright test <spec> --workers=1` after `npx next build`: `recoveryScheduler.spec.ts` 5 of 5 pass (includes the new tablet test); `scenarioC.spec.ts` passes; `scenarios.spec.ts` 11 of 11 pass (the guided-demo scenarios).
- Not run: the full vitest and playwright suites (the lead runs them).

### Packages

| Package | Installed (`npm ls`) | Lock file (`package-lock.json`) | License |
|---|---|---|---|
| `@bryntum/scheduler-community` | 8.0.0 | 8.0.0, sha512 integrity recorded | `npm view @bryntum/scheduler-community@8.0.0 license` returns `MIT` (registry metadata, 2026-11-09) |
| `@bryntum/scheduler-react-community` | 8.0.0 | 8.0.0, sha512 integrity recorded | `npm view @bryntum/scheduler-react-community@8.0.0 license` returns `MIT` (registry metadata) |

- Conflict to resolve before release: the Bryntum license page (`https://bryntum.com/products/scheduler/license/`, fetched 2026-11-09) describes only the End-User License and the OEM License. It does not name a Community edition or MIT. The npm registry says MIT. Owner must confirm which governs the Community 8.0.0 package before any public release.
- `npm view` also reports `homepage` `https://bryntum.com/products/scheduler/`. The `repository` field is not set in registry metadata.
- `npm ls` (2026-11-09): `@bryntum/scheduler-community@8.0.0` and `@bryntum/scheduler-react-community@8.0.0` installed, the React package deduped onto the same core. Registry integrity for the core: `sha512-NcvzQqTy8zeOXrGT/mkHvdJyMeULYMZq/qDnBLSzX301k4uRmrrPQKD6oc7+jSs7xgukPLYbW4+xD9lro4rREw==`.
- The license text inside the installed package (its `LICENSE` file or `package.json` `license` field) was NOT read. Reading `node_modules/**` is denied by the project's `.claude/settings.json`, and that rule was not circumvented. The registry metadata is therefore the only license evidence. Owner review is still required before any public release.
- Bryntum is not listed in `docs/THIRD_PARTY.md`. Add it once the owner accepts the license evidence.

### Time zones (item 4)

- The app's time mapping uses absolute epoch milliseconds. `buildNightGrid` (`src/domain/time.ts`) anchors the grid by `Intl` wall-clock conversion in `America/Los_Angeles`. `toChartEvents` builds `startDate`/`endDate` with `new Date(ms)`. Labels come from `timeLabel(ms, stationTimeZone)` with `Intl`. There is no naive local-Date arithmetic, so no fix was needed in the mapping.
- Verified by unit tests:
  - Spring forward, night of 2026-03-07: 60 slots (15 elapsed hours). The 02:xx wall-clock labels never occur, and the slot at 10:00 UTC is labelled 03:00.
  - Fall back, night of 2026-10-31: 68 slots (17 elapsed hours). The repeated 01:00 hour gives two events one real hour apart. An occupancy from 00:00 PDT to 03:00 PST is 4 real hours.
  - The night of 2026-11-01 has no transition inside its grid (64 slots, 16 hours). The transition is on the early morning of 2026-11-01, which belongs to the night of 2026-10-31. The 25-hour calendar day of 2026-11-01 is therefore covered by the 2026-10-31 night tests.
  - Labels follow the station zone, not the process zone (`timeLabel(ms, "UTC")` differs from `timeLabel(ms, LA)`). The tests pass under three process time zones.
- Browser e2e for the axis was NOT added (2026-11-09). Reasons: (a) the DST nights 2026-03-07 and 2026-10-31 are in the past, and `seedDemoNight` (`src/server/services/demoService.ts`) skips plug-ins that have already passed, so those nights cannot be seeded through the existing helpers; (b) `seedNight` in `recoveryScheduler.spec.ts` uses a wall-clock night (`nightAt(26)`), so a DST test built on it is not deterministic; (c) the Bryntum time-axis DOM and any time-zone option could not be confirmed from docs (see below). A future-night variant (2027-03-13 spring forward, 2027-11-06 fall back) is a candidate, not yet run.
- Bryntum docs check (2026-11-09): the official Scheduler API and guide pages could not be retrieved (`/products/scheduler/docs/api` returned 404; the docs URLs returned the suite overview). No `timeZone` option, browser-local-axis statement, or tick-label formatter was found. Result: NOT FOUND, not confirmed as unsupported.
- NOT VERIFIED: how Bryntum draws its own time axis. Bryntum is assumed to use the browser's local time zone for the axis, while the event labels and the table use the station zone. The `timeZone` prop is rejected by the installed React wrapper's types (a `tsc` probe reported `TS2769` at that attribute). The Bryntum docs pages fetched on 2026-11-09 did not document a scheduler time-zone option, so none is used. A mismatch between the axis and the labels is possible when the operator's browser is not in the station zone. Revisit with a browser run in a non-station zone, or with the Bryntum API reference.

### Persistence and live updates (items 2 and 3)

- Every event on the chart comes from the persisted read model (`GET /api/schedule`). Pending proposals come from persisted recovery runs with status `NEEDS_APPROVAL`, drawn as a separate, hatched lane. They are not committed versions.
- The chart is read-only (`readOnly`). No endpoint persists a manual timeline edit, so nothing dragged on the chart is saved.
- The page polls every 3 seconds while the tab is visible. The chart is re-rendered only when the revision key changes, and its date props are memoized so scroll and zoom are not reset on a poll.

### Accessibility (item 6 and the vendor audit)

The table view (`ScheduleTable`) is the accessible equivalent. It is always rendered and reads the same model as the chart.

Audit run on 2026-11-09 with `@axe-core/playwright`, tags wcag2a, wcag2aa, wcag21aa, scoped with `include(".b-scheduler")`, desktop viewport, MOCK seed night:

| Rule id | Impact (axe) | Nodes | Where |
|---|---|---|---|
| `aria-required-children` | critical | 2 | Bryntum timeline grid body (`.b-grid-panel-body` / normal subgrid) |
| `color-contrast` | serious | 2 | Bryntum resource info cells (`.b-resource-info`) |
| `scrollable-region-focusable` | serious | 1 | Bryntum grid headers (`.b-grid-headers-normal`) |

- The earlier note said these were all "serious". The audit shows `aria-required-children` is `critical`.
- These findings are inside Bryntum's own DOM. App code cannot fix them without overriding Bryntum internals, which was not done.
- The e2e axe test (`recoveryScheduler.spec.ts`, test 2) excludes `.b-scheduler` and fails on any serious or critical violation elsewhere on the page. It does not prove the Bryntum timeline is accessible.
- Complete accessibility is NOT claimed for the timeline. The table and the text summary are the accessible path.

## Packages and how each API was verified

| Item | Version | Verified by |
|---|---|---|
| `@bryntum/scheduler-react-community` | 8.0.0 | `npm ls` (installed), `npm view` registry metadata |
| `@bryntum/scheduler-community` | 8.0.0 | `npm ls` (installed), `npm view` registry metadata |

- Component props (`startDate`, `endDate`, `viewPreset`, `resources`, `events`, `columns`, `readOnly`, `rowHeight`, `height`): accepted by `tsc` against the package types. A throwaway probe with a nonexistent prop was rejected, so the prop check is real. The probe file was deleted.
- CSS: `@bryntum/scheduler-community/scheduler.css` and `@bryntum/scheduler-community/svalbard-light.css` resolved in a `next build` (Turbopack module resolution).
- Docs used: https://bryntum.com/agents/common-mistakes (CSS order; "Pass config as JSX props; use a `useRef` to reach the underlying instance"). https://bryntum.com/agents/products/overview. https://bryntum.com/products/scheduler/features/ (Community tier table).
- Not confirmed by docs: the React guide and API reference pages were not retrievable through the docs tools. `.b-scheduler` class names used in tests are confirmed only by the rendered DOM.

## FontAwesome (not imported)

The docs say icons are not auto-bundled and need the FontAwesome stylesheets. The paths `@bryntum/scheduler-community/fontawesome/css/fontawesome.css` and `.../solid.css` did not resolve in the installed package (`next build` "Module not found"). They are not imported. The chart draws no icon glyphs (read-only, no toolbar), so this has no visible effect today.

## Community tier limitations hit or relied on

Source: https://bryntum.com/products/scheduler/features/

Not included in Community (and therefore not used):
- Time ranges and current-time line (`timeRanges`): disruption windows are a plain React list.
- Resource time ranges.
- Summary row and group/tree summaries: the capacity strip is plain React (`CapacityStrip.tsx`).
- Dependency editor, dependency context menu, dependency types.
- Drag to select multiple events, drag to pan, resize rows, drag to reorder resources.
- PDF export and print.

Included in Community and relied on: custom event rendering, event tooltips, resize events, drag and drop events, show dependencies. Manual drag is disabled (`readOnly`), so only the display features are used.
