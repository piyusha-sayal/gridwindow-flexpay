# License and secrets checklist (recovery engine, 2026-11-09)

## Bryntum packages

| Package | Version (from `package.json`) | License | Status |
|---|---|---|---|
| `@bryntum/scheduler-community` | 8.0.0 (`npm ls`; lock file entry present) | `npm view ... license` = `MIT` (registry metadata, 2026-11-09). The in-package LICENSE file was NOT read (`node_modules` read denied). | PARTIAL: owner review required. |
| `@bryntum/scheduler-react-community` | 8.0.0 (`npm ls`; lock file entry present) | `npm view ... license` = `MIT` (registry metadata). In-package license file NOT read (same reason). | PARTIAL: owner review required. |

- Conflict (2026-11-09): the registry says MIT, but the Bryntum license page (`https://bryntum.com/products/scheduler/license/`) lists only the End-User License and the OEM License and names no Community MIT grant. Owner must resolve this before release; until then the status stays PARTIAL.
- Only Community features are used (see `docs/BRYNTUM_NOTES.md`). No Bryntum Pro or licensed asset is referenced.
- Bryntum is not listed in `docs/THIRD_PARTY.md`, which was generated from the lockfile on 2026-11-07. Add it when the license is confirmed.
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

- Owner review required for the Bryntum license line before any public release.
- No secrets in the repository: supported by the scans above, not by a full history scan (`git log -p` was not searched).
