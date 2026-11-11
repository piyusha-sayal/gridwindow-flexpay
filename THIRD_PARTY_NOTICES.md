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
| Copyright and license text inside the installed package (`LICENSE` file) | MIT License text with "Copyright (c) 2009-2026 Bryntum AB". The same MIT text ships in all seven installed `@bryntum` packages, all at 8.0.0. The package README section "License and copyright" says: "The Community tier of Bryntum Scheduler is licensed under the MIT license." | installed files, read 2026-11-10 | VERIFIED |
| Bryntum licensing pages (2026-11-10) | https://bryntum.com/licensing/: "The Community tier is free and open source under the MIT license." https://bryntum.com/store/: "open source under the MIT license, including for commercial use." https://bryntum.com/tiers-faq/: "The Community tier uses the MIT license. It is free and open source." | public web pages, fetched 2026-11-10 | VERIFIED (public web pages) |
| Bundled third-party code in Bryntum (in-package `licenses.md`) | Lists bundled third-party components, including Font Awesome 6 Free. Their individual terms are in that file and travel with the package. | installed `licenses.md`, read 2026-11-10 | VERIFIED |

### Conclusion (2026-11-10)

Resolved. The installed `LICENSE` files, the package README and Bryntum's own licensing, store and tiers-FAQ pages all state that the Community tier is MIT-licensed, and the store page states that this includes commercial use. No source found restricts Community to non-commercial use. The earlier gap (the product license page names only the End-User and OEM licenses) is consistent with the licensing page, which presents those as the paid commercial licenses. The OEM clause sits under those commercial terms, not under the Community tier. No Business or Enterprise feature is used.

Obligations under MIT: keep the copyright line and permission notice with any copy of the software. The built client bundle contains Bryntum code, so this file must ship with any redistribution of the built app, and the notice below applies.

    Bryntum Scheduler Community 8.0.0 (and its core, engine, grid and React wrapper packages)
    Copyright (c) 2009-2026 Bryntum AB
    Licensed under the MIT License. The full license text is in each package's LICENSE file
    (node_modules/@bryntum/*/LICENSE). Bundled components are listed in each package's licenses.md.

Remaining owner check, optional: the npm package page could not be fetched (HTTP 403) on 2026-11-10; the registry `license` field was already confirmed as MIT on 2026-11-09.

### Scope of use

Only Community features are used: the scheduler, read-only display, custom event rendering, and tooltips. No Bryntum Pro or commercial package is referenced. No Bryntum source file, stylesheet, or icon is copied into this repository. The stylesheets are imported from the installed package.
