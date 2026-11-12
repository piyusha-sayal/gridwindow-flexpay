# PayPal + AI evidence

What we verified locally with the MOCK provider, and what we verified live with PayPal Sandbox on the deployed app. Identifiers are shortened to their last characters.

## Verified locally (MOCK provider, in-memory database)

| Property | Evidence | Result |
|---|---|---|
| Accepted offer integrity: the amount is recomputed from the stored offer, and terms can't change after acceptance (database trigger) | `independent-security.test.ts` (price update rejected), `paymentSafety.test.ts`, `termsHashStability.test.ts` | PASS |
| Authorization semantics: capacity is committed only after a provider-confirmed authorization; a late authorization is voided | `paymentSafety.test.ts` | PASS |
| Capture and void state machine: no capture after a void, no exit from final states, capture needs delivery | `payments.test.ts`, `independent-security.test.ts` (0 provider capture calls after a void or before delivery) | PASS |
| No duplicate financial operation: repeated and concurrent settlement gives exactly 1 provider capture, 1 CAPTURE operation, 0 VOID | `independent-security.test.ts` | PASS |
| Webhook integrity: unverified gives 401 and no write; oversized gives 413; a verified duplicate is processed once; a hostile "capture completed" event cannot create CAPTURED | `independent-security.test.ts` | PASS |
| Provider reconciliation after a timeout or an ambiguous result | `reconciliationSweep.test.ts`, `paymentSafety.test.ts` | PASS |
| No AI payment tool: the recovery tool allowlist has none; a model asking for one is refused and the gateway is not called | `recoveryTools.test.ts`, `independent-agent-evidence.test.ts` | PASS |
| Settlement follows actual energy: capture or void follows the delivered-energy ledger, not the forecast | `recoveryShortfall.test.ts` | PASS |
| Fault attribution: only an operator-caused failure voids automatically; any other shortfall goes to the operator with a stored deadline and moves no money; agreements from before the policy keep the earlier rule | `settlementPolicy.test.ts`, `outdatedSettlement.test.ts` | PASS |
| Recovery never raises the price | benchmark (price unchanged in every applied recovery); `routes` and terms-hash tests | PASS |
| FlexReceipt matches the reservation (amount, delivered energy, payment state) and labels MOCK | screenshot [evidence/14-flexreceipt.png](evidence/14-flexreceipt.png) (MOCK payment, SYNTHETIC charging; $13.03 paid, 30.02 kWh) | PASS |

## Verified live on the deployed build (2026-11-11)

The team ran these on the public Render deployment (`PAYMENT_MODE=paypal_sandbox`, Neon database), approving each payment by hand in the PayPal Sandbox window. We then read the results back through the operator API, using GET requests only.

| | Transaction A: authorize, deliver, capture | Transaction B: authorize, outage, void |
|---|---|---|
| Reservation | `…H62XfQtp`, Port A, 30 kWh target, night of 2026-11-10 | `…C2afKCrn`, Port A, 30 kWh target, night of 2026-11-12 |
| Agreed price | $15.56 | $15.56 |
| Provider proofs (all `evidenceSource: PAYPAL_SANDBOX_API`) | ORDER_CREATED (PAYER_ACTION_REQUIRED), BUYER_APPROVED (APPROVED), AUTHORIZED (CREATED, 00:18:40Z), CAPTURED (COMPLETED, 1556 c, 08:21:40Z) | ORDER_CREATED 08:55:21Z, BUYER_APPROVED 08:56:07Z, AUTHORIZED (CREATED, 08:56:09Z), VOIDED (VOIDED, 1556 c, 08:56:54Z) |
| Synthetic delivery | DELIVERED, 30.015 kWh of 30.000 kWh, no outage | FAILED, 0 Wh of 30.000 kWh, `outageInjected: true`, every slot `limitedBy: OUTAGE`, triggered by the operator |
| Settlement rule applied | Delivered energy meets the target: one capture of the agreed amount | Nothing delivered: one full void, $0 collected |
| Signed webhooks verified | 2 `WEBHOOK_VERIFIED` events | 3 `WEBHOOK_VERIFIED` events, the last 4 s after the void |
| Deployed commit at the time | `e2ddf08` (same runtime code as `19fa76e`) | `19fa76e` |
| Screenshots | `evidence/final-release-2026-11-11/02-paypal/05-successful-capture.png`, `06-flexreceipt.png` | `07-operator-failure-void.png`, `08-zero-charge-receipt.png` |

The same day, two more Sandbox bookings went through a recorded disturbance before they settled. One had a driver-approved recovery and was then captured (`…n-qKqgUM`). The other was voided under the fault-attribution policy after the recovery found no feasible fix (`…kfgzxjBp`). The timeline for both is in [the release verification report](FINAL_RELEASE_VERIFICATION_2026-11-11.md#k-addendum-the-final-submitted-build-later-on-2026-11-11).

Status: **PASS** for provider-confirmed capture and void through the app on the deployed build, including settlement after a recovery run, all with signature-verified webhooks. Not covered live: duplicate webhook delivery and provider timeouts. The automated tests above cover those on the MOCK provider and the offline provider fake.

## How the live Sandbox runs were done

To repeat them with your own Sandbox credentials:

1. Use a database that already has migrations 001 to 005 ([MIGRATIONS.md](MIGRATIONS.md)), a Sandbox merchant app and a Sandbox personal (buyer) account. Set `PAYMENT_MODE=paypal_sandbox`, `PAYPAL_ENV=sandbox` and `PAYPAL_EXPECTED_MERCHANT_ID`, and leave `DEMO_TOOLS` unset.
2. Serve the app over HTTPS with `APP_BASE_URL` set to that address, and register a webhook with `PAYPAL_WEBHOOK_ID` (event list in [PAYPAL_CERTIFICATION.md](PAYPAL_CERTIFICATION.md) section 3). `npm run payment:preflight -- --night-a <future night> --night-b <future night>` should print READY.
3. **Capture:** book Port A for 30 kWh, approve the exact terms, and approve the payment by hand in the PayPal Sandbox window. The reservation shows "Authorized, not captured". Run the synthetic delivery, and you get one capture. Check it with `npm run paypal:order -- <ORDER_ID>`, which reads the order back from PayPal.
4. **Void:** book again, and after the authorization press **Inject outage** in the operator console. Delivery is 0 kWh, there is one void and no capture, and $0 is collected.

Stop if an amount doesn't match, if a reservation gets a second provider operation, or if anything shows CAPTURED without a provider read-back.
