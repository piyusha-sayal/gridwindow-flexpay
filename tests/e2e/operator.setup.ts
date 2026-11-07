/** Signs the operator in once per run (the login endpoint is rate limited to 5/min) and stores the session. */
import { expect, test as setup } from "@playwright/test";
import { OPERATOR_PASSPHRASE, OPERATOR_STATE } from "./constants";

setup("operator session", async ({ request }) => {
  const res = await request.post("/api/operator/session", { data: { passphrase: OPERATOR_PASSPHRASE }, headers: { Origin: "http://localhost:3107" } });
  expect(res.ok()).toBe(true);
  await request.storageState({ path: OPERATOR_STATE });
});
