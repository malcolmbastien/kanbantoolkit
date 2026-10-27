# Install

Flowline is one Node process, one SQLite file and a directory of static files. This page takes a
machine with nothing on it to a running instance; [configure.md](configure.md) is what to set once it
runs, and [tls.md](tls.md) is what to put in front of it.

You do not edit any configuration to start. The one command uses its defaults, creates the database
itself, and asks you for nothing until it is running.

## One command, with Docker

```bash
git clone https://github.com/malcolmbastien/flowline flowline
cd flowline && docker compose up -d
```

That builds the image from this checkout, creates the database on a named volume, applies the
migrations and answers on <http://localhost:8787/app>. The port is bound to `127.0.0.1`: a reverse
proxy is the way in, and [tls.md](tls.md) is that part.

**An instance serves the application and nothing else.** `/` sends you to `/app`; `/assets`, the icon
and `/api` answer; anything else is the instance's own 404, naming the workspace. This project's
website — `/install/`, `/privacy/`, its sitemap — is a separate deployment and is not part of your
instance. The one thing an instance links back here for is the terms and privacy pages, and only when
`PROJECT_URL` tells it where this site is.

A published image exists too — `ghcr.io/malcolmbastien/flowline`, built by CI on every green `main`
and tagged by commit, by version and `latest`; [docker.md](docker.md) has the command and what the
tags mean. Building from the checkout above always works and needs no registry.

Two values are worth setting before the machine has a public address, and neither is required to try
it:

| | |
| --- | --- |
| `WORKSPACE_NAME` | what the team is called. It is what a person types to confirm deleting the workspace later, so set it before the first sign-in. Defaults to `Flowline`. |
| `PUBLIC_URL` | the address the outside world uses — `https://flowline.example` behind a proxy. It is what a sign-in redirect is built from, and what makes the session cookie `Secure`. |

`docker compose down` stops it and keeps the work; `down -v` removes the volume with it.
[docker.md](docker.md) is this road in full: the volume, backups taken inside the container, the
unprivileged user, and what SQLite means when you are tempted to run a second one.

## Or by hand, without Docker

Node 26, a directory you own, and a reverse proxy for TLS:

```bash
git clone https://github.com/malcolmbastien/flowline flowline
cd flowline && npm ci && npm run build
PORT=8787 DB_PATH=./flowline.db STATIC_DIR=./dist npm run server
```

The build writes the site and the app into `dist/`. The server applies every pending migration on
start and prints the schema version it reached:

```
flowline schema vN
```

## What the first run does

- **Opens the way in.** A deployment with no accounts answers its first visit with a **first run**
  surface — name, address, password — in the account menu. The account it makes administers the
  instance and its one workspace; there are no default credentials to fall back on.
- **Names the workspace**, from `WORKSPACE_NAME` (default `Flowline`).
- **Creates the database.** By hand that is `./flowline.db` beside the process; in the container it is
  `/data/flowline.db` on the volume.

Everybody after the first person arrives by invitation, as the role the invitation names. There is no
sign-up page: an instance *is* a workspace.

## What it writes, and what that means

- **`flowline.db`** — the SQLite database, in WAL mode. This file **is** the instance: accounts,
  boards, cards, history and the audit trail. Back it up; see [backup.md](backup.md).
- **`flowline.db-wal`** and **`flowline.db-shm`** — SQLite's write-ahead log, beside it. They are part
  of the database: `npm run backup` copies them correctly, and a plain `cp` of the `.db` alone can
  miss the newest writes.
- **`dist/`** — build output. It can be deleted and rebuilt from the repository at any time.

**One file serves one instance.** SQLite's locking is not a network protocol: two processes writing the
same file corrupt it. Scaling out means Postgres behind the same interface (`server/db.ts`), not a
second instance on the same volume. That is a design decision — one deployment per team — not a
limitation to work around.

## Checking it is up

```bash
curl -s localhost:8787/api/health
# {"ok":true,"database":"ok"}
```

A `503` with `"database":"unreachable"` means the process is running but cannot read the file — almost
always `DB_PATH` pointing at a directory it cannot write, or at a file owned by a different user.

## Keeping it running

With Docker that is the compose file's own `restart: unless-stopped`. By hand, whatever keeps a process
alive on your machine; with systemd the whole unit is:

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

## Updating

```bash
git pull --ff-only
docker compose up -d --build      # or: npm ci && npm run build, then restart the service
```

The migrations run on boot. Read [upgrade.md](upgrade.md) before a release that changes the schema, and
take a backup — the way back is a restore, not a rollback.

## Next

- **[In a container](docker.md)** — the volume, the backups, the limits.
- **[Configure](configure.md)** — the identity provider, the salt, the public address, mail.
- **[TLS and the proxy](tls.md)** — https, headers, and the socket.
- **[Backup and restore](backup.md)** — the copy and the drill.

---

**Last verified:** 0.1.0 — `docker compose up -d` on a clean checkout with no configuration at all,
then the same instance by hand with the three commands: first run, password sign-in, `curl
/api/health`, and a backup taken from inside the container.
