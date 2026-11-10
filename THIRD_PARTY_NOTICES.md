# Third-party notices

Checked 2026-11-09 on branch `feature/combined-release`. This file covers the Bryntum packages used by the operator schedule (`/operator/schedule`). The generated lockfile list is in `docs/THIRD_PARTY.md`.

## Bryntum Scheduler Community 8.0.0

| Item | Value | Source |
|---|---|---|
| Packages | `@bryntum/scheduler-community` 8.0.0 and `@bryntum/scheduler-react-community` 8.0.0 | `package.json`, `npm ls` |
| License (npm registry) | `MIT` for both packages | `npm view <pkg>@8.0.0 license` (registry metadata, 2026-11-09) |
| License (Bryntum features page) | "Free · MIT license" for the Community tier | https://bryntum.com/products/scheduler/features/ (summarised fetch, 2026-11-09) |
| Bryntum license page | Lists only the End-User License and the OEM License. It does not mention a Community edition, MIT, or open source. | https://bryntum.com/products/scheduler/license/ (summarised fetch, 2026-11-09) |
| Integrity (core package) | `sha512-NcvzQqTy8zeOXrGT/mkHvdJyMeULYMZq/qDnBLSzX301k4uRmrrPQKD6oc7+jSs7xgukPLYbW4+xD9lro4rREw==` | `npm view ... dist.integrity` |
| Homepage | https://bryntum.com/products/scheduler/ | registry metadata |
| Copyright and license text inside the package | NOT VERIFIED. The package's `LICENSE` file was not read, because reading `node_modules/**` is denied by project settings and was not circumvented. | n/a |

### Status

- The Community tier is MIT according to two Bryntum-published sources: the npm registry and the features page.
- The license page is about the commercial End-User and OEM licenses. It does not contradict the MIT statement for the Community tier, but it also does not state it.
- The copyright notice and license text shipped inside the installed package are NOT VERIFIED.

### Owner action before any public release

1. Open the installed package's license file, or the license text on the npm package page, and confirm that it is the MIT text with the Bryntum copyright line.
2. Confirm with Bryntum that the Community tier is MIT for this use (the features page says so; the license page does not).
3. Keep this file and `docs/THIRD_PARTY.md` in step once confirmed.

### Scope of use

Only Community features are used: the scheduler, read-only display, custom event rendering, and tooltips. No Bryntum Pro or commercial package is referenced. No Bryntum source file, stylesheet, or icon is copied into this repository. The stylesheets are imported from the installed package.
