# Final integration result (V1 + V2 on one tree)

Branch `feature/final-integration` = `origin/main` + `feature/combined-release-V1` (32087423) + `feature/combined-release-V2` (1ee2f5ce). Nothing external was contacted: no PayPal order, no live Gemini call, no Neon connection, no deployment.

## How the two branches were reconciled
- **Application code: V1 wins.** V2 changed production code only for QA-1 (external-database migration safety). V1 already contains a stronger implementation (explicit `npm run db:migrate -- --status|--plan|--apply --confirm-database <fingerprint>`, sha256 checksums, advisory lock, drift detection, fail-closed `openPostgres`). V2's `scripts/db-migrate.ts`, `runExplicitMigration` and loopback auto-migration were therefore **not** merged. Conflicts were `package.json`, `src/server/db/client.ts`, `src/server/runtime.ts`.
- **V2 tests and docs kept.** All `independent-*` tests, `docs/evidence/`, QA, Devpost, demo and handoff documents are preserved.
- **Two V2 tests adapted to V1 behavior** (intent unchanged): `tests/unit/migrationSafety.test.ts` now asserts that every external database, including loopback, fails closed without writes unless `autoMigrate` is requested; `independent-agent-evidence.test.ts` test double gained the `provider` field V1 added to `StructuredLlm`.
- **QA-3 status (partly fixed).** V1's station-time axis labels make an hour-aligned browser zone (UTC) match the station axis, and label the repeated fall-back hour `1 AM PDT` / `1 AM PST`. A half-hour-offset browser zone (Asia/Kolkata) still gets native tick boundaries from its own zone. The two UTC tests are now ordinary assertions; the two Kolkata tests stay `test.fail` as a documented residual. Record demos in a Pacific-time browser.

## Finding status after integration
| ID | Severity | Status |
|---|---|---|
| QA-1 migration safety | High | Fixed (V1 implementation) |
| QA-2 operator-login limiter bypass via `x-forwarded-for` | Low | NOT FIXED, disclosed. Needs a trusted-proxy setting; not safe to guess. |
| QA-3 axis in browser zone | Medium | Partly fixed (see above) |
| QA-4, QA-5 copy | Low | NOT FIXED, disclosed |
| QA-6 clipped port labels | Info | NOT FIXED |
| Authorization/deadline race (V1) | High | Fixed, 15 tests on PGlite and real PostgreSQL |

No Critical or High finding remains open.

## Honest limitations (unchanged)
Bryntum markup has vendor axe findings (the table is the accessible alternative); manual drag/resize is intentionally disabled; no recovery-linked PayPal Sandbox evidence (standalone smoke artifacts from 2026-10-30 only, PayPal-Request-Id not recorded); no successful live Gemini decision recorded (one bounded attempt returned HTTP 504); Neon is missing migrations 003-005 and was not touched; all charging data, tariffs and savings are synthetic.

## Evidence classes
REAL PROVIDER: standalone Sandbox smoke artifacts only. MOCK: all payment flows in the test suites. SYNTHETIC: all charging, delivered-energy and savings numbers. UNVERIFIED/BLOCKED: live Gemini decision, recovery-linked Sandbox transaction, deployment.
