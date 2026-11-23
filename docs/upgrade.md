# Upgrade

The migrations run on boot, inside a transaction, and the server refuses to serve a database it cannot
understand.

## The rule

**Back up first.** A release that changes the schema applies a migration at boot; the migrations in
the release are the record of what changed. The way back is a restore, not a rollback — migrations
are one-way, and the old code cannot read the new shape.

```bash
npm run backup -- backup ./kanbantoolkit.db ./backups
```

See [backup.md](backup.md) for the procedure and the drill that proves the copy is good.

## The steps

```bash
cd /srv/kanbantoolkit
npm run backup -- backup ./kanbantoolkit.db ./backups   # 1. a copy, while the server runs
git pull --ff-only                                 # 2. the new code
npm ci && npm run build                            # 3. install, typecheck, bundle, site
sudo systemctl restart kanbantoolkit                    # 4. boot: migrations, then serve
journalctl -u kanbantoolkit -n 20 --no-pager            # 5. what happened
```

Step 5 prints the migration the database reached:

```
kanbantoolkit schema vN
```

If it prints nothing and exits, the migration refused — see *When a migration stops*. If it prints
`(applied …)` after the version, this boot moved the schema; the migration numbers it names are the
change.

## Which releases need a backup

Every release; two kinds especially:

- **The release adds a migration.** The server applies it at boot. Back up before the restart: a
  restore is the only way back.
- **The release moves `REQUIRED_SCHEMA`.** An old binary refuses the new database, so rolling the code
  back without restoring leaves a server that will not start.

**An example: schema 33, the vocabulary revision.** A database from before it gains
`workspace.vocabulary_rev`, the revision the workspace's card types, templates, objectives and key
results are written against, so a stale save is refused instead of overwriting somebody else's.
`REQUIRED_SCHEMA` moved to 33 with the column, so an old binary refuses the new database. No row is
rewritten: the lists are as they were, and the revision starts at zero.

A client- or site-only release can be rolled back by checking out the previous tag and rebuilding.

## A release that needs a value before it will start

One upgrade was not a schema change: the salt became required (task 201). An instance used to start
with a published default — `change-me` from `compose.yaml`, `kanbantoolkit` from the code — and a hash
keyed with either has its key in this repository. A Node instance with `NODE_ENV=production` now
**refuses to start** until `ERROR_SALT` holds a real secret, and says so:

```
kanbantoolkit cannot start: ERROR_SALT is not set. Set it to a secret (docs/configure.md)
```

The step is one line in the file the process reads — `.env` on a Compose install,
`Environment=ERROR_SALT=…` in a systemd unit — with the value from `openssl rand -hex 32`. Nothing in
the database is rewritten, but the addresses hashed under the old value no longer match, so the
sign-in attempt count and the per-hour error-report limit start fresh once. Set the value before an
instance collects anything and that cost never arises.

A run without `NODE_ENV=production` is a development run and still starts, with a salt generated for
the process. A served instance should not rely on that.

## When a migration stops

The schema is applied in one transaction per file; a failure leaves the version where it was, so the
next attempt starts the same file again. The process exits rather than serving a half-migrated database.

1. Read the error in the journal — it names the file, e.g. `0021_no_bill.sql`.
2. **Do not edit a migration that has already run on another instance.** The file is the schema's
   history; changing it makes two databases claim the same version with different shapes.
3. If it is data the new shape cannot accept, the answer is a fix in a new migration, or a restore.
4. Restore, and open an issue with the database's `PRAGMA user_version`, the version it failed on,
   and the error.

## Rolling back

```bash
sudo systemctl stop kanbantoolkit
npm run backup -- restore ./backups/kanbantoolkit-<the one from before>.db ./kanbantoolkit.db --force
git checkout v<the previous tag>
npm ci && npm run build
sudo systemctl start kanbantoolkit
```

The restore refuses to overwrite without `--force`, and checks `PRAGMA integrity_check` and the row
counts after copying, so it says *what* it restored.

## Downtime

The restart is the only downtime: the process stops taking requests, the migrations run, and it serves
again. Time depends on the database size and the release's migrations; time the first upgrade on a real
instance and note the number.

If the workspace is read while the schema is behind (a second server on old code against a newer file),
the API answers `503` with "this instance has not finished migrating" rather than serving data it may
misread.

---

**Last verified:** 0.1.0 — an upgrade from the previous migration set on a seeded database, with a
backup taken first and one restore performed from it.
