# Recovery benchmark findings (SYNTHETIC)

Investigation of two results in `docs/RECOVERY_BENCHMARK.md` (seeds 1..200, DEMO_STATION, SYNTHETIC_ECONOMICS):

1. Recovery delivered less battery energy than the static plan in four column-level occurrences.
2. Fifty-six auto-committed recoveries raised the operator's energy cost.

All numbers are modeled from synthetic inputs. Nothing here is a field measurement.

Reproduction: a diagnostic copy of the benchmark loop (not committed) printed every scenario where the auto or approval column delivered less than static. The same figures are now regression-tested in `tests/unit/recoveryShortfall.test.ts` through `replayScenario` in `scripts/recoveryBenchmarkRun.ts`.

## 1. Energy shortfall versus static

The benchmark counts four column-level occurrences. They come from **three distinct scenarios**. Seed 91 counts in both the auto and approval columns, because the auto change was also applied under the approval column.

| # | Seed / reservation | Port, disturbance, effective slot | Column(s) | Static delivered (Wh) | Recovery delivered (Wh) | Target (Wh) | Recovery consent and change | Root cause |
|---|---|---|---|---|---|---|---|---|
| 1 | 91 / `res_91_port_c` | port_c, site cap 18 kW, slot 33 (09:15 UTC) | auto and approval | 14,996 (4 Wh short) | 14,950 (50 Wh short) | 15,000 | AUTO_COMMIT, `flex_early_finish`, finish 11:30 UTC (agreed ready-by 11:45) | Forecast error beyond headroom (see below) |
| 2 | 134 / `res_134_port_c` | port_c, departs 1 h early, slot 36 (11:00 UTC) | approval only | 40,020 (meets) | 39,997 (3 Wh short) | 40,000 | NEEDS_DRIVER_APPROVAL (earlier departure), finish 13:45 UTC (agreed ready-by 14:00) | Forecast error beyond headroom |
| 3 | 152 / `res_152_port_c` | port_c, departs 3 h early, slot 34 (09:30 UTC) | approval only | 16,008 (meets) | 15,985 (15 Wh short) | 16,000 | NEEDS_DRIVER_APPROVAL (earlier departure), finish 11:30 UTC (agreed ready-by 12:00) | Forecast error beyond headroom |

Common driver commitments (from the agreed quote): battery target as above, efficiency 92%, plug-in and agreed departure as recorded in the seeded night, price held at the agreed amount (cents: case 1 693, case 2 1586, case 3 686). Price never changed.

Slot detail, power in W, realized room is site cap minus realized base minus other sessions:

| Case | Slot (UTC) | Forecast base | Realized base | Forecast error | Planner room (forecast) | Realized room | Static planned | Recovery planned | Recovery delivered |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 10:00 | 2,200 | 3,500 | +1,300 | 4,000 | 3,700 | 3,800 | 4,000 | 3,700 |
| 2 | 11:15 | 2,100 | 3,200 | +1,100 | 10,100 | 10,000 | 7,500 | 10,100 | 10,000 |
| 3 | 09:30 | 2,500 | 3,600 | +1,100 | 9,700 | 9,600 | 3,500 | 9,700 | 9,600 |

Verified in every case: the replay reproduces the benchmark's static delivery exactly, and the recovered plan never exceeds the forecast room in any slot after the effective slot. The delivery loss happens only in the one slot named above.

**Root cause.** The planner checks capacity against the forecast base with a fixed 1 kW safety headroom (`DEMO_STATION.safetyHeadroomW`). In each case the realized base load exceeded the forecast by 1.1 to 1.3 kW in one slot, which is more than that headroom. Recovery concentrates energy into the early-finish window, and in that slot it fills the planner's forecast room exactly. The realized replay then clips the planned power to the room that actually exists. The static plan was lower in those slots (cases 2 and 3) or was clipped by a smaller amount (case 1), so it lost less.

In case 1 the realized site draw in slot 10:00 was 18,300 W against an 18,000 W cap, before the replay clipped it. The simulator clips deliveries to realized room; it does not allow the overdraw. The clipping is therefore consistent with the physics model.

**Classification: forecast-error exposure, a legitimate tradeoff of the planning policy, not an accounting defect and not a benchmark artifact.** The engine behaves as designed. The loss is the cost of planning against a forecast with a fixed 1 kW headroom when realized error in this synthetic model can reach 1.3 kW.

**No engine change.** Two options would close the gap, and both are policy decisions outside this task:
- raise the planning headroom, which changes every result in the benchmark;
- require recovered plans to meet the battery target under a stressed base load (forecast plus an error allowance).

**Addressed (forecast vs actual).** The check is now named `forecastEnergyMet` and consent/proposal screens call it "Planned energy (forecast)"; it is never proof of completion. Final fulfilment, the FlexReceipt and the capture/void decision use the synthetic energy ledger (`src/domain/deliveredEnergy.ts`), and any actual shortfall is shown to the driver in Wh (SYNTHETIC). The legitimate benchmark shortfalls are unchanged and still reported: seed 91 = 50 Wh, seed 134 = 3 Wh, seed 152 = 15 Wh, each regression-tested (`tests/unit` forecast-vs-actual). On a new agreement a ledger shortfall without a confirmed operator-attributable failure is escalated to the operator and moves no money (`settleFromLedger`).

## 2. Cost-raising auto-commits and operator margin

**Policy found.** `docs/08_ECONOMICS.md` line 25: an offer is published only if the driver discount is at least 25 c, operator contribution improves by at least 1 c against the immediate baseline, and price is within the spend cap. Contribution is price minus payment fee minus energy cost minus operating cost. The fee model is `paymentFeeBp` 349 plus `paymentFeeFixedCents` 49, and the operating cost is 120 c (all SYNTHETIC_ECONOMICS, assumptions, not PayPal quotes).

**Enforcement (already in place).** `src/domain/recovery.ts`, `evaluateCandidate`, calls `validateOfferEconomics` from `src/domain/economics.ts` with the agreed price, the candidate energy cost and the quote's immediate baseline. A failure returns `OPERATOR_INELIGIBLE`, and `classifyFailure` names `OPERATOR_ECONOMICS` when every candidate is blocked by it. Both entry points run through this check: the deterministic path through `recoverSession` and `revalidateSchedule`, and the model path through `validateRecoveryPlan`. `proposeRecovery` and `commitPermittedRecovery` accept only validated candidates. The price is taken from the agreed terms and is never changed.

**Result for the 56 cost-raising auto-commits.** Operator contribution after recovery, at the agreed price, compared with the immediate baseline:

| Measure | Value |
|---|---|
| Auto-committed recoveries that raised energy cost vs the agreed plan | 56 |
| Below the 1 c minimum against the baseline | 0 |
| Lowest margin against the baseline among them | 1 c (at the limit, still viable) |
| Sum of operator contribution change vs the agreed plan | -5,862 c |
| Fee and operating cost | included in every contribution figure above |
| Failure-remedy cost | not part of these contribution figures; a MODELED remedy (`FAILED_SERVICE_REMEDY_CENTS`, default 200 c) is recorded only for operator-failure voids in settlement, which the benchmark does not simulate |

Each of the 56 stays viable under the accepted constraint, so none is blocked. The driver price is unchanged in all 56. The -5,862 c figure is a change against the agreed plan, not a breach of the operator constraint. Policy says that extra electricity cost is acceptable while the constraint holds.

The benchmark now reports the margin directly: "Lowest operator margin" (1 c in auto, 1 c in approval) and "Applied changes below minimum operator margin" (0 in both). Regression tests cover a viable cost-raising auto-commit, a margin block, and the exact boundary (`tests/unit/recoveryShortfall.test.ts`). An integration test drives the orchestrator with a stricter minimum and checks that nothing is committed (`tests/integration/recoveryOrchestrator.test.ts`, scenario D).

The earlier OPEN entry for this in `docs/ARCHITECTURE.md` (policy decisions) is now marked resolved, and `docs/DEMO_SCRIPT.md` lists it under known gaps with the margin result. Under the policy above, cost increase is accepted while the margin constraint holds.

## Changes in this task

- `scripts/recoveryBenchmarkRun.ts`: shared scenario setup, `replayScenario` (explanation only), reservation id and per-column margin on each record.
- `scripts/recovery-benchmark.ts`: margin metric rows, invariant label now points to this file, margin definition.
- `tests/unit/recoveryShortfall.test.ts`: new, 7 tests.
- `tests/integration/recoveryOrchestrator.test.ts`: scenario D, 1 test.
- `docs/RECOVERY_BENCHMARK.md`: regenerated twice, byte-identical. Headline numbers unchanged.
- No engine behavior change in `src/domain/recovery*.ts`.

## Not verified

- The full vitest suite and Playwright were not run, as instructed.
- Whether 1.3 kW is typical forecast error is not established. It comes from one seeded synthetic model.
