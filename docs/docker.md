# In a container

One instance, one container, one volume. The image builds from this repository: you need Docker and a
clone. A published image also exists, described below.

```bash
git clone https://github.com/malcolmbastien/kanbantoolkit kanbantoolkit
cd kanbantoolkit
docker compose up -d
```

Then open <http://localhost:8787/app>. The first start creates the database on the volume, the
migrations run on boot, and the first person to sign in administers the instance and its one
workspace.

The container runs an **instance of the application**: `/` redirects to `/app`, and the project's
website is not inside it. `/install/`, `/privacy/` and the rest answer the instance's own 404; they
belong to this project's site, at this project's address.

`compose.yaml` holds a service, a port bound to loopback, a named volume, and the environment. The
container is named **`kanbantoolkit`**, so `docker exec kanbantoolkit …` and Docker Desktop show the
same name; Compose's generated name would otherwise be `<project>-kanbantoolkit-1`. The project and its
volume keep the name Compose gives them, so updating the file does not move your data. The fixed name
means one container and one volume per host, and [the notes
below](#the-volume-is-the-instance) explain why a second container does not scale this app.

## The published image

CI builds and tests the image on every push — health, the unprivileged user, the database it creates,
the first sign-in — and on `main` publishes it for `amd64` and `arm64`:

```bash
docker run -d --name kanbantoolkit -p 127.0.0.1:8787:8787 -v kanbantoolkit-data:/data \
  ghcr.io/malcolmbastien/kanbantoolkit:latest
```

Or, in a compose file, replace `build: .` with `image: ghcr.io/malcolmbastien/kanbantoolkit:<version>`.

Three tags:

| Tag | What it is |
| --- | --- |
| `<commit>` | that exact commit, and nothing else — what a deployment should pin |
| `<version>` | the release, from `package.json` |
| `latest` | the last green `main` — not a release, and the tag to use only for a trial |

> **The package carries its own visibility, not the repository's.** A package created while the
> repository was private stays private until somebody changes it: **Packages → kanbantoolkit → Package
> settings → Change visibility**. If a `docker pull` asks for credentials, that is the switch.

The container reports which build it is: `curl -s localhost:8787/api/health` answers
`{"ok":true,"database":"ok","version":"0.1.0"}`.

## The volume is the instance

| | |
| --- | --- |
| `docker compose down` | stops and removes the container; **the work stays** on `kanbantoolkit-data` |
| `docker compose down -v` | removes the volume too — the workspace, its accounts and its history |
| `docker compose up -d --build` | rebuilds from the checkout and starts again, on the same volume |

The database is `/data/kanbantoolkit.db` inside the container; the volume makes it outlive the image.
Back it up with the same command a bare-metal instance uses:

```bash
docker exec kanbantoolkit npm run backup -- backup /data/kanbantoolkit.db /data/backups
```

`docker exec kanbantoolkit npm run backup -- restore <file> /data/kanbantoolkit.db --force` is the other half,
and [backup.md](backup.md) is the drill that proves both. Copying the volume also works, but only with the
container stopped: a running database is being written to.

## What the image does and does not do

- **Runs as an unprivileged user** (`kanbantoolkit`, uid 10001) with only its own data directory writable.
- **Ships no credentials and no debug port.** The only port is 8787, and the only way in is a
  provider you configured or an invitation.
- **Reports whether it can serve.** `GET /api/health` is the container's own healthcheck. The
  `start_period` is long enough for a first-run migration.
- **Builds the application from source** in the first stage. The second stage carries only the bundled
  server, the built client, the migrations and `package.json`. The project's website is not in the image.

Configuration is the environment, exactly as on a bare machine. `compose.yaml` lists the values worth
setting and reads them from `.env`; [configure.md](configure.md) is every variable, its default, and
what an unset one does.

```bash
# `<<EOF` is deliberately unquoted: $(openssl …) runs while the file is written.
cat > .env <<EOF
WORKSPACE_NAME=Team Atlas
PUBLIC_URL=https://kanbantoolkit.example
ERROR_SALT=$(openssl rand -hex 32)
EOF
docker compose up -d
```

`.env` is gitignored: it holds the salt and, if you use them, the provider secrets.

`ERROR_SALT` has no default in `compose.yaml` and the image **will not start without it**: a salt
published in a file anyone can read is not a secret. Without it `docker compose logs kanbantoolkit`
prints the line that names the variable, then the container exits. Generate it once and keep it: the
value is what lets today's rate-limit counts match yesterday's. Changing it corrupts nothing; the
addresses already hashed stop matching.

**Set `PUBLIC_URL` to the https address** when a proxy is in front — see [tls.md](tls.md). Without
it, the session cookie is issued for whatever the request's origin was, which behind a proxy is http.

## Upgrading

```bash
docker exec kanbantoolkit npm run backup -- backup /data/kanbantoolkit.db /data/backups   # 1. a copy
git pull --ff-only                                                              # 2. the new code
docker compose up -d --build                                                    # 3. rebuild, restart
docker compose logs --tail 20 kanbantoolkit                                          # 4. the schema it reached, or why not
```

A release that adds a migration applies it on boot, inside the transaction, and stops the container
if it cannot. [upgrade.md](upgrade.md) is the long version, including how to go back, which is a
restore rather than a rollback.

## What SQLite means, plainly

The database is a file, with two consequences:

- **One file serves one instance.** Do not run two containers against the same file on a shared
  volume. SQLite's file locking does not work reliably across a network filesystem, so the volume must be on local disk.
- **Scaling out means Postgres**, not a second container. There is no multi-instance mode: this
  application is built for one deployment per team, and [architecture.md](architecture.md) says why.

If you outgrow it, the answer is a different database behind the same interface (`server/db.ts`), a
port rather than a rewrite.

## Checking it

```bash
docker compose ps                       # healthy
curl -s localhost:8787/api/health       # {"ok":true,"database":"ok"}
docker exec kanbantoolkit id                 # uid=10001(kanbantoolkit) — not root
docker compose logs --tail 5 kanbantoolkit   # kanbantoolkit schema vN — the migration it reached
```

---

**Last verified:** 0.1.0 — `docker build`, `docker compose up -d`, the health check, a first sign-in
that created the workspace under `WORKSPACE_NAME`, a backup taken inside the container, and the
container replaced with the work still there.
