# Install

Kanban Toolkit is one Node process, one SQLite file and a directory of static files. This page takes a
machine with nothing on it to a running instance; [configure.md](configure.md) is what to set once it
runs, and [tls.md](tls.md) is what to put in front of it.

You do not edit any configuration to start, with one exception: a salt, which the commands below
generate and which the instance will not run without. Everything else uses its defaults, creates the
database itself, and asks you for nothing until it is running.

## With Docker, after cloning

```bash
git clone https://github.com/malcolmbastien/kanbantoolkit kanbantoolkit
cd kanbantoolkit
printf 'ERROR_SALT=%s\n' "$(openssl rand -hex 32)" > .env
docker compose up -d
```

That builds the image from this checkout, creates the database on a named volume, applies the
migrations and answers on <http://localhost:8787/app>. The port is bound to `127.0.0.1`: a reverse
proxy is the way in, and [tls.md](tls.md) is that part.

The `.env` line is the only value the image will not guess. `ERROR_SALT` is mixed into the hash of an
address before it is stored, so it has to be a secret — and a salt published in a Compose file is not
one. Without it the container exits at start and says why; with it, keep the value, because it is what
lets the rate-limit counts of one hour match the next.

**An instance serves the application and nothing else.** `/` sends you to `/app`; `/assets`, the icon
and `/api` answer; anything else is the instance's own 404, naming the workspace. This project's
website — `/install/`, `/privacy/`, its sitemap — is a separate deployment and is not part of your
instance. The one thing an instance links back here for is the terms and privacy pages, and only when
`PROJECT_URL` tells it where this site is.

A published image exists too — `ghcr.io/malcolmbastien/kanbantoolkit`, built by CI on every green `main`
and tagged by commit, by version and `latest`; [docker.md](docker.md) has the command and what the
tags mean. Building from the checkout above always works and needs no registry.

Two more values are worth setting before the machine has a public address. Neither is required to try
it; the salt above is the one thing that is:

| | |
| --- | --- |
| `WORKSPACE_NAME` | what the team is called. It is what a person types to confirm deleting the workspace later, so set it before the first sign-in. Defaults to `Kanban Toolkit`. |
| `PUBLIC_URL` | the address the outside world uses — `https://kanbantoolkit.example` behind a proxy. It is what a sign-in redirect is built from, and what makes the session cookie `Secure`. |

`docker compose down` stops it and keeps the work; `down -v` removes the volume with it.
[docker.md](docker.md) is this road in full: the volume, backups taken inside the container, the
unprivileged user, and what SQLite means when you are tempted to run a second one.

## Or by hand, without Docker

Node 26, a directory you own, and a reverse proxy for TLS:

```bash
git clone https://github.com/malcolmbastien/kanbantoolkit kanbantoolkit
cd kanbantoolkit && npm ci && npm run build
NODE_ENV=production ERROR_SALT=$(openssl rand -hex 32) \
  PORT=8787 DB_PATH=./kanbantoolkit.db STATIC_DIR=./dist npm run server
```

The build writes the site and the app into `dist/`. The server applies every pending migration on
start and prints the schema version it reached:

```
kanbantoolkit schema vN
```

`NODE_ENV=production` is what makes this a served instance rather than a development run — it is the
switch that makes the salt required. The generated value above is for a first look; a server you keep
takes it from the unit file below, so that a restart does not forget the addresses it hashed.

## What the first run does

- **Opens the way in.** A deployment with no accounts answers its first visit with a **first run**
  surface — name, address, password — as the page itself, before anything else is drawn. The account
  it makes administers the instance and its one workspace; there are no default credentials to fall
  back on.
- **Starts empty.** Signing in lands on a workspace with no boards, nothing seeded behind the
  administrator's back. A board is made from *Workspace Home → New board*, and people are brought in from
  *Admin → This workspace*.
- **Names the workspace**, from `WORKSPACE_NAME` (default `Kanban Toolkit`).
- **Creates the database.** By hand that is `./kanbantoolkit.db` beside the process; in the container it is
  `/data/kanbantoolkit.db` on the volume.

Everybody after the first person arrives by invitation, as the role the invitation names. There is no
sign-up page: an instance *is* a workspace.

## What it writes, and what that means

- **`kanbantoolkit.db`** — the SQLite database. This file **is** the instance: accounts, boards, cards,
  history and the audit trail. Back it up; see [backup.md](backup.md).
- **`kanbantoolkit.db-journal`** — SQLite's rollback journal. It exists only while a change is being
  written and belongs to the database. Stop the server before you copy the file by hand, or use
  `npm run backup`, which takes a consistent copy while the server keeps running.
- **`dist/`** — build output. It can be deleted and rebuilt from the repository at any time.

**One file serves one instance.** Run one server against one database file, on local disk. SQLite's
file locking does not work reliably across a network filesystem, so a shared network volume is the
wrong place for it. Scaling out would mean Postgres behind the same interface (`server/db.ts`), not a
second server on the same file. That is a design decision, one deployment per team, and not a
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
Description=Kanban Toolkit
After=network.target

[Service]
Type=simple
User=kanbantoolkit
WorkingDirectory=/srv/kanbantoolkit
Environment=NODE_ENV=production
Environment=PORT=8787
Environment=DB_PATH=/srv/kanbantoolkit/kanbantoolkit.db
Environment=STATIC_DIR=/srv/kanbantoolkit/dist
Environment=WORKSPACE_NAME=Team Atlas
Environment=PUBLIC_URL=https://kanbantoolkit.example
# ERROR_SALT — a secret, generated once with `openssl rand -hex 32`. It has no default.
ExecStart=/usr/bin/npm run server
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`ERROR_SALT` is the one variable with no default, and `NODE_ENV=production` is what makes the server
say so: without a salt the unit does not come up, and `journalctl -u kanbantoolkit` prints the line
that names it. Add it beside the others as `Environment=ERROR_SALT=…`, with the value from
`openssl rand -hex 32`. A run without `NODE_ENV=production` is a development run — it starts with a
salt generated for the process, which is convenient for a trial and not what a team's instance wants,
because the addresses it hashes stop matching across restarts.

```bash
sudo systemctl enable --now kanbantoolkit
```

The server does not drain requests on `SIGTERM`. A write is one transaction, so a stop lands before it or
after it. `Restart=on-failure` restarts the process after a crash,
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

**Last verified:** 0.1.0 — `docker compose up -d` on a clean checkout with nothing but a `.env`
holding `ERROR_SALT`, then the same instance by hand: first run, password sign-in, `curl
/api/health`, and a backup taken from inside the container.
