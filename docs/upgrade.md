# Upgrade

An upgrade is: get the new code, build it, restart. The migrations run on boot, inside a transaction,
and the server refuses to serve a database it cannot understand. Nothing is upgraded for you, and
nothing is deleted for you.

## The rule

**Back up first.** A release that changes the schema says so in the changelog, and the way back is a
restore — not a rollback. Migrations here are one-way: they move the data forward, and the old code
would not read the new shape.

```bash
npm run backup -- backup ./kanbantoolkit.db ./backups
```

[backup.md](backup.md) is the whole procedure, including the drill that proves the copy is good.

## The steps

```bash
cd /srv/kanbantoolkit
npm run backup -- backup ./kanbantoolkit.db ./backups   # 1. a copy, while the server runs
git pull --ff-only                                 # 2. the new code
npm ci && npm run build                            # 3. install, typecheck, bundle, site
sudo systemctl restart kanbantoolkit                    # 4. boot: migrations, then serve
journalctl -u kanbantoolkit -n 20 --no-pager            # 5. what happened
```

Step 5 prints one line at start — the migration the database reached:

```
kanbantoolkit schema vN
```

If it prints nothing and exits, the migration refused — see *When a migration stops* below. If it
prints `(applied 20, 21, …)` after the version, this boot moved the schema and you should read the
release's notes for what changed.

## Which releases need a backup

Every release, but two kinds especially:

- **The changelog entry names a migration.** The server applies it at boot. Back up before the
  restart, because a restore is the only way back.
- **The changelog entry says `REQUIRED_SCHEMA` moved.** Same thing said another way, but it also
  means an old binary will refuse the new database — rolling the code back without restoring will
  leave you with a server that will not start.

**An example from the history: schema 33, the vocabulary revision.** A database from before it gains
`workspace.vocabulary_rev` — the revision that the workspace's card types, templates, objectives and
key results are written against, so a stale save is refused instead of overwriting somebody else's.
`REQUIRED_SCHEMA` moved to 33 with the column, so an old binary refuses the new database. Nothing is
rewritten in the rows already there: the lists are as they were, and the revision starts at zero.

A release that changes only the client or the site can be rolled back by checking out the previous
tag and rebuilding.

## A release that needs a value before it will start

One upgrade was not a schema change: the salt became required (task 201). An instance used to start
with a published default — `change-me` from `compose.yaml`, `kanbantoolkit` from the code — and an
address hash keyed with either is a hash whose key is in this repository. A Node instance with
`NODE_ENV=production` now **refuses to start** until `ERROR_SALT` holds a real secret, and says so:

```
kanbantoolkit cannot start: ERROR_SALT is not set. Set it to a secret (docs/configure.md)
```

The step is one line in the file the process already reads — `.env` on a Compose install,
`Environment=ERROR_SALT=…` in a systemd unit — with the value from `openssl rand -hex 32`. Nothing in
the database is rewritten, but the addresses it hashed under the old value no longer match, so the
sign-in attempt count and the per-hour error-report limit start fresh once. That is the whole cost,
and it is why the value is worth setting before an instance collects anything.

A run without `NODE_ENV=production` is a development run and still starts: it generates a salt for the
process, which is convenient on a laptop and not something a served instance should rely on.

## When a migration stops

The schema is applied in one transaction per file, and a failure leaves the version where it was, so
the next attempt starts the same file again. The process exits rather than serving a half-migrated
database. That is deliberate: a wrong answer is worse than none.

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
counts after copying — so it says *what* it restored, not just that a file moved.

## Downtime

The restart is the only downtime. The process stops taking requests, the migrations run, and it starts
serving again. How long that takes depends on the size of the database and the migrations in the
release, so time the first upgrade on a real instance and note the number for next time.

If the workspace is read while the schema is behind (for example, a second server still running the old
code against a newer file), the API answers `503` with "this instance has not finished migrating" rather
than serving data it may misread.

---

**Last verified:** 0.1.0 — an upgrade from the previous migration set on a seeded database, with a
backup taken first and one restore performed from it.
