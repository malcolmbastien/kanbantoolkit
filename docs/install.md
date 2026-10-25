# Install

Flowline is one Node process, one SQLite file and a directory of static files. This page takes a
machine with nothing on it to a running instance; [configure.md](configure.md) is what to set once it
runs, and [tls.md](tls.md) is what to put in front of it.

## What you need

- **Node 26** — the same major version CI runs. Newer should work; older is not tested.
- **A directory you own**, and enough disk for the database and its backups.
- **A reverse proxy** for TLS. Flowline does not terminate TLS itself: a proxy is how every instance
  gets https, and [tls.md](tls.md) has working configurations.
- **`git`** to clone, or a tarball from a release.

There is no container image or package yet, so the commands below are the whole story.

## Three commands

```bash
git clone https://github.com/flowline/flowline flowline
cd flowline && npm ci && npm run build
PORT=8787 DB_PATH=./flowline.db STATIC_DIR=./dist npm run server
```

The build writes the site and the app into `dist/`. The server applies every pending migration on
start and prints the schema version it is on:

```
flowline schema v21
```

Then open <http://localhost:8787/app>. There is no account to create first and no key to paste: on a
fresh deployment the first person to sign in administers the instance and its one workspace, and the
workspace takes the name the installation gave it. Everybody after that arrives by invitation.

> **Set `WORKSPACE_NAME` before the first sign-in.** It is what the workspace is called, and it is
> what a person types to confirm deleting the workspace later. It can be changed in the app
> afterwards — Admin → This workspace — but the first name is the install's.

## What the first run writes

- `./flowline.db` — the SQLite database, in WAL mode. This file **is** the instance: accounts,
  boards, cards, history and the audit trail. Back it up; see [backup.md](backup.md).
- `./flowline.db-wal` and `./flowline.db-shm` — SQLite's write-ahead log, beside it. They are part of
  the database; a backup taken with `npm run backup` includes them correctly, and a plain `cp` of the
  `.db` alone can miss the newest writes.

`dist/` is build output: it can be deleted and rebuilt from the repository at any time.

**One file serves one instance.** The database is SQLite, and its locking is not a network protocol:
two processes writing the same file corrupt it. Scaling out means Postgres behind the same interface
(`server/db.ts`), not a second instance on the same volume. This is a design decision — one
deployment per team — not a limitation to work around.

## Or in a container

```bash
docker compose up -d
```

One command, one container, one volume, and the same image built from this checkout.
[docker.md](docker.md) is that road in full: the volume, the backups taken inside the container, the
non-root user, and what SQLite means when you are tempted to run a second one.

## Checking it is up

```bash
curl -s localhost:8787/api/health
# {"ok":true,"database":"ok"}
```

A `503` with `"database":"unreachable"` means the process is running but cannot read the file —
almost always `DB_PATH` pointing at a directory it cannot write, or at a file from a different user.

## Keeping it running

Whatever keeps a process alive on your machine. With systemd, the whole unit is:

```ini
[Unit]
Description=Flowline
After=network.target

[Service]
Type=simple
User=flowline
WorkingDirectory=/srv/flowline
Environment=PORT=8787
Environment=DB_PATH=/srv/flowline/flowline.db
Environment=STATIC_DIR=/srv/flowline/dist
Environment=WORKSPACE_NAME=Team Atlas
Environment=PUBLIC_URL=https://flowline.example
ExecStart=/usr/bin/npm run server
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now flowline
```

The server handles `SIGTERM` by finishing the request it is on; `Restart=on-failure` covers a crash,
and a migration that fails stops the process rather than serving a database it does not understand.

## Updating an installed copy

`git pull && npm ci && npm run build`, then restart the service. The migrations run on boot. Read
[upgrade.md](upgrade.md) first if the release notes a schema change, and take a backup — the
recovery is a restore, not a rollback.

## Next

- **[Configure](configure.md)** — the sign-in providers, the salt, the public address.
- **[TLS and the proxy](tls.md)** — https, headers, and the socket.
- **[Backup and restore](backup.md)** — the copy and the drill.

---

**Last verified:** 0.1.0, on a clean machine, following only this page: clone, build, run, open
`/app`, sign in, `curl /api/health` — and again as a container, `docker compose up -d`, with the same
result.
