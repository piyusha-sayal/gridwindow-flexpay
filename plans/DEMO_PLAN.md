# Demo plan (≤ 2:55)

Every screen is labeled with its provider mode. MOCK footage must never be presented, cut or narrated as PayPal Sandbox. A PayPal Sandbox segment is recorded only after the user runs the approved sandbox steps with their own credentials and buyer account.

## Setup (before recording)

1. Start the app with embedded PGlite: no `DATABASE_URL`, `PAYMENT_MODE=mock`, `DEMO_TOOLS=true`.
2. Log in as the operator, then go to Demo tools → **Reset** (confirm) → **Seed night**. This creates background drivers through the real quote → accept → mock approval → authorize path.
3. Open the driver page (`/drive`) in a second window. Keep the default night and use **Port A**: the seed occupies ports B and C, which correctly leaves no flexible offer there.
4. Optional Sandbox segment: switch to `PAYMENT_MODE=paypal_sandbox` in a separate run. Demo tools are disabled there by design.

## Sequence

| Time | Screen | Show | Say |
|---|---|---|---|
| 0:00–0:15 | Home | Problem | Immediate charging vs flexible charging; the station has a power cap |
| 0:15–0:45 | `/drive` | Request → offers | Immediate baseline (comparison only), validated flexible offers, discount vs standard price, synthetic assumptions |
| 0:45–1:05 | Offer → terms | Consent | Exact merchant, amount, window and expiry; buyer approval required; AI explanation is labeled and grounded |
| 1:05–1:25 | Checkout | MOCK checkout (or Sandbox, if recorded) | Authorization only; **authorized ≠ captured** |
| 1:25–1:50 | `/operator` | Timeline, load chart, Deliver | The station stays under its cap; capture happens only after verified synthetic delivery |
| 1:50–2:10 | Reservation | FlexReceipt | "Paid … capture confirmed by provider" only with provider proof |
| 2:10–2:30 | Operator | Inject outage on a seeded reservation | Authorization voided, no payment collected; the bank may take time to drop the hold |
| 2:30–2:45 | Operator (MOCK) | Capture pending → resolve | Pending is not final; no second capture |
| 2:45–2:55 | `/benchmark` | Denominators, worse cases | 500 synthetic seeded scenarios, not real-world savings |

## Deterministic scenarios

- **Success:** Seed night → Deliver → CAPTURED.
- **Service failure:** Inject outage → VOIDED.
- **Provider pending or declined (MOCK only):** "Deliver · capture pending", then "Deliver · capture declined".
- **Infeasible request:** port C, 120 kWh, 05:00–07:00, $100 cap → "This request cannot be met before your departure" (as covered by the e2e scenario test).

## Capture checklist

- [ ] MOCK badge visible in every MOCK shot.
- [ ] No passphrase, `.env` contents or browser autofill on screen.
- [ ] No real customer data.
- [ ] Sandbox segment, if included: redacted IDs; recorded in one continuous take from approval to receipt.

## Limitations to state

- MOCK-verified only until sandbox credentials are provided.
- Synthetic tariffs and loads.
- AI runs in its fallback unless a key and budget are approved.
- No webhook registration without approval.

## Slow-provider recovery

If Sandbox stalls or times out, the reservation shows "being reconciled". Press **Reconcile** in the operator view.

Do not re-run checkout: same-key replays recover lost responses, and no second order is created after the quote expires.

If Sandbox stays unavailable, finish the demo on MOCK and say so on camera.

## Rehearsal results (2026-10-29, MOCK, automated)

`tests/e2e/rehearsal.spec.ts` follows this plan. App response time over all 11 steps is 4.8 s (`artifacts/qa/demo-rehearsal.json`). Three back-to-back runs on the same night passed. Presenter pace and narration, not the app, set the 2:55 length, so practise the narration against a stopwatch.

Unreliable or risky during a 3-minute recording:
1. **Port choice after seeding.** Ports B and C are occupied, so picking them shows "cannot be met". Use Port A. Found in rehearsal.
2. **Typing dates and times.** Segment order and 12/24-hour format follow the OS locale. Keep the default night, or type in the order shown on screen.
3. **Quote expiry (10 min).** Long pauses between "See offers" and "Approve" expire the offers; request again.
4. **Re-recording on the same night** adds more seeded drivers. Reset (with confirmation) or pick a new night between takes.
5. **AI explanation** shows the labeled deterministic fallback without a key. Narrate it as such; do not imply a live model.
6. **Pending/declined capture controls are MOCK-only.** Never show them in a Sandbox segment.

## Real-provider sequence (PayPal Sandbox + live AI) — NOT YET RECORDED

Prerequisites:
- The sandbox smoke run and the AI smoke run have passed (docs/EXTERNAL_INTEGRATION.md).
- This sequence is filmed only from genuine runs. No MOCK shot is cut into it.

| Time | Show | Evidence on screen |
|---|---|---|
| 0:00–0:20 | Problem and the driver's flexibility | Home page |
| 0:20–0:45 | Requirements → feasible offers | `/drive` offers, "Feasible · validated" |
| 0:45–1:10 | Economics + AI explanation | Badge must read "AI · claude-…", not "Deterministic fallback" |
| 1:10–1:35 | Exact terms → **PayPal sandbox checkout** (buyer approves) | PayPal sandbox page; may be pre-recorded from the same run |
| 1:35–2:00 | Authorization + committed schedule | "Authorized, not captured"; operator timeline |
| 2:00–2:25 | Synthetic charging → delivered | Progress bar, delivered energy before deadline |
| 2:25–2:45 | Capture confirmed by PayPal → FlexReceipt | Receipt label "PayPal Sandbox API", capture status COMPLETED |
| 2:45–2:55 | Operator benefit, benchmark, safe failure (void footage from a genuine sandbox run) | `/benchmark`, voided reservation |

Timing:
- Sandbox checkout (redirect, buyer login, approve, return) has not been measured yet; measure it during the first sandbox run.
- If it is longer than about 25 s, show the approval from footage of that same genuine run, and say so in narration ("approval sped up").
- Never re-type IDs or reuse IDs from another run.

## Flex Deal Agent clip (35–45 s, MOCK, deterministic fallback unless live AI is approved)

| t | Screen | Action / line |
|---|---|---|
| 0–6 s | /drive | Type "Find me 30 kWh before 7 AM and save at least $4." → **Fill form**. "The assistant only fills the form; every field stays editable." Show Minimum saving = 4.00. |
| 6–14 s | Offers | **See offers**. The Flex Deal Agent panel shows "Recommended for your goals": price, validated saving, charging window, source badge. |
| 14–22 s | Offers | Point to the "Agent recommends" badge, the ranking policy line and "Charge now · comparison only". "Every number comes from the backend quote." |
| 22–30 s | Change requirements | Set Minimum saving to 400 → **See offers**. "No offer meets your goals", with the best available saving. "It reports and never relaxes the goal." |
| 30–40 s | Review | Pick an offer → Review: the consent box is unchecked and Approve is disabled. "The agent recommends; only the driver approves." |

Say: savings are modeled from synthetic tariffs; the model holds no payment tools; MOCK provider, not PayPal.
