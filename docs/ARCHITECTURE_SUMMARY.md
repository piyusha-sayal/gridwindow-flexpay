# Architecture in one page

**Idea.** A driver agrees to flexible overnight charging. If the plan is disrupted, software repairs it, but only with changes a deterministic engine has proven valid, only within what the driver consented to, and without ever letting an AI touch money.

```
Driver app (Next.js)            Operator console + Bryntum Scheduler
      |  accept one exact offer           |  records SYNTHETIC disturbance
      v                                   v
  API routes (same-origin, signed sessions, rate limits, zod validation)
      |                                   |
      v                                   v
 Offer engine ---> Accepted terms     Recovery event (idempotent by eventId)
 (integer units,    (immutable,             |
  independent        hash-bound)            v
  validator)                          Durable recovery run (lease + fencing, resumable)
      |                                     |  tools: requestRecoveryCandidates
      |                                     |         validateRecoveryPlan
      |                                     |         proposeRecovery
      |                                     |         commitPermittedRecovery / requestDriverApproval
      |                                     v         explainRecoveryOutcome   (no payment tool exists)
      |                    Decision source: Gemini (optional)  or  deterministic path
      |                                     |
      |                                     v
      |                    Deterministic validator + consent rules + operator-margin rule
      |                                     |  commit only with the expected schedule version
      v                                     v
 PostgreSQL (PGlite for judges): reservations, schedule_versions (append-only), recovery_runs, events, webhook_inbox
      |
      v
 Settlement: delivered-energy ledger decides. Capture once on delivery; void on operator-attributable failure;
 otherwise escalate to the operator. Provider read-back before any CAPTURED/VOIDED label.
      |
      v
 PayPal Orders v2 / Payments v2 (Sandbox only) or MOCK provider.  Signed webhooks verified on the raw body.
```

**Why it is trustworthy**
- The model (if present) can only choose among options the server already listed and validated. It cannot set a price, a schedule, consent, or call a payment function; refused tool calls are logged and ignored.
- Consent is enforced in code: a change that moves the departure or finish time waits for the driver's approval of the exact proposal version; proposals expire; stale versions are refused.
- Schedule commits are fenced by worker lease and schedule version, so a stale or duplicate worker writes nothing.
- Money follows delivered energy, not a forecast. One settlement operation per reservation, enforced by a unique index and state compare-and-set.
- Database changes are deliberate: startup verifies the schema of an external database and never migrates it (`npm run db:migrate` with confirmed target and version).

**Where Bryntum fits.** The operator board is the Bryntum Community Scheduler fed by `GET /api/schedule`. It shows original and recovered plans per port and pending proposals in a separate lane; every drawn bar is a persisted row. An HTML table carries the same data for accessibility.

**What is simulated.** Tariffs, base load, charging and disturbances are synthetic; the mock provider replaces PayPal in demos; no charger is integrated.
