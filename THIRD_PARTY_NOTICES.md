# Third-party notices

Checked 2026-11-09 on branch `feature/combined-release-V1`. This file covers the Bryntum packages used by the operator schedule (`/operator/schedule`). The generated lockfile list is in `docs/THIRD_PARTY.md`.

## Bryntum Scheduler Community 8.0.0

| Item | Value | Source (checked 2026-11-09) | Status |
|---|---|---|---|
| Packages | `@bryntum/scheduler-community` 8.0.0 and `@bryntum/scheduler-react-community` 8.0.0 | `package.json`, `npm ls` | VERIFIED |
| npm `license` field | `MIT` for both packages | `npm view <pkg>@8.0.0 license` (registry metadata) | VERIFIED (registry metadata only) |
| npm README text | Core: "The Community tier of Bryntum Scheduler is licensed under the MIT license. Copyright © 2009-2026, Bryntum." Wrapper: same, "The Community tier of Bryntum Scheduler and this wrapper are licensed under the MIT license." | `npm view <pkg>@8.0.0 readme` (registry text, not the installed package file) | VERIFIED (registry text) |
| Bryntum features page | Community tier: "Free · MIT license" | https://bryntum.com/products/scheduler/features/ (fetched 2026-11-09) | VERIFIED (public web page) |
| Bryntum license page | Names only the End-User License (perpetual; end users do not pay for access, e.g. an internal intranet app) and the OEM License (required for UI components in commercial products or SaaS redistributed to third parties for a fee). Does not mention Community, MIT or open source. | https://bryntum.com/products/scheduler/license/ (fetched 2026-11-09) | VERIFIED (public web page) |
| Integrity (core) | `sha512-NcvzQqTy8zeOXrGT/mkHvdJyMeULYMZq/qDnBLSzX301k4uRmrrPQKD6oc7+jSs7xgukPLYbW4+xD9lro4rREw==` | `npm view ... dist.integrity` | VERIFIED |
| Integrity (react wrapper) | `sha512-L2DnKJfCTjSjugdT0+RIKFXJVuOcTW7MzTakLIXwXGkBcf4XkqtHxm7SBOfn79ycKalnuxi0Y4bwubIMmrJvYw==` | `npm view ... dist.integrity` | VERIFIED |
| Copyright and license text inside the installed package (`LICENSE` file) | NOT VERIFIED. Reading `node_modules/**` is denied by project settings and was not circumvented. | n/a | NOT VERIFIED |

### Unresolved discrepancy

The registry metadata and the Bryntum features page say the Community tier is MIT. The Bryntum license page describes only the End-User and OEM licenses and does not mention a Community grant. The two sources do not contradict each other on the Community tier, but the license page does not state it, so the MIT grant rests on the npm metadata, the npm README and the features page.

This review does not resolve that discrepancy and does not assert more than the rows above.

### Owner action before any public release

1. Open the installed package's `LICENSE` file (or read the license text on the npm package page) and confirm it is the MIT text with the Bryntum copyright line. NOT VERIFIED until then.
2. Confirm with Bryntum that the Community tier is MIT for this use, given that the license page does not state it.
3. Keep this file and `docs/THIRD_PARTY.md` in step once confirmed.

### Scope of use

Only Community features are used: the scheduler, read-only display, custom event rendering, and tooltips. No Bryntum Pro or commercial package is referenced. No Bryntum source file, stylesheet, or icon is copied into this repository. The stylesheets are imported from the installed package.
