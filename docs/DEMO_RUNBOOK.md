# Demo runbook (reproducible, MOCK payments, SYNTHETIC charging)

## A. One-command reproduction of the evidence run
Regenerates every screenshot and trace in `artifacts/qa/evidence/` from a clean throwaway database. No external service is contacted.

```
npm ci
# PowerShell: blank every external-service variable for this shell
$env:DATABASE_URL=""; $env:MIGRATION_DATABASE_URL=""; $env:GEMINI_API_KEY=""; $env:ANTHROPIC_API_KEY=""; $env:PAYMENT_MODE="mock"; $env:GW_ISOLATED_DB="true"
npm run build
npx playwright install chromium
npx playwright test tests/e2e/independent-recovery-evidence.spec.ts --project=setup --project=desktop --workers=1
```
Outputs: `01..06` (early departure with consent), `10..14` (charger power limit to FlexReceipt), `recovery-trace*.json`.
Other evidence: `npx playwright test tests/e2e/independent-bryntum-tz.spec.ts tests/e2e/independent-bryntum-a11y.spec.ts ...`, `npx vitest run tests/integration/independent-agent-evidence.test.ts tests/unit/independent-benchmark*.test.ts`.

## B. Recording the live demo by hand
1. Env (local env file, never committed): `PAYMENT_MODE=mock`, `PAYPAL_ENV=sandbox`, `SESSION_SECRET` (32+ chars), `OPERATOR_PASSPHRASE` (12+ chars), `APP_BASE_URL=http://localhost:3000`, `DEMO_TOOLS=true`. Leave `DATABASE_URL`, `GEMINI_API_KEY` empty (embedded database, labelled fallback). With an external `DATABASE_URL` the app refuses to start until `npm run db:migrate` has been run deliberately.
2. `npm run build`, `npm start`, open `http://localhost:3000`. Set the browser to Pacific time (QA-3).
3. Sign in at `/operator`. Seed a background night if desired (operator demo tools).
4. Follow `docs/FINAL_DEMO_SCRIPT.md`.

## C. Scenario parameters (deterministic inputs)
| Item | Value |
|---|---|
| Driver request | Port B, plug-in 19:00, ready by 07:00, 30 kWh into battery, budget $20.00, flexible offer (lowest cost) |
| Early-departure journey | disturbance `EARLY_DEPARTURE`, new departure 1 h before agreed, effective slot 0; expect `NEEDS_APPROVAL`, consent, version 2 |
| Charger-slows journey | `CHARGER_POWER_REDUCTION`, 4,800 W from slot 16 (22:00 on a grid starting 18:00); expect `NEEDS_APPROVAL`, then consent and version 2. 3,600 W is infeasible for this charge (INFEASIBLE), a useful honest-failure example |
| Event ids | `qa-evidence-evt-0001`, `qa-evidence-evt-0002` (idempotent: re-sending the same body returns 200, not a new event) |
| Benchmark seeds | 1..200 (recovery benchmark); known shortfall seeds 91, 134, 152; `npm run benchmark:recovery` twice must give identical output |
| Agreed price in the evidence run | $13.03 (1,303 c), unchanged by recovery |

## D. Screenshot and video shot checklist
- [ ] Wizard with the request filled in (assumptions visible)
- [ ] Offer list with the flexible offer, discount, and "SYNTHETIC / MOCK" badges
- [ ] Consent step, then "Authorized, not captured."
- [ ] Bryntum: original plan
- [ ] Operator disturbance panel with the event typed (or the API call on screen)
- [ ] Bryntum: pending proposal (hatched lane) without reload
- [ ] Run trace showing tool names and the decision source label
- [ ] Driver consent card: what changes, what does not, price unchanged, expiry
- [ ] Bryntum: version 2 after approval, then after reload
- [ ] Synthetic run, FlexReceipt (amount, delivered kWh, MOCK and SYNTHETIC badges)
- [ ] Impact summary slide with the "synthetic, not measured" line
- [ ] Browser zone is Pacific; no secrets, tokens or `.env` on screen; no real names or accounts
- [ ] Video at most 2:55; upload and publish only after the owner approves

## E. Do not
Use the words "live Gemini", "PayPal certified", "real chargers" or "measured savings" unless the matching evidence exists (`docs/AGENTIC_COMMERCE_EVIDENCE.md`, `docs/PAYPAL_AI_EVIDENCE.md`).
