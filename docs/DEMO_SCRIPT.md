# Demo script (under 3 minutes, MOCK mode)

Goal: show that a charging plan survives a disturbance without moving money, that the operator's schedule updates, and that the driver is asked only when the agreed terms require it.

**Labels.** Run this demo in MOCK mode (`PAYMENT_MODE=mock`). The payment step says so on screen and is not PayPal. Disturbances are SYNTHETIC: they are injected by the operator and are not real charger faults. Real PayPal Sandbox evidence is in `docs/EVIDENCE.md` (historic standalone smoke only). A live Sandbox recovery run is NOT part of this demo and needs owner approval.

**Status of this script.** Written from the current UI code, not yet rehearsed in a browser. Click labels may differ slightly; check them before recording. Status: NOT TESTED in a browser.

## Setup (before recording, about 30 s)

1. `npm run dev`, then open `http://localhost:3000`.
2. Open a second window at `/operator` and sign in with the operator passphrase from your local environment.
3. Have `/operator/schedule` ready in a tab.

## Scenario A: successful Smart Flex (about 50 s)

| Step | Click or action | Say |
|---|---|---|
| 1 | `/drive`, open **Guided demo**, choose **Scenario A: Successful Smart Flex**, press **Load** | "Port C, 30 kWh, plug in at 19:00, leave at 07:00. Nothing is charged yet." |
| 2 | Press **See offers** | "The engine compares charging now with a flexible window. Both sides must be better off, or no offer is shown." |
| 3 | Compare the offers, then approve the lowest-cost one | "I approve this exact offer: merchant, amount, window. The server recomputes the amount from the stored offer." |
| 4 | Continue to the reservation, run the synthetic night | "The authorization is a hold. It is captured only after delivery is recorded. This is MOCK, not PayPal." |

## Scenario B: autonomous recovery after a disturbance (about 70 s)

Use a reservation from Scenario A (or a second approved request on Port C).

| Step | Click or action | Say |
|---|---|---|
| 5 | In the operator window, open the **Synthetic disturbance** panel. Choose the reservation, type **Charger power reduction** and set **Maximum port power (W)** to 1800, then press **Record disturbance** | "The charger is limited to 1.8 kW from a chosen slot. This is a labeled synthetic disturbance." |
| 6 | Watch the **Recorded disturbances** list and the recovery run | "The recovery engine re-plans only this session, from the effective slot onward. Energy already delivered stays as it was. Candidates are checked by the validators before anything is written." |
| 7 | Open the run detail | "The trace shows each tool call and what it decided. The model, if enabled, only picks among these server-listed candidates. Price is unchanged." |
| 8 | Open `/operator/schedule` and reload | "The Bryntum timeline now shows the new schedule version. The chart is read-only: nothing dragged on it is saved." |

If the change needs driver approval, do not claim auto-commit. Continue with Scenario D.

## Scenario D: early departure needs driver approval (about 40 s)

| Step | Click or action | Say |
|---|---|---|
| 9 | In the operator window, record **Early departure** with **Minutes early** set to 60 on a session | "The driver now leaves an hour earlier than agreed." |
| 10 | Recovery runs and reports **Needs driver approval** | "Finishing later than the agreed time, or leaving earlier, is not allowed without the driver. The system stops here." |
| 11 | Open the driver's reservation page at `/reservations/[id]` and read the **Needs your approval** card, then press **Approve** | "The driver sees the original commitment and the proposal side by side. Approval applies this exact version only; a stale or expired proposal is refused." |

## Scenario C: disturbance and recovery (about 60 s)

Uses the recovery architecture. The disturbance goes through the same route as the operator's Recovery engine (`POST /api/recovery/events`). Every step below is read from the persisted run, schedule and payment state. None of it is hardcoded.

| Step | Click or action | Say |
|---|---|---|
| 12 | `/drive`, **Guided demo**, **Scenario C: Disturbance and recovery**, **Load**, approve the offer and run the synthetic night (as in Scenario A) | "Port B, 30 kWh, 19:00 to 07:00. Charging is planned and authorized, not captured." |
| 13 | Operator window, `/operator`, set **Night of** to the same night and press **Load**. Select the session and press **Inject SYNTHETIC disturbance** with **Charger power reduced**, **Maximum port power (W)** 3600, **Effective slot** 0 | "A SYNTHETIC charger limit is recorded through the same API route the recovery engine uses." |
| 14 | Select the new disturbance in **Recorded disturbances** and read **Scenario C: recovery steps** | "Step 1 is the event. Step 2 is the agent run: it says MODEL or FALLBACK as the run record reports it. Step 3 is the deterministic validation result." |
| 15 | Read steps 4 and 5 | "Step 4 is the schedule: a new version is written only for an automatic commit or an approved proposal. Step 5 is consent. AUTO_COMMIT means the change was inside pre-approved bounds. NEEDS_DRIVER_APPROVAL means the driver must decide." |
| 16 | If step 5 says **NEEDS_DRIVER_APPROVAL**, open `/reservations/[id]` as the driver and press **Approve change**. If it is an infeasible result, the reservation shows **No feasible recovery** and the schedule is unchanged. | "The driver sees the original and the proposal side by side. A stale or expired proposal is refused." |
| 17 | On `/reservations/[id]`, press **Run the synthetic overnight charge**, then open the **FlexReceipt** | "The receipt lists the SYNTHETIC disturbance, the run, and the consent method." |
| 18 | Back on the operator checklist, read step 6 | "The financial step shows the payment state and the provider. This is the MOCK provider, not PayPal." |
| 19 | Open `/operator/schedule` | "The timeline shows the version the recovery wrote. The chart is read-only." |

Expected outcomes depend on the run. Do not promise one. The e2e test `tests/e2e/scenarioC.spec.ts` checks whichever status the run reports.

## Infeasible charging (drive page Guided demo "Scenario B", about 25 s)

| Step | Click or action | Say |
|---|---|---|
| 20 | `/drive`, **Guided demo**, **Scenario B: Infeasible charging**, **Load**, **See offers** | "Port A is 3.6 kW. Forty kWh cannot fit between 20:00 and 02:00. No offer is shown and nothing is authorized." |
| 21 | Read the explanation shown | "The explanation names the constraint. The driver can change the energy, the leave time or the port." |

Optional, if time allows: record a **Charger failure** on an active session. Recovery reports the physical limit (the vehicle stays on its port, and energy cannot move to another port). The session is not captured. Settlement follows the outdated-session policy in `docs/ARCHITECTURE.md`.

## Closing (about 15 s)

"Money follows delivered energy. The AI proposes only among options the server has validated, and it cannot touch payments. Everything in this demo is synthetic, and PayPal Sandbox recovery settlement has not been run."

## Known gaps to disclose if asked

- The operator console's **Inject outage** button still uses the older simulator outage, which voids the authorization. It is kept for the other scenarios and is not the recovery path. Scenario C uses the recovery path.
- Scenario C has not been rehearsed live with a model. The model path needs a configured key, which the MOCK demo does not use. The e2e run uses the labeled fallback.
- The Bryntum timeline has accessibility issues inside Bryntum's own grid (see `docs/BRYNTUM_NOTES.md`). The table view beside it is the accessible equivalent.
- The operator's energy cost can rise under auto-commit compared with the agreed plan (see `docs/RECOVERY_BENCHMARK.md`). Every automatic commit still has to meet the operator economics constraint (at least 1 c contribution improvement against the immediate baseline); see `docs/RECOVERY_BENCHMARK_FINDINGS.md`.
