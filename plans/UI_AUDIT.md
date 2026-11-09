# UI / UX / AI implementation audit — 2026-10-29

Audit of commit `6c4196c` before the completeness sprint, then status after it. MOCK provider only.

## Before (6c4196c)

| Area | Finding |
|---|---|
| Working screens | Home, `/drive` (form → offers → consent → mock checkout), `/reservations/[id]` (status, synthetic run, FlexReceipt on CAPTURED/VOIDED), `/operator` (login, site load chart, port timeline, reservation table, deliver/outage/reconcile), `/benchmark` |
| Incomplete | Driver: no field validation feedback, no budget/preference beyond spend cap, no plug-in parsing, no infeasibility explanation (raw reason code), no merchant on terms. Receipt had no MOCK badge in its header; CAPTURE_PENDING / CAPTURE_DECLINED had copy but no receipt/outcome card. Operator: no baseline-vs-optimized comparison, headroom, tariff periods, discounts/contribution, attention list or per-reservation investigation; `touMcPerKWh` was fetched but never shown |
| Dead / static controls | None dead. Operator reservation link opened the driver page; pending/declined settlement could not be exercised from the UI |
| Missing backend | No AI; no way to script provider capture outcomes in MOCK; no demo reset/seed |
| Error handling | Generic errors only; VALIDATION_ERROR fields not mapped to inputs |
| Accessibility / mobile | Whole offer card was a `<label>` (nested interactive content once buttons are added); no automated a11y check; mobile covered only for driver spec |
| State consistency | Receipt correctly gated on provider proofs (no false success) — preserved |
| Missing E2E | Infeasible request, economic rejection, offer expiry, pending/declined settlement, refresh persistence, demo scenarios, AI fallback, axe, tablet layout |

## After (this sprint)

| Area | Status |
|---|---|
| Driver request | Validation with inline errors (`aria-invalid`/`aria-describedby`), units and hints, charging preference, AI/fallback request box (now also plug-in time and preference) |
| Offers | Feasibility badge, energy, window, deadline, price, discount vs standard (USD and %), per-variant rejection reasons, backend-computed infeasibility bound (`QuoteSet.capacity`), on-demand grounded explanation |
| Acceptance | Merchant, port, energy, schedule, list price, discount, amount, expiry, terms hash, MOCK badge |
| Reservation | Outcome card per payment state, progress bar, payment + charging badges, Q&A assistant, receipt for CAPTURED/VOIDED/PENDING/DECLINED with explicit settlement line |
| Operator | KPIs, interactive port timeline (focusable sessions), detail panel with evidence + events, attention highlighting, baseline vs optimized load + stats table, tariff shading + periods, MOCK-only pending/declined capture controls, dev-only demo seed/reset |
| Remaining gaps | See the tracker |

## QA certification (2026-10-29)

Keyboard-only journeys, geometric layout checks and full axe reports per viewport now run in `tests/e2e/qa.spec.ts`; defects found and fixed are listed in PROGRESS.md "Visual & operational QA pass". Screenshot visual review is pending the user (`artifacts/qa/gridwindow-screenshot-review.zip`).

## Sprint 10 audit and polish (2026-10-30, MOCK)

Baseline `013980a`. The audit was done from source plus DOM and geometry checks in Playwright. **Screenshots were not visually inspected by the agent:** a local token-optimizer hook blocks image reads, and that was not bypassed. Visual review: `artifacts/qa/gridwindow-ui-final-review.zip`.

### Findings (before) and status

| Priority | Screen | Finding | Status |
|---|---|---|---|
| CRITICAL | Driver request | After 07:00 local, the form defaulted to last night, so the default request failed with "Departure time has already passed". A first-time morning visitor hit an error without changing anything. The keyboard E2E journey failed at 08:17. The operator console had the same defect: between 07:00 and 10:00 it defaulted to last night, and "Seed background drivers" failed with the same error (operator keyboard E2E, 09:2x). | FIXED: both now use `driverDefaultNightOf` (unit-tested); the old `currentNightOf` (10:00 cutoff) was removed. |
| HIGH | Landing | No product visualization. Six process steps instead of the required five. The value proposition (driver saving plus operator demand management) was not stated in one sentence. | FIXED: hero with headline, one-sentence pitch, two CTAs, an overnight diagram drawn from the real synthetic tariff (labelled "illustration, not live data"), 5 steps, and a "What is simulated" section linking to the benchmark (including negative cases). |
| HIGH | Operator | KPIs had no active reservations, station capacity, headroom, modeled energy cost or operator contribution; contribution was hidden in a hint. | FIXED: 8 KPIs from a pure `nightSummary()`, unit-tested. |
| HIGH | FlexReceipt | No receipt number, merchant, issue time or totals block. The amount line for non-captured outcomes was implicit. No print layout. | FIXED: header (brand, receipt no., reservation ref, merchant, issued), totals block with "Total paid" shown as an amount only after a provider-confirmed capture (pending → "Pending — not final"; voided/declined → "$0.00 (not collected)"), Print button, print CSS. Settlement wording unchanged ("void" is never called a refund). |
| MEDIUM | Offers | No emphasis for the best offer, and no defined criterion. | FIXED: "Lowest price of N offers" badge plus accent card; criterion = minimum final price among backend-validated offers, ties → first listed (unit-tested). Shown only when there are 2 or more offers. |
| MEDIUM | Global nav | No current-page indication and a plain header. | FIXED: navy header with brand mark; `aria-current="page"` on the active section (E2E-tested). |
| MEDIUM | Design system | No radius/shadow scale, no shared table style, no hover/active button states, no loading skeleton. | FIXED: tokens (navy, radius, shadow), `.card-elevated/.card-accent`, `.data-table` (benchmark and operator tables), button transitions, `.skeleton` (static under reduced motion), operator loading skeleton. |
| MEDIUM | Responsive | Viewports were only tested at Pixel 7, iPad and desktop sizes. | FIXED: `visual-review.spec.ts` checks 320/375/412/768/1024/1280/1440 on 6 core screens for page-level overflow and elements escaping the viewport. |
| LOW | Driver form | Field grouping is unchanged (port, night, energy, times, cap, preference in one column/grid). | OPEN, needs a visual review decision |
| LOW | Charts | Readability of PowerChart and LoadPanel axis labels at 320 px is not geometry-testable (SVG text scales). | OPEN, needs manual visual review |
| LOW | Benchmark | Content unchanged apart from table styling; definitions and negative results were already visible. | OPEN, styling only |

## Sprint 11: targeted corrections from the owner's visual review (2026-10-30)

| Priority | Defect (owner review) | Fix |
|---|---|---|
| P1 | Benchmark at 320/412 px: headline results were only visible in horizontally scrolling tables. | FIXED. New "At a glance" section above the tables, read from `summary.json`: requests, optimized served, violations, optimized-cost-more counts per baseline. Bar summaries for infeasible requests, mean peak kW and mean modeled cost. Full tables kept. |
| P1 | Operator at 320/412 px: payment status and actions were off-screen in the table. | FIXED. Reservation cards below 1024 px show ref, port, window, energy, amount, charging state, payment state, a Details button and the same actions. Table kept at 1024 px and wider. |
| P1 | A voided reservation showed "+$4.52 operator contribution change" as if realized. | FIXED. `economicOutcome` splits REALIZED / PROJECTED / NOT_REALIZED. The detail panel shows the collected amount and "not realized · was projected". KPIs split projected contribution from captured revenue and realized contribution, and add simulated energy delivered. The calculation is unchanged. |
| P2 | Offers: a unique "lowest price" badge appeared on tied prices ($12.43 / $12.43). Charts were illegible at 320 px. | FIXED. Tie-aware badge. Charging time, max power and ready-by are shown per offer. Chart axis labels are HTML and legible at any width. |
| P2 | Receipt: audit detail crowded out the essentials. | FIXED. Essentials summary at the top. Terms hash, evidence, discount math and event trail are in collapsible sections that expand for print. Print media hides everything except the receipt. |
| P3 | MOCK banner was tall on mobile. | FIXED. One short line on mobile; the full text shows at 640 px and wider. |

Manual visual review of the Sprint 11 ZIP is still pending with the owner (image reads are blocked for the agent).

### Sprint 11 final refinements (2026-10-30)

1. Benchmark tile renamed to "Unfavorable pairwise comparisons" (41). The per-baseline denominators are kept.
2. "Needs attention" hint now matches how the count works: `ATTENTION_STATES` are the payment states that need operator action (NEEDS_RECONCILIATION, CAPTURE_PENDING, CAPTURE_DECLINED, FAILED). A voided outage is resolved, so it is not counted. Logic unchanged.
3. Receipt label is "Capture pending" with "$X USD authorized · not final, not yet paid" while a capture is pending. It never shows "Total paid" in that state.
4. The final progress step names the provider-confirmed outcome (`settlementStep`):
   - captured: done
   - voided: done
   - pending: in progress
   - declined: failed
5. Every printed page carries a footer: "GridWindow FlexReceipt FR-XXXXXXXX" plus "Page n of N" (`@page` margin boxes).

**UI FROZEN** as of this change. Further UI changes only for critical defects.

## Redesign "Window" (2026-10-31, branch `redesign/window`, MOCK)

Full UI redesign from `design/design_handoff_gridwindow_redesign/`. It is frontend only: no file under `src/domain`, `src/server`, `src/payments`, `src/app/api` or `scripts` changed.

| Area | Before | After |
|---|---|---|
| Chrome | Full-width MOCK banner, generic cards | Window tokens, Geist, header with provider pill, mobile Menu |
| Landing | Static illustration | Interactive HeroScheduler, priced from the synthetic tariff |
| Driver | One long page | 3-step wizard (request → offers → approve) with progress, live request summary, shared night axis, offer table/cards, sticky mobile CTA, reload and back/forward state |
| Reservation | Mixed status card | Independent Charging (battery, per-slot columns) and Payment (amount, verbatim copy, 6-step trail) panels |
| FlexReceipt | Card | 780 px paper sheet with hairline sections; printing unchanged |
| Operator | 8 equal KPIs, inline detail | 3 hero KPIs + strip, port lanes with tariff strip, over-cap site-load chart, table/cards, detail drawer, action toast |
| Benchmark | KPI cards + tables | Data-led H1, headline strip, 4 small multiples, request-by-request bars, navy offer economics, full tables, numbered methodology |

Certification:
- axe (all impacts, 3 viewports): 0 violations.
- Layout at 7 widths × 6 screens: 0 issues.
- Print: 5 sections, 3-page PDF.
- Review archive: `artifacts/qa/gridwindow-premium-redesign-review.zip`, with 57 before/after pairs, per-step states, manifest and summary.

The screenshots have not yet been visually inspected; they need the owner's review.
