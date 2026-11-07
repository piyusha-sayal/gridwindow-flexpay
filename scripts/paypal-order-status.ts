/**
 * READ-ONLY PayPal Sandbox order check: `npm run paypal:order -- <ORDER_ID>`.
 * Sends only the OAuth token request and one GET /v2/checkout/orders/{id}. Never creates,
 * authorizes, captures or voids. Prints no credentials, tokens, approval links or buyer details.
 */
import { log, ORDER_ID_FORMAT, reportFailure, sandboxSetup } from "./paypalSandboxCli";
import { inspectOrder } from "./paypalSmokeFlow";

async function main() {
  const orderId = process.argv.slice(2).find((a) => !a.startsWith("-"));
  if (!orderId || !ORDER_ID_FORMAT.test(orderId)) throw new Error("usage: npm run paypal:order -- <ORDER_ID>  (letters and digits only; the token= value of the approval link)");
  const { gw, expectedMerchantId } = await sandboxSetup("GridWindow order check");
  const r = await inspectOrder(gw, orderId, expectedMerchantId);
  const yes = (b: boolean) => (b ? "yes" : "no");
  log(`Order …${orderId.slice(-6)} (read-only GET):`);
  log(`  1. PayPal status:              ${r.status}`);
  log(`  2. Payee = expected merchant:  ${yes(r.payeeMatches)} (payee ${r.merchant})`);
  log(`  3. Amount USD 1.23:            ${yes(r.amountOk)} (${r.amountCents ?? "?"}c ${r.currency ?? "?"})`);
  log(`  4. Buyer approval complete:    ${yes(r.buyerApproved)}`);
  log(`  5. Authorizations:             ${r.authorizations.length ? r.authorizations.map((a) => `${a.id} ${a.status}`).join(", ") : "none"}; captured: ${yes(r.captured)}`);
  log(`  6. Approval link still offered: ${yes(r.approvalLinkAvailable)}`);
  log(`  Smoke reference: ${r.smokeRef ?? "not a smoke-script order"}${r.flow ? ` (flow: ${r.flow})` : ""}`);
}

main().catch((err: unknown) => reportFailure("PayPal order check", err));
