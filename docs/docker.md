# In a container

One instance, one container, one volume. The image is built from this repository and needs nothing
else: no registry account, no base image with the app baked somewhere you cannot see.

```bash
git clone https://github.com/flowline/flowline flowline
cd flowline
docker compose up -d
```

Then open <http://localhost:8787/app>. The database is created on the volume by the first start, the
migrations run on boot, and the first person to sign in administers the instance and its one
workspace.

The container runs an **instance of the application**: `/` redirects to `/app`, and the project's
website is not inside it. `/install/`, `/privacy/` and the rest answer the instance's own 404 — they
belong to this project's site, at this project's address.

`compose.yaml` is deliberately short: a service, a port bound to loopback, a named volume, and the
environment. Nothing else is needed to run it, and nothing else is hidden.

## The volume is the instance

| | |
| --- | --- |
| `docker compose down` | stops and removes the container; **the work stays** on `flowline-data` |
| `docker compose down -v` | removes the volume too — the workspace, its accounts and its history |
| `docker compose up -d --build` | rebuilds from the checkout and starts again, on the same volume |

The database is `/data/flowline.db` inside the container. It is one SQLite file, and the volume is
what makes it outlive the image. Back it up with the same command a bare-metal instance uses, run
inside the container:

```bash
docker exec flowline npm run backup -- backup /data/flowline.db /data/backups
```

`docker exec flowline npm run backup -- restore <file> /data/flowline.db --force` is the other half,
and [backup.md](backup.md) is the drill that proves both. A copy of the volume taken with the
container stopped is the same thing, provided you stop the container first — a running database is
being written to.

## What the image does and does not do

- **Runs as an unprivileged user** (`flowline`, uid 10001) with only its own data directory writable.
- **Ships no credentials and no debug port.** The only port is 8787, and the only way in is a
  provider you configured or an invitation.
- **Says whether it can serve.** `GET /api/health` is the container's own healthcheck, with a
  `start_period` long enough for a first-run migration.
- **Builds the client and the site from source** in the first stage, and carries only `dist/`, the
  server, the migrations and the domain rules into the second.

Configuration is the environment, exactly as it is on a bare machine. `compose.yaml` lists the
values worth setting and reads the rest from `.env`; [configure.md](configure.md) is every variable,
its default, and what an unset one does.

```bash
cat > .env <<'EOF'
WORKSPACE_NAME=Team Atlas
PUBLIC_URL=https://flowline.example
ERROR_SALT=replace-with-a-secret
EOF
docker compose up -d
```

`.env` is gitignored, which is the point: it holds the salt and, if you use them, the provider
secrets.

**Set `PUBLIC_URL` to the https address** when a proxy is in front — see [tls.md](tls.md). Without
it, the session cookie is issued for whatever the request's origin was, which behind a proxy is
http.

## Upgrading

```bash
docker exec flowline npm run backup -- backup /data/flowline.db /data/backups   # 1. a copy
git pull --ff-only                                                              # 2. the new code
docker compose up -d --build                                                    # 3. rebuild, restart
docker compose logs --tail 20 flowline                                          # 4. schema v21, or why not
```

A release that adds a migration applies it on boot, inside the transaction, and stops the container
if it cannot. [upgrade.md](upgrade.md) is the long version, including how to go back — which is a
restore, not a rollback.

## What SQLite means, plainly

The database is a file. That is the whole design, and it has two consequences an operator should hear
before choosing it:

- **One file serves one instance.** Do not run two containers against the same file on a shared
  volume. SQLite's locking is not a network protocol; the failure is corruption, not slowness.
- **Scaling out means Postgres**, not a second container. There is no multi-instance mode today: this
  application is built for one deployment per team, and [architecture.md](architecture.md) says why
  that is a design decision rather than a gap.

A single instance serves a team comfortably — the queries are small and the work is one board's
worth. If you outgrow it, the answer is a different database behind the same interface
(`server/db.ts`), which is a port, not a rewrite.

## Checking it

```bash
docker compose ps                       # healthy
curl -s localhost:8787/api/health       # {"ok":true,"database":"ok"}
docker exec flowline id                 # uid=10001(flowline) — not root
docker compose logs --tail 5 flowline   # flowline schema v21
```

---

**Last verified:** 0.1.0 — `docker build`, `docker compose up -d`, the health check, a first sign-in
that created the workspace under `WORKSPACE_NAME`, a backup taken inside the container, and the
container replaced with the work still there.
