# Third-party licenses (summary)

Generated from `package-lock.json` on 2026-11-07. The repository does not vendor any third-party source, fonts, images or datasets; dependencies are installed by `npm ci` and are not redistributed in this repository. This summary is informational, not legal advice.

## Production dependencies (including transitive)

| License | Packages | Note |
|---|---|---|
| MIT | 61 | Permissive; keep notices if you redistribute them. |
| Apache-2.0 | 27 | Permissive; includes patent grant and notice requirements on redistribution. |
| BSD-3-Clause | 12 | Permissive. |
| ISC | 4 | Permissive. |
| 0BSD, Unlicense | 2 | Public-domain-like. |
| CC-BY-4.0 | 1 (`caniuse-lite`) | Data set; attribution applies if its data is redistributed. |
| LGPL-3.0-or-later (alone or combined with Apache-2.0/MIT) | 14, all `@img/sharp-*` and `sharp-libvips` optional binaries pulled in by Next.js image optimization | Installed on the user's machine by npm, not copied into this repository or its build output. If you ever ship a bundle or container that includes these binaries, LGPL obligations (license text, relinking ability) apply to that distribution. |

## Development dependencies

MIT (395), MPL-2.0 (27), Apache-2.0 (19), ISC (16), BSD-2/3-Clause (8), BlueOak-1.0.0, Python-2.0, CC0-1.0. They are not shipped in the application. MPL-2.0 is file-level copyleft and only matters if those files are modified and redistributed.

## Fonts

Geist and Geist Mono are loaded from Google Fonts by `next/font` at build time under the SIL Open Font License 1.1. No font files are committed.

## Services

PayPal Sandbox, Google Gemini (optional) and Anthropic (optional) are used through their public APIs under their own terms. Free-tier Gemini content may be used by Google to improve its products, so do not enter personal data into the assistant.

## Bryntum Scheduler (Community)
`@bryntum/scheduler-community` 8.0.0 and `@bryntum/scheduler-react-community` 8.0.0. The installed package's `LICENSE` file is the MIT text, "Copyright (c) 2009-2026 Bryntum AB", and `package.json` declares `MIT` (checked 2026-11-09). Bryntum's website describes end-user and OEM licenses and does not name a Community edition; the owner should confirm this package is the intended one before submission.
