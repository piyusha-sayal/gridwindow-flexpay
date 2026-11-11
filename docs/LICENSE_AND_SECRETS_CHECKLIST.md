# License and secrets checklist (recovery engine, 2026-11-09)

## Bryntum packages

| Package | Version (from `package.json`) | License | Status |
|---|---|---|---|
| `@bryntum/scheduler-community` | 8.0.0 (`npm ls`; lock file entry present) | `npm view ... license` = `MIT` (registry metadata, 2026-11-09). The in-package LICENSE file was NOT read (`node_modules` read denied). | PARTIAL: owner review required. |
| `@bryntum/scheduler-react-community` | 8.0.0 (`npm ls`; lock file entry present) | `npm view ... license` = `MIT` (registry metadata). In-package license file NOT read (same reason). | PARTIAL: owner review required. |

- Checked 2026-11-09 (license audit): the npm registry `license` field says MIT (both packages). The npm README of each package says the Community tier "is licensed under the MIT license" with "Copyright © 2009-2026, Bryntum" (registry text). The Bryntum features page (https://bryntum.com/products/scheduler/features/, fetched) labels the Community tier "Free · MIT license". The Bryntum license page (https://bryntum.com/products/scheduler/license/, fetched) lists only the End-User and OEM licenses and does not mention Community, MIT or open source. The discrepancy is unresolved: the license page does not state the Community grant. Details: `THIRD_PARTY_NOTICES.md`.
- Still NOT VERIFIED: the copyright and license text inside the installed package (`node_modules/**` is not read). Owner must confirm before public release. Details: `THIRD_PARTY_NOTICES.md` (repo root).
- Only Community features are used (see `docs/BRYNTUM_NOTES.md`). No Bryntum Pro or licensed asset is referenced.
- Bryntum is listed in `THIRD_PARTY_NOTICES.md` (repo root). `docs/THIRD_PARTY.md` is generated from the lockfile and was not regenerated here.
- No Bryntum source, CSS or icon file is copied into the repository. The stylesheets are imported from the installed packages.

## Other new dependencies

- None. The recovery benchmark uses only existing project code and `tsx`, which was already a dev dependency.

## Proprietary and third-party assets

- No new images, fonts or datasets were added in this change. The synthetic data is generated from seeds in code.
- `docs/screenshots/` predates this branch and was not regenerated.

## Secret scan

| Check | Command | Result |
|---|---|---|
| Release scan of the built client bundle and env template | `NEXT_DIST_DIR=.next-release npm run release:scan` | PASS: 37 static files under `.next-release/static` with no secret shapes, sensitive names or configured values; `.env.example` placeholders only (5 keys). Caveat: the `.next-release` build was not rebuilt in this session, so the scan covers that earlier build. The output text says `.next/static`, but the script reads `NEXT_DIST_DIR`. |
| Pattern grep over tracked files (Google API key, Anthropic and OpenAI key shapes, private key blocks) | `git grep` over tracked files | Only matches are fake keys in `tests/unit/releaseScan.test.ts`, which exist to test the scanner. No real secret found. |
| Runtime secrets in repo | manual review of this change | No `.env` file was created or committed. No credential appears in the new docs. |

## Not run

- `npm run build` was not run, so `.next-release` is not regenerated.
- No live PayPal, Gemini, Neon or ngrok call was made.
- Commits and pushes are not made by this change; the owner decides.

## Sign-off

- Bryntum license line: resolved 2026-11-10 (MIT, commercial use permitted; see `THIRD_PARTY_NOTICES.md` "Conclusion"). Keep the copyright and MIT notice with any redistribution.
- No secrets in the repository: supported by the scans above, not by a full history scan (`git log -p` was not searched).

## Bryntum licence verification (2026-11-09, registry metadata only)
- `npm view @bryntum/scheduler-community@8.0.0 license` and `npm view @bryntum/scheduler-react-community@8.0.0 license` both return `MIT`.
- `package-lock.json` pins both at 8.0.0 with `"license": "MIT"` and an `integrity` hash equal to the registry's `dist.integrity` for `scheduler-community` (`sha512-NcvzQqTy...rREw==`).
- Not verified: the LICENSE file shipped inside the installed package (reading `node_modules` is denied in this environment and was not circumvented), and Bryntum's own licence page, which lists only End-User and OEM terms. No Bryntum purchase, trial key or commercial licence is used. `THIRD_PARTY_NOTICES.md` carries the MIT notice; the owner should open the package LICENSE once before submission.
