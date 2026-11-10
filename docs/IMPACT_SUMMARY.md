# Verified impact and benchmark summary (SYNTHETIC)

Every figure here comes from a deterministic model with synthetic tariffs, loads and charging. Nothing is a measured field result and nothing is a real-world utility saving. Source: `scripts/recoveryBenchmarkRun.ts` (200 seeds, 5,820 scenarios), recomputed independently by `tests/unit/independent-benchmark.test.ts` and `independent-benchmark-breakdown.test.ts`; raw output `evidence/benchmark-breakdown.json`. Assumptions were not changed. Two runs are byte-identical.

## Why 3,975 of 5,789 scenarios still miss the energy target

The benchmark applies one disturbance to one agreed flexible charge, 12 disturbance severities per charge (485 charges). 31 scenarios do not apply, leaving 5,789.

| Cause | Scenarios | Reading |
|---|---:|---|
| Undisturbed plan already misses (forecast error, not a disturbance) | 5 of 485 charges | control: 480 of 485 undisturbed plans meet the target |
| Disturbance affected the charge | 4,672 | this is where all other misses come from |
| of which: recovered automatically (target met) | 56 | within pre-approved bounds, no prompt |
| of which: recovered after driver approval (target met) | 648 | driver accepts an earlier departure or later finish |
| of which: no feasible recovery in either column | 3,832 | physics: see below |
| of which: partial or otherwise unrecovered | 136 | recovery helps but cannot reach the target |
| Disturbance did not affect delivery | 1,117 | no recovery needed |

The 4,677 static misses are 5 pre-existing plus 4,672 caused by the disturbance. After recovery the misses are 4,621 (auto only) and 3,975 (with approval).

Why so many are infeasible: a disturbance that removes the physical ability to deliver cannot be repaired by rescheduling.

| Disturbance | Scenarios | Missed (static) | Missed (auto) | Missed (with approval) | No feasible recovery |
|---|---:|---:|---:|---:|---:|
| Charger failure | 1,455 | 1,455 | 1,455 | 1,455 | 1,455 |
| Charger power reduction | 1,455 | 1,402 | 1,348 | 799 | 803 |
| Site cap reduction | 1,455 | 1,066 | 1,064 | 1,021 | 907 |
| Early departure | 1,424 | 754 | 754 | 700 | 717 |

Charger failure is 100 % unrecoverable by design: no power means no energy. Those cases are where the settlement policy matters (an operator-attributable outage voids the authorization and the driver pays nothing). Early departure is a driver-requested deadline change: less time, less energy, recoverable only when a faster plan exists.

## Static scheduling versus adaptive recovery on identical scenarios

| Measure | Static (keep plan) | Auto recovery | Recovery with driver approval |
|---|---:|---:|---:|
| Delivered energy, all applicable scenarios | 119,776 kWh | 119,893 kWh (+0.1 %) | 122,943 kWh (+2.6 %) |
| Shortfall against targets | 51,489 kWh | 51,374 kWh | 48,331 kWh (-6.1 %) |
| Scenarios missing the target | 4,677 | 4,621 | 3,975 |
| Recoveries applied | n/a | 71 | 839 |
| Needed driver approval | n/a | 1,350 proposed | n/a |
| Finish later than agreed ready-by | n/a | 0 | 665 |
| Operator energy-cost increase (modeled) | n/a | 5,862 c over 56 recoveries | 28,256 c |
| Minimum operator margin vs immediate baseline | n/a | 1 c | 1 c |
| Applied changes below the minimum margin | n/a | 0 | 0 |
| Driver price change | n/a | none (agreed price is fixed) | none |

Capacity: not a recorded benchmark column. A recovery cannot be committed unless the deterministic validator accepts it (`commitScheduleVersion` tests refuse a plan that would exceed a reduced site cap), so a violating schedule is never applied.

## Negative and unfavorable outcomes (kept visible)

- Recovery delivered less than keeping the plan in three scenarios, all forecast error beyond the 1 kW headroom (benchmark seeds 91, 134, 152):

| Seed | Disturbance | Column | Shortfall |
|---|---|---|---:|
| 91 | site cap 18 kW | auto and approval | 50 Wh |
| 134 | departs 1 h early | approval | 3 Wh |
| 152 | departs 3 h early | approval | 15 Wh |

- 56 auto-applied recoveries raised the operator's energy cost (5,862 c total, modeled). They are accepted by policy because the operator margin stays at least 1 c above the immediate baseline in every one.
- With approval, 665 scenarios finish after the agreed ready-by time. These require the driver's explicit consent and are not applied silently.
- Most severe disturbances stay unrecoverable. The product's value there is honest handling (refusal to charge for undelivered energy), not rescue.

## Judge-ready statement

"In a seeded model of 485 flexible overnight charges hit by 12 kinds of disturbance, rescheduling could repair 15 % of the disturbed cases (704 of 4,672) and raised modeled delivered energy by 2.6 % when drivers approved; the rest were physically unrecoverable, and the system handles those without charging the driver for energy that was not delivered. These are synthetic model results, not measured savings."

Do not state: real energy or cost savings, real grid benefit, or any result from a real charger.
