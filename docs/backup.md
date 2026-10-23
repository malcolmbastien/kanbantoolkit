# Backup and restore

> What to copy, where to keep it, and how to prove it works before the day it matters. Two deployments,
> two roads — and the same drill at the end.

**Owner:** the repository maintainer. Update this line when that changes; a runbook without a name
is a document nobody owns.
**Last drill:** 2026-10-23 — automated, by `server/backup.test.ts`, and it runs on every push.

## What has to be copied

One database. Everything a server holds is in it: accounts, sessions, boards, lanes, items, the
history a card carries, the change feed and the leases. There are no uploads and no object storage,
so a backup of the database is a backup of the workspace.

The browser's own `localStorage` is a cache, not a backup. `docs/server-runtime.md` says why.

## Self-hosted: the copy

```bash
npm run backup -- backup ./flowline.db ./backups
# backed up ./flowline.db → ./backups/flowline-2026-10-23T02-00-00-000.db (412 KB, keeping 30 days)
```

The copy is taken with `VACUUM INTO`, which is a single read transaction: it is consistent while the
server keeps running, and it is compact. A plain file copy can catch a write half-written, which is
the one thing a backup must not do.

Daily, from cron:

```cron
0 2 * * *  cd /srv/flowline && npm run backup -- backup ./flowline.db ./backups >> ./backups/backup.log 2>&1
```

**Retention** is 30 days by default (`--keep-days=30`), pruned by the file's own timestamp.

**A second copy, with another provider, is the part that is not optional.** A backup on the machine
that fails is not a backup. Any of these, nightly, after the copy:

```bash
rclone sync ./backups remote:flowline-backups
# or: restic backup ./backups
# or: scp -r ./backups host:/elsewhere/flowline
```

## Self-hosted: putting it back

```bash
npm run backup -- restore ./backups/flowline-2026-10-23T02-00-00-000.db ./flowline.db --force
# restored … (3 boards, 128 items)
```

It refuses to overwrite without `--force`, because a restore is run on a day something has already
gone wrong and the second mistake of that day must not be the restore. After copying it checks
`PRAGMA integrity_check` and the row counts, so the command says *what* it restored, not just that a
file moved.

Then restart the server. The migrations run on boot (`server/migrate.ts`).

## Hosted: Cloudflare D1

D1 keeps its own history, and it is the provider's to keep:

- **Time Travel** — automatic, 30 days, restore to any minute:
  `npx wrangler d1 time-travel restore flowline --timestamp=2026-10-22T02:00:00Z`
- **An export**, for a copy outside Cloudflare:
  `npx wrangler d1 export flowline --remote --output=flowline-2026-10-23.sql`

The export is the second copy: keep it somewhere that is not the same account. It is a `.sql` file
and restoring it is `wrangler d1 execute flowline --remote --file=…`.

Neither of these is a daily task anyone performs — the schedule is the provider's, and R1 asks that
it is visible and non-zero. Check it once a quarter, and check that the export job still runs.

## The drill

Do this at least once a quarter, and after any change to the schema or the deployment:

1. **Take an export from the app.** Settings → export the workspace, as the person who owns it
   (R5). This is the known-good answer, in the app's own vocabulary.
2. **Restore yesterday's backup into a scratch environment** — a second database file, or a second
   branch of D1. Never over the live one.
3. **Compare.** The restored workspace's export should equal the one from step 1, apart from what
   changed in between. Counts are the quick check: boards, items, placements, edges, and the log
   entries are in the restored copy.
4. **Write the date here.** The line at the top of this file is the record.

The automated part of the drill — seed a workspace, back it up, restore it into a scratch file, and
compare the whole workspace object — runs in `server/backup.test.ts` on every push. It cannot reach
the provider's backups, which is why the manual steps above exist rather than instead.

## What this does not cover

- **The browser's snapshots.** They are a ring in `IndexedDB`, for a bad edit in a tab — not a
  backup, and never a substitute for one.
- **Configuration.** The provider's client secrets and the database path live in the environment;
  they are documented in `README.md` and should be kept wherever the operator keeps secrets.
