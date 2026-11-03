# Install

Kanban Toolkit is one Node process, one SQLite file and a directory of static files. [configure.md](configure.md)
is what to set once it runs, and [tls.md](tls.md) is what to put in front of it.

You edit no configuration to start except a salt: the commands below generate it, and everything else
uses defaults and creates the database itself.

## With Docker, after cloning

```bash
git clone https://github.com/malcolmbastien/kanbantoolkit kanbantoolkit
cd kanbantoolkit
printf 'ERROR_SALT=%s\n' "$(openssl rand -hex 32)" > .env
docker compose up -d
```

That builds the image from this checkout, creates the database on a named volume, applies the
migrations and answers on <http://localhost:8787/app>. The port is bound to `127.0.0.1`: a reverse
proxy is the way in ([tls.md](tls.md)).

`ERROR_SALT` is the only value the image will not guess: it is mixed into the hash of an address
before it is stored, so it must be a secret. Without it the container exits at start and says why.
Keep the value you generate; it is what lets one hour's rate-limit counts match the next.

**An instance serves the application and nothing else.** `/` sends you to `/app`; `/assets`, the icon
and `/api` answer; anything else is the instance's own 404, naming the workspace. This project's
website — `/install/`, `/privacy/`, its sitemap — is a separate deployment. An instance links to it for
the terms and privacy pages only when `PROJECT_URL` says where that site is.

A published image exists too, `ghcr.io/malcolmbastien/kanbantoolkit`, built by CI on every green `main`
and tagged by commit, by version and `latest`; [docker.md](docker.md) has the command and the tags.

Two more values are worth setting before the machine has a public address:

| | |
| --- | --- |
| `WORKSPACE_NAME` | what the team is called. It is what a person types to confirm deleting the workspace later, so set it before the first sign-in. Defaults to `Kanban Toolkit`. |
| `PUBLIC_URL` | the address the outside world uses — `https://kanbantoolkit.example` behind a proxy. It is what a sign-in redirect is built from, and what makes the session cookie `Secure`. |

`docker compose down` stops it and keeps the work; `down -v` removes the volume with it.
[docker.md](docker.md) is this road in full: the volume, backups taken inside the container, the
unprivileged user, and what SQLite means when you want a second one.

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

`NODE_ENV=production` is what makes this a served instance rather than a development run; it is also
what makes the salt required. The generated value above is for a first look: a server you keep takes
the salt from the unit file below, so a restart does not forget the addresses it hashed.

## What the first run does

- **Opens the way in.** A deployment with no accounts answers its first visit with a **first run**
  surface — name, address, password. The account it makes administers the instance and its one
  workspace; there are no default credentials.
- **Starts empty.** Signing in lands on a workspace with no boards. A board is made from *Workspace
  Home → New board*, and people are brought in from *Admin → This workspace*.
- **Names the workspace**, from `WORKSPACE_NAME` (default `Kanban Toolkit`).
- **Creates the database.** By hand that is `./kanbantoolkit.db` beside the process; in the container it is
  `/data/kanbantoolkit.db` on the volume.

Everybody after the first person arrives by invitation, as the role the invitation names. There is no
sign-up page: an instance *is* a workspace.

## What it writes, and what that means

- **`kanbantoolkit.db`** — the SQLite database. This file **is** the instance: accounts, boards, cards,
  history and the audit trail. Back it up; see [backup.md](backup.md).
- **`kanbantoolkit.db-journal`** — SQLite's rollback journal. It exists only while a change is being
  written. Stop the server before you copy the database by hand, or use `npm run backup`, which takes a
  consistent copy while the server keeps running.
- **`dist/`** — build output. It can be deleted and rebuilt from the repository at any time.

**One file serves one instance.** Run one server against one database file, on local disk. SQLite's
file locking does not work reliably across a network filesystem, so a shared network volume is the
wrong place for it. Scaling out means Postgres behind the same interface (`server/db.ts`), not a
second server on the same file. One deployment per team.

## Checking it is up

```bash
curl -s localhost:8787/api/health
# {"ok":true,"database":"ok"}
```

A `503` with `"database":"unreachable"` means the process is running but cannot read the file: almost
always `DB_PATH` pointing at a directory it cannot write, or at a file owned by a different user.

## Keeping it running

With Docker that is the compose file's own `restart: unless-stopped`. By hand, whatever keeps a process
alive on your machine. With systemd the whole unit is:

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

`ERROR_SALT` is the one variable with no default: without it the unit does not come up, and
`journalctl -u kanbantoolkit` prints the line that names it. Add it beside the others as
`Environment=ERROR_SALT=…`, with the value from `openssl rand -hex 32`. A run without `NODE_ENV=production` is a development run: it starts with a salt
generated for the process, so the addresses it hashes stop matching across restarts.

```bash
sudo systemctl enable --now kanbantoolkit
```

The server does not drain requests on `SIGTERM`: a write is one transaction, so a stop lands before it
or after it. `Restart=on-failure` restarts the process after a crash, and a migration that fails stops
the process rather than serving a database it does not understand.

## Updating

```bash
git pull --ff-only
docker compose up -d --build      # or: npm ci && npm run build, then restart the service
```

The migrations run on boot. Read [upgrade.md](upgrade.md) before a release that changes the schema, and
take a backup: the way back is a restore, not a rollback.

## Next

- **[In a container](docker.md)** — the volume, the backups, the limits.
- **[Configure](configure.md)** — the identity provider, the salt, the public address, mail.
- **[TLS and the proxy](tls.md)** — https, headers, and the socket.
- **[Backup and restore](backup.md)** — the copy and the drill.

---

**Last verified:** 0.1.0 — `docker compose up -d` on a clean checkout with nothing but a `.env`
holding `ERROR_SALT`, then the same instance by hand: first run, password sign-in, `curl
/api/health`, and a backup taken from inside the container.
