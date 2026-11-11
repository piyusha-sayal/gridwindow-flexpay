# Database migrations

Scope: how the schema in `src/server/db/migrations.ts` reaches a database. The procedure for the production database (Neon) is at the end.

## Behaviour by database

| Database | When migrations run |
|---|---|
| PGlite (`.data/pglite`, default local dev, unit and integration tests) | Automatically on open. Unchanged. |
| External PostgreSQL (`DATABASE_URL`, including Neon) | Never at startup. The app reads the ledger and refuses to open a database whose schema does not match this build. |
| Disposable PostgreSQL in tests (`TEST_DATABASE_URL`, guarded by `assertDisposableTestUrl`) | Automatically, because the test helpers pass `autoMigrate: true`. |

Refusal means `openPostgres` throws `SchemaNotReadyError`. The message names the pending, unknown or drifted ids and points to `--status`. It contains no connection details. The runtime then returns errors instead of serving traffic against the wrong schema, and it retries the check on the next request, so a fixed database starts working without a restart.

`GW_AUTO_MIGRATE=true` makes the app apply pending migrations at startup. It exists for disposable and local databases. Do not set it for Neon or any other persistent database. The flag does not ask for the confirmation token below, so `db:migrate` is the only supported route for persistent databases.

## Commands

```
npm run db:migrate -- --status
npm run db:migrate -- --plan
npm run db:migrate -- --apply --confirm-database <fingerprint>
```

- Target: `MIGRATION_DATABASE_URL` (direct, non-pooled URL; DDL should not go through a transaction pooler), or `DATABASE_URL` when that is unset. `.env.local` is loaded if present; variables already set in the shell win.
- `target fingerprint` is the first 12 hex characters of SHA-256 of the target host, port and database name (credentials and query options excluded). Every mode prints it. The URL, user, password and host name are never printed.
- `--status` is read-only. It prints the ledger state, applied, pending, unknown ids, checksum drift and unverified legacy rows, and exits 0 only when the schema matches this build.
- `--plan` is read-only. It prints, for each pending migration, the tables, indexes, functions, triggers and columns it creates or adds, in order.
- `--apply` refuses (exit 2, before connecting) unless `--confirm-database` equals the target fingerprint. The fingerprint is the guard against migrating the wrong database by accident. Read it with `--status` against the same target.
- Exit codes: `--status` 0 ready, 1 not ready. `--plan` 0. `--apply` 0 success or nothing pending, 1 failure, 2 refused or usage error.

## How apply works

- Each pending migration runs in its own transaction under the advisory lock `gridwindow:migrations`. The lock is the same key the earlier runner used, so old and new processes still serialize.
- Inside the lock the runner re-reads the ledger, so a concurrent runner finds nothing left to do.
- A failing migration is rolled back in full, including its DDL, and is not recorded. Migrations before it stay applied and recorded. Running `--apply` again continues from the first unrecorded id once the cause is fixed.
- The ledger is `schema_migrations (id, applied_at, checksum)`. The checksum is SHA-256 of the migration's SQL.
- Before applying, the runner refuses a database that has ledger ids this build does not know, or an applied id whose checksum differs from this build's SQL.
- A ledger written before checksums existed has rows with no checksum. `--status` lists them as unverified. `--apply` records their checksum from this build's SQL, which assumes the build that applied them ran this same SQL. Check that before applying to an old database.

## Rules for migration files

- Append-only. Never edit an applied entry: its checksum is recorded and a changed entry is refused. Add a new entry at the end with the next id (`00N_snake_case`).
- Additive only: `create table`, `create index`, `create function`, `create trigger`, `alter table ... add column`. No `drop`, `rename`, `alter column`, type change, `update`, `delete`, `insert` or `truncate` in the list after 001. `tests/unit/migrator.test.ts` enforces this for the existing list.
- Keep the append-only triggers (`gw_forbid_mutation`) and the terms-immutability trigger (`gw_forbid_terms_change`) in place. The migrator test checks they exist after migrating.
- There is no down migration. Recovery is a restore from a backup, not a reverse script.

## Neon procedure (ordered)

Neon already held migrations 001 to 005 when we checked it read-only on 2026-11-10, so the submitted build needed no migration there. Use this procedure for any future change.

1. Backup. In the Neon console, create a branch from the branch the app uses, or confirm the point-in-time restore window covers the moment before the change. Write down the branch name, but not the URL.
2. Put `MIGRATION_DATABASE_URL` (direct URL, `sslmode=verify-full`) in `.env.local` in your own session. Keep `DATABASE_URL` for the app. Do not echo either value.
3. `npm run db:migrate -- --status`. Note the `target fingerprint`, the applied list and the pending list. Stop if any id is listed as unknown or as a checksum change. Unverified rows are expected on an older ledger.
4. `npm run db:migrate -- --plan`. Review the objects that will be created or added, and confirm the expected migrations are the ones pending.
5. `npm run db:migrate -- --apply --confirm-database <fingerprint from step 3>`. Exit 0 expected.
6. `npm run db:migrate -- --status`. Expect `schema ready for this build: yes` and exit 0.
7. App smoke check, without any payment step: `npm run build`, then `npm start`. Load the home page and the operator console. Confirm the server log has no `SchemaNotReadyError`. Use `npm run db:migrate -- --status` again if the app refuses to start.
8. Record the outcome, the branch name and the exit codes with the release notes.

### Optional rehearsal on an isolated Neon branch (before step 2)

Status: prepared 2026-11-10, not run. Needs the same owner approval as the procedure above.

1. In the Neon console, create a second branch (for example `rehearsal-003-005`) from the app's branch. It copies schema and data; nothing written to it reaches the app branch.
2. Set `MIGRATION_DATABASE_URL` to that branch's direct URL only. Leave `DATABASE_URL` pointing at the app branch.
3. Run steps 3 to 6 against the rehearsal branch. Its fingerprint differs from the app branch's only if the host differs; always read it from `--status`, never reuse one.
4. Optionally point a local `npm start` at the rehearsal branch (`DATABASE_URL` override in your own shell, `PAYMENT_MODE=mock`) and run step 7.
5. Delete the rehearsal branch in the console, then run the real procedure from step 2.

## Recovery

- `--apply` exits 1. Read the printed error class and code. The failing migration is rolled back and not recorded; the earlier ones are recorded. Do not edit the SQL, the ledger or the schema by hand. Run `--status` to see the state. Fix the cause (for example a lock timeout: retry off-peak; an object that already exists: find out how it got there before anything else). Then run `--status` and `--apply` again with the same fingerprint.
- Verification fails or the app misbehaves after a successful apply. Restore the Neon branch or the point-in-time restore point taken in step 1, and point `DATABASE_URL` at the restored branch. A manual SQL rollback is possible but untested, and it destroys recorded data, so use it only after a data check.
- Never set `GW_AUTO_MIGRATE=true` to work around a refusal. A refusal means the schema and the code disagree; resolve that first.
