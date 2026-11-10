# Demo script (under three minutes, MOCK mode)

Goal: show a driver's flexible charging plan being disturbed, re-planned without touching the agreed price or the energy already delivered, and the operator's schedule updating. The payment step is MOCK unless the owner has authorized a PayPal Sandbox run.

## Labels to say on screen

| Label | Meaning | When to use |
|---|---|---|
| MOCK PAYMENT PROVIDER | Built-in provider, not PayPal | Default. Say it at the approval step. |
| SIMULATED_EVENT | Disturbance injected by the operator, not a real charger fault | Every disturbance. |
| MODEL_DECISION | A live model really chose among the candidates | Only if the persisted run record says so. |
| DETERMINISTIC_FALLBACK | No model decision; the deterministic path decided | Default in MOCK mode (no Gemini key) and after any model failure. |

Do not say "AI chose this" unless the run record says MODEL_DECISION. Do not say "PayPal captured" or "PayPal voided" in MOCK mode.

## Pre-demo checklist

- [ ] `npm ci` and `npm run build` done on the machine (build needs network for fonts once).
- [ ] Start with MOCK settings, no `DATABASE_URL` set, and no PayPal secrets in the shell. `DEMO_TOOLS=true` only works in MOCK mode without `DATABASE_URL`.
- [ ] Use a fresh `.data/` folder, or "Reset demo data..." in the operator console, so the demo night is empty.
- [ ] Decide whether a Gemini key is configured. If it is, the run may still show DETERMINISTIC_FALLBACK. Read the label on screen; do not pre-judge it.
- [ ] Rehearse once end to end. The recovery outcome (COMMITTED, NEEDS_APPROVAL or INFEASIBLE) depends on the run. Do not promise one. The e2e test `tests/e2e/scenarioC.spec.ts` checks whichever status the run reports.
- [ ] Open three tabs: `http://localhost:3000/drive`, `http://localhost:3000/operator` (signed in with the operator passphrase), `http://localhost:3000/operator/schedule`.
- [ ] Use one browser window for the driver and one for the operator. The reservation page is opened as the driver.
- [ ] Check every label against the running build before recording. Labels below are taken from the code, not from a browser run of this script.

## Click path

Routes: `/drive` (driver wizard), `/reservations/<id>` (reservation, payment state, FlexReceipt), `/operator` (console, passphrase), `/operator/schedule` (Bryntum timeline plus accessible table).

### 0:00-0:20 The problem

Open `/` or go straight to `/drive`.

Say: "An EV needs a set amount of energy by a departure time. The site has a hard power cap. Most people do not care when it charges, as long as it is ready in the morning."

### 0:20-0:45 The driver picks a valid flexible plan

1. On `/drive`, open **Guided demo scenarios** and press **Scenario C: Disturbance and recovery** (Port B, 7.2 kW, 30 kWh, 19:00 to 07:00). The button only fills the form; nothing is submitted. Then set **Night of** to a future night and note that date for the operator.
2. Press **See offers**.
3. Compare **Charge now** with the flexible window. Point out the modeled price and the assumptions.

Say: "A flexible offer is shown only if the driver pays less and the operator's modeled contribution improves. Otherwise there is only immediate charging. Savings are modeled from synthetic tariffs."

### 0:45-1:00 Approval and authorization

1. Tick the consent box, then press **Approve $X with mock provider**.
2. On the reservation page, read the status. It should say the amount is authorized, not captured.

Say: "I approved this exact amount, merchant and window. The server recomputed the amount from the stored offer. This is the MOCK provider, not PayPal. An authorization is a hold, not a charge."

### 1:00-1:20 Simulated charger disruption

1. Open `/operator`, sign in, set **Night of** to the same night, press **Load**.
2. Select the session. In **Synthetic disturbance**, choose **Charger power reduction**, set **Maximum port power (W)** to 3600 and **Effective slot** to 0. Under **Fault attribution**, choose **Operator** only if you want to show the operator attribution (the choice is never preselected). Press **Inject SYNTHETIC disturbance**.

Say: "The charger is limited from this slot onward. This is a SIMULATED_EVENT. The operator records who is responsible for the fault, and the system never assumes it."

### 1:20-1:55 Recovery run and deterministic validation

1. In **Recorded disturbances**, select the new event. Read **Scenario C: recovery steps**. The seven steps are: Disturbance detected, Agent run, Deterministic validation, Schedule, Consent state, Financial outcome, FlexReceipt.
2. Read step 2. It shows MODEL_DECISION or DETERMINISTIC_FALLBACK, as the persisted run says.
3. Read step 3, the deterministic validation result.

Say: "The agent, if a model is configured, can only pick among candidates the server already validated, by id. It has no payment tool and no price input. Here the run reports [MODEL_DECISION / DETERMINISTIC_FALLBACK]. Every candidate was checked by the deterministic validators before anything was written."

If the run needs driver approval, go to step 4 below. If it is INFEASIBLE, say that the physical constraint blocks every schedule and the schedule is unchanged.

### 1:55-2:20 Bryntum timeline before and after

1. Open `/operator/schedule`. Use the **Original plan** / **Current (recovered)** toggle.
2. Point at the table beside the chart: agreed and current kWh, plan version and departure.

Say: "The timeline draws the persisted schedule. Changes that are only proposals appear in a separate lane and are labeled as proposals. The chart is read-only. Dragging on it saves nothing. The table is the accessible reference view."

If the driver must approve a change: open `/reservations/<id>` as the driver, read the **Needs your approval** card and press **Approve change**. Say: "Approval applies only this exact proposal version. A stale or expired proposal is refused."

### 2:20-2:40 Charging outcome and payment state

1. On `/reservations/<id>`, press **Run the synthetic overnight charge**.
2. Read the delivered energy from the synthetic ledger against the target, and the payment state.

Say: "Capture or void is decided from the synthetic delivered-energy ledger, not the forecast. A forecast that meets the target is labeled planned. Any shortfall is shown in Wh. In MOCK mode the payment state comes from the MOCK provider."

### 2:40-2:55 FlexReceipt and differentiation

1. Open the **FlexReceipt** on the reservation page.
2. Point at the SIMULATED_EVENT line, the run and the consent method.

Closing: "Money follows delivered energy. The AI proposes only among options the server has validated and cannot touch payments. Everything here is synthetic, and PayPal Sandbox recovery settlement has not been run."

## Optional: Scenario A and Scenario B

- Scenario A (Port C, 30 kWh) is the plain successful-charge path. Use it if the audience asks about the non-recovery path.
- Scenario B (Port A, 3.6 kW, 40 kWh, 20:00 to 02:00) shows an infeasible request. No offer is shown and nothing is authorized. Use it for a 20-second aside.

## Known gaps to disclose if asked

- **Inject outage** in the operator's reservation table uses the older simulator outage, which voids the MOCK authorization. It is not the recovery path.
- **Manual drag or resize** on the Bryntum chart is disabled. There is no server endpoint for it.
- **Bryntum accessibility**: axe reports violations inside Bryntum's own grid DOM. The table is the accessible path. Full timeline accessibility is not claimed.
- **Time labels**: the axis labels are station time. Tick boundaries still follow the browser's local hours, so a Kolkata browser shows half-hour ticks.
- **DST fall-back** night has not been browser-tested in UTC or Kolkata browsers.
- **Operator energy cost**: an auto-commit can raise the operator's energy cost against the agreed plan. The driver's price does not change, and the operator's 1 c minimum margin still holds (`docs/RECOVERY_BENCHMARK_FINDINGS.md`).
- **Settlement sweep** runs every 5 minutes in the background. The UI has no trigger, so do not show a settlement sweep as a live step.
- **Live model**: a real Gemini recovery call returned HTTP 504 (DEADLINE_EXCEEDED) once, and the deterministic fallback ran. A successful live MODEL_DECISION is not demonstrated.
- **Costs**: the remedy cost (200 cents by default, `FAILED_SERVICE_REMEDY_CENTS`) is a modeled operator cost, not a PayPal fee or a customer fee.
- **Recorded video**: none exists. Do not describe this script as a recording.
