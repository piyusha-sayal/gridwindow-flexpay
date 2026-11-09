# Architecture

GridWindow FlexPay sells overnight EV charging flexibility. The engine decides what is feasible and profitable; PayPal holds and settles the money; the AI only talks.

```
 Driver request ──► /api/quotes ──► allocator ──► validator ──► economics ──► signed terms (hash)
                       │              (kW cap,     (independent   (driver > 0,     │
                       │               port ≠ flow) recompute)     operator ≥ min)  ▼
 AI (optional, no tools)                                              /api/checkout accept
   parse text → form fields                                           server recomputes amount
   explain backend offers                                                    │
   answer own-reservation Q&A                                                ▼
   (grounding filter)                                          PayPal Orders v2: create (idempotent)
                                                                          │ buyer approves on PayPal
                                                                          ▼
                                                              authorize  (AUTHORIZED ≠ captured)
                                                                          │
                                                          synthetic overnight run (simulator)
                                                              ┌───────────┴───────────┐
                                                        delivered                  failed/outage
                                                              ▼                        ▼
                                                   capture once (CAS + unique    void authorization
                                                   settlement index)
                                                              ▼                        ▼
                                              provider read-back = CAPTURED     provider read-back = VOIDED
                                                              └────► FlexReceipt ◄─────┘
```

## Layers

| Layer | Path | Role |
|---|---|---|
| Domain (pure, deterministic) | `src/domain/` | Integer units (cents, W, Wh). `allocator` (33 kW aggregate cap, per-port power, 92 % efficiency), `validator` (independent recompute), `economics`, `quotes`/`terms` (hash, expiry, approval deadline), `simulator`, `paymentState` (CAS transitions), `dealAgent`, `benchmark`. |
| Payments | `src/payments/` | `PaymentGateway` contract; `PayPalSandboxGateway` (sandbox host hard-coded); `MockGateway` (labeled MOCK). |
| Services | `src/server/services/` | quote, checkout, order creation (crash-safe, leased), settlement, reconcile, recovery sweep, webhook, views. |
| AI | `src/server/ai/` | `llm` (Anthropic SDK), `assistant`, `dealAgent` (server-orchestrated, read-only), `grounding`. |
| Persistence | `src/server/db/` | PostgreSQL via `DATABASE_URL`, else embedded PGlite in `.data/`. Append-only events and energy tables; triggers freeze accepted terms. |
| UI | `src/app/`, `src/components/` | Next.js App Router: `/drive`, `/reservations/[id]`, `/operator`, `/benchmark`. |

## Trust boundaries

1. **Money**: only the backend computes amounts, from the stored offer. The model never supplies a price; the grounding filter rejects numbers it was not given and capture claims unless state is `CAPTURED` with a provider proof.
2. **Consent**: the buyer accepts an unexpired `offer_id` with exact merchant, amount, window; PayPal OAuth is not consent.
3. **Truth**: `CAPTURED`/`VOIDED` are written only after provider read-back (verified webhook or API). Webhooks are verified against the raw body, deduplicated by event id, and retried (503) when the provider is unreachable.
4. **Failure**: any shortfall or outage voids; no partial capture. Uncertain financial outcomes go to `NEEDS_RECONCILIATION`.
5. **Environment**: startup refuses anything but `PAYPAL_ENV=sandbox`; demo tools exist only in MOCK mode.

## Payment states

`QUOTE_ACCEPTED → ORDER_CREATED → BUYER_APPROVED → AUTHORIZED → (CAPTURE_PENDING) → CAPTURED | CAPTURE_DECLINED | VOIDED`, plus `CANCELLED`, `FAILED`, `NEEDS_RECONCILIATION`. Transition table: `src/domain/paymentState.ts`.

## Evidence map

| Claim | Test / artifact |
|---|---|
| Physics and cap never violated | `tests/unit/physics.test.ts`, benchmark `violations=0` |
| Both parties win on every published offer | `tests/unit/economics.test.ts`, benchmark `validatorFailures=0` |
| Payment safety, recovery, idempotency | `tests/integration/{paymentSafety,recovery,lifecycle,certification}.test.ts` |
| AI cannot inject prices or capture claims | `tests/unit/assistant.test.ts`, `tests/integration/dealAgent.test.ts` (scripted model offline; one genuine Gemini run is summarized in `docs/EVIDENCE.md`) |
| Genuine PayPal Sandbox authorize→capture and authorize→void | [EVIDENCE.md](EVIDENCE.md) (standalone smoke, 2026-10-30) |
