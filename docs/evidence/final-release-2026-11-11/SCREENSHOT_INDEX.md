# Screenshot index: final release, 2026-11-11

Commit `11cf209`. Details, environments and limitations for every image: [EVIDENCE_MANIFEST.md](EVIDENCE_MANIFEST.md).

## 01. Product experience

### 01-home-desktop.png
Home page of the live deployment. *[LIVE]*

![Home page of the live deployment.](01-product/01-home-desktop.png)

### 02-home-mobile.png
Home page on a 390 px phone. *[LIVE]*

![Home page on a 390 px phone.](01-product/02-home-mobile.png)

### 03-smart-charge-request.png
The driver states energy, port, window and budget. Not submitted here: submitting runs the live Gemini deal agent (quota). *[LIVE]*

![The driver states energy, port, window and budget. Not submitted here: submitting runs the live Gemini deal agent (quota).](01-product/03-smart-charge-request.png)

### 04-ai-assisted-form.png
The request box fills the form. On this isolated server there is no model key, so the deterministic parser answered. *[LOCAL, MOCK, FALLBACK]*

![The request box fills the form. On this isolated server there is no model key, so the deterministic parser answered.](01-product/04-ai-assisted-form.png)

### 05-validated-charging-offers.png
Offers priced under the station cap; the deal agent recommends the lowest-cost window. *[LOCAL, MOCK, SYNTHETIC, FALLBACK]*

![Offers priced under the station cap; the deal agent recommends the lowest-cost window.](01-product/05-validated-charging-offers.png)

### 05b-savings-goal-not-relaxed.png
No offer saves $4.00 (best $3.76): the agent says so and does not relax the driver's requirement. *[LOCAL, MOCK, SYNTHETIC, FALLBACK]*

![No offer saves $4.00 (best $3.76): the agent says so and does not relax the driver's requirement.](01-product/05b-savings-goal-not-relaxed.png)

### 06-recommended-offer-explanation.png
Every number in the explanation comes from the quote. *[LOCAL, MOCK, FALLBACK]*

![Every number in the explanation comes from the quote.](01-product/06-recommended-offer-explanation.png)

### 07-how-it-works.png
How it works. *[LIVE]*

![How it works.](01-product/07-how-it-works.png)

### 08-impact-lab.png
Impact Lab: compare charging now with Smart Flex on a synthetic model, labelled modeled, not measured. *[LIVE, SYNTHETIC]*

![Impact Lab: compare charging now with Smart Flex on a synthetic model, labelled modeled, not measured.](01-product/08-impact-lab.png)

## 02. PayPal payments

### 01-offer-consent.png
Exact terms, explicit consent checkbox. MOCK provider on this server; the live site shows the PayPal Sandbox badge here. *[LOCAL, MOCK]*

![Exact terms, explicit consent checkbox. MOCK provider on this server; the live site shows the PayPal Sandbox badge here.](02-paypal/01-offer-consent.png)

### 02-sandbox-checkout.png
Real PayPal Sandbox checkout (test money). Only the human can approve here. *[LIVE, SANDBOX]*

![Real PayPal Sandbox checkout (test money). Only the human can approve here.](02-paypal/02-sandbox-checkout.png)

### 03-authorization-confirmed.png
Authorized, not captured: capture waits for delivered energy. *[LOCAL, MOCK]*

![Authorized, not captured: capture waits for delivered energy.](02-paypal/03-authorization-confirmed.png)

### 04-authorized-not-captured.png
The hold is not a charge. *[LOCAL, MOCK]*

![The hold is not a charge.](02-paypal/04-authorized-not-captured.png)

### 05-successful-capture.png
$15.56 captured only after 30.02 kWh (synthetic) was delivered. *[LIVE, SANDBOX, SYNTHETIC]*

![$15.56 captured only after 30.02 kWh (synthetic) was delivered.](02-paypal/05-successful-capture.png)

### 06-flexreceipt.png
FlexReceipt: total paid equals the provider-confirmed capture. *[LIVE, SANDBOX, SYNTHETIC]*

![FlexReceipt: total paid equals the provider-confirmed capture.](02-paypal/06-flexreceipt.png)

### 07-operator-failure-void.png
Charger failure (synthetic): nothing delivered, the hold is voided, the driver pays nothing. *[LIVE, SANDBOX, SYNTHETIC]*

![Charger failure (synthetic): nothing delivered, the hold is voided, the driver pays nothing.](02-paypal/07-operator-failure-void.png)

### 08-zero-charge-receipt.png
FlexReceipt: $0.00 collected, authorization voided by the provider. *[LIVE, SANDBOX, SYNTHETIC]*

![FlexReceipt: $0.00 collected, authorization voided by the provider.](02-paypal/08-zero-charge-receipt.png)

## 03. Operator console and AG Grid

### 01-operator-dashboard.png
Operator console on the live deployment (PayPal Sandbox mode). *[LIVE, SANDBOX]*

![Operator console on the live deployment (PayPal Sandbox mode).](03-operator-ag-grid/01-operator-dashboard.png)

### 02-ag-grid-reservations.png
AG Grid: every reservation of the night with payment and service badges. *[LIVE]*

![AG Grid: every reservation of the night with payment and service badges.](03-operator-ag-grid/02-ag-grid-reservations.png)

### 03-ag-grid-needs-attention-filter.png
Filter to the reservations that need the operator. *[LIVE]*

![Filter to the reservations that need the operator.](03-operator-ag-grid/03-ag-grid-needs-attention-filter.png)

### 04-ag-grid-payment-status.png
Provider-confirmed payment states; a MOCK row from 2026-11-05 testing is flagged as such. *[LIVE, SANDBOX]*

![Provider-confirmed payment states; a MOCK row from 2026-11-05 testing is flagged as such.](03-operator-ag-grid/04-ag-grid-payment-status.png)

### 05-reservation-details.png
Detail drawer: provider evidence (PayPal Sandbox API) and the full event trail. *[LIVE, SANDBOX]*

![Detail drawer: provider evidence (PayPal Sandbox API) and the full event trail.](03-operator-ag-grid/05-reservation-details.png)

## 04. Bryntum and recovery

### 01-original-schedule.png
Original committed plan per port. *[LOCAL, MOCK, SYNTHETIC]*

![Original committed plan per port.](04-bryntum-recovery/01-original-schedule.png)

### 02-charger-power-reduction.png
A severe cut cannot be repaired: the engine says so, keeps the agreed terms and moves no money. *[LOCAL, MOCK, SYNTHETIC, FALLBACK]*

![A severe cut cannot be repaired: the engine says so, keeps the agreed terms and moves no money.](04-bryntum-recovery/02-charger-power-reduction.png)

### 03-recovery-proposal.png
The proposal waits for the driver; it is not part of the current plan. *[LOCAL, MOCK, SYNTHETIC]*

![The proposal waits for the driver; it is not part of the current plan.](04-bryntum-recovery/03-recovery-proposal.png)

### 04-deterministic-validation.png
Every candidate is checked by the deterministic validator before it can be proposed. *[LOCAL, MOCK, SYNTHETIC, FALLBACK]*

![Every candidate is checked by the deterministic validator before it can be proposed.](04-bryntum-recovery/04-deterministic-validation.png)

### 05-driver-consent-required.png
What changes, what does not (price, departure), expiry, approve or keep. *[LOCAL, MOCK, SYNTHETIC]*

![What changes, what does not (price, departure), expiry, approve or keep.](04-bryntum-recovery/05-driver-consent-required.png)

### 06-driver-approved-recovery.png
The exact approved proposal is committed. *[LOCAL, MOCK, SYNTHETIC]*

![The exact approved proposal is committed.](04-bryntum-recovery/06-driver-approved-recovery.png)

### 07-updated-bryntum-schedule.png
The timeline updates by itself after the commit. *[LOCAL, MOCK, SYNTHETIC]*

![The timeline updates by itself after the commit.](04-bryntum-recovery/07-updated-bryntum-schedule.png)

### 08-accessible-schedule-table.png
The same schedule as an accessible table, after a reload. *[LOCAL, MOCK, SYNTHETIC]*

![The same schedule as an accessible table, after a reload.](04-bryntum-recovery/08-accessible-schedule-table.png)

## 05. AI and agentic commerce

### 01-assistant-request-parsing-fallback.png
Request parsing by the deterministic fallback (no model key on this server). *[LOCAL, FALLBACK]*

![Request parsing by the deterministic fallback (no model key on this server).](05-ai-agentic-commerce/01-assistant-request-parsing-fallback.png)

### 02-deal-agent-recommendation-fallback.png
Deal agent pick from server-validated offers (deterministic fallback). *[LOCAL, FALLBACK]*

![Deal agent pick from server-validated offers (deterministic fallback).](05-ai-agentic-commerce/02-deal-agent-recommendation-fallback.png)

### 02b-deal-agent-goal-not-met-fallback.png
The agent reports a goal it cannot meet instead of relaxing it. *[LOCAL, FALLBACK]*

![The agent reports a goal it cannot meet instead of relaxing it.](05-ai-agentic-commerce/02b-deal-agent-goal-not-met-fallback.png)

### 03-recovery-decision-provenance.png
The run is labelled DETERMINISTIC_FALLBACK · no model decision. Live-model runs are in 09-verification. *[LOCAL, FALLBACK]*

![The run is labelled DETERMINISTIC_FALLBACK · no model decision. Live-model runs are in 09-verification.](05-ai-agentic-commerce/03-recovery-decision-provenance.png)

### 04-mcp-tools.png
Terminal transcript: 7 MCP tools; none moves money or accepts a price. *[TRANSCRIPT]*

![Terminal transcript: 7 MCP tools; none moves money or accepts a price.](05-ai-agentic-commerce/04-mcp-tools.png)

### 05-mcp-booking-preparation.png
Terminal transcript: offers, pick, checkout prepared, reservation waits for the human. *[TRANSCRIPT, MOCK]*

![Terminal transcript: offers, pick, checkout prepared, reservation waits for the human.](05-ai-agentic-commerce/05-mcp-booking-preparation.png)

### 05b-mcp-live-gear-search.png
Terminal transcript: the live MCP gear search returns real Channel3 products. *[TRANSCRIPT, LIVE]*

![Terminal transcript: the live MCP gear search returns real Channel3 products.](05-ai-agentic-commerce/05b-mcp-live-gear-search.png)

### 06-agent-stops-at-paypal-approval.png
The agent's link opens an approval page only a human completes (MOCK provider here; PayPal Sandbox on the live site). *[LOCAL, MOCK]*

![The agent's link opens an approval page only a human completes (MOCK provider here; PayPal Sandbox on the live site).](05-ai-agentic-commerce/06-agent-stops-at-paypal-approval.png)

## 06. Channel3

### 01-rewards-overview.png
Rewards: modeled savings. *[LIVE, SYNTHETIC]*

![Rewards: modeled savings.](06-channel3/01-rewards-overview.png)

### 02-channel3-product-cards.png
Live in-stock EV accessories from several merchants through Channel3. *[LIVE]*

![Live in-stock EV accessories from several merchants through Channel3.](06-channel3/02-channel3-product-cards.png)

### 03-channel3-product-details.png
Title, merchant, price and image of one live product. *[LIVE]*

![Title, merchant, price and image of one live product.](06-channel3/03-channel3-product-details.png)

### 04-channel3-mobile.png
The same cards on a 390 px phone. *[LIVE]*

![The same cards on a 390 px phone.](06-channel3/04-channel3-mobile.png)

## 07. APIMatic

### 01-developer-portal-home.png
Developer portal generated by APIMatic. *[LIVE]*

![Developer portal generated by APIMatic.](07-apimatic/01-developer-portal-home.png)

### 02-openapi-endpoints.png
API reference. *[LIVE]*

![API reference.](07-apimatic/02-openapi-endpoints.png)

### 03-accept-offer-api-reference.png
Accept offer: consent, terms hash and the approval link. *[LIVE]*

![Accept offer: consent, terms hash and the approval link.](07-apimatic/03-accept-offer-api-reference.png)

### 04-request-response-example.png
Generated request and response samples for requesting offers. *[LIVE]*

![Generated request and response samples for requesting offers.](07-apimatic/04-request-response-example.png)

### 05-typescript-sdk-documentation.png
Generated TypeScript SDK. *[LIVE]*

![Generated TypeScript SDK.](07-apimatic/05-typescript-sdk-documentation.png)

### 06-developer-portal-mobile.png
Portal on a 390 px phone. *[LIVE]*

![Portal on a 390 px phone.](07-apimatic/06-developer-portal-mobile.png)

## 08. Responsive verification

### 01-mobile-home.png
Home page on a 390 px phone (second screen). *[LIVE]*

![Home page on a 390 px phone (second screen).](08-responsive/01-mobile-home.png)

### 02-mobile-smart-charge.png
Smart Charge on a 390 px phone: steps, request box and the start of the form. *[LIVE]*

![Smart Charge on a 390 px phone: steps, request box and the start of the form.](08-responsive/02-mobile-smart-charge.png)

### 03-mobile-offers.png
Offers, 390 px. *[LOCAL, MOCK, SYNTHETIC]*

![Offers, 390 px.](08-responsive/03-mobile-offers.png)

### 04-mobile-rewards.png
Rewards, 390 px. *[LIVE]*

![Rewards, 390 px.](08-responsive/04-mobile-rewards.png)

### 05-tablet-operator.png
Operator console, 820 px tablet. *[LIVE]*

![Operator console, 820 px tablet.](08-responsive/05-tablet-operator.png)

