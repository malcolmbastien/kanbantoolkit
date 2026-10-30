# Kanban Toolkit documentation

Kanban Toolkit is a board for a team's flow and for the read management makes of it, on a machine you own:
one Node process, one SQLite file, and no service in between. This directory is the documentation —
it lives with the code, so the version you are reading is the version you cloned.

## What is in this repository

Three things, and they are not the same thing:

| | What it is | Where it runs |
| --- | --- | --- |
| **The application** | `src/`, `server/`, `worker/`, `migrations/` — the board, its API and its schema | **your machine**, as an instance |
| **The website** | `site/`, built by `scripts/build-site.ts` — the project's own front door | this project's origin, and nowhere else |
| **The documentation** | `docs/` — the files you are reading | GitHub, from the clone you already have |

**An instance is the application.** A team that runs `docker compose up -d` gets the board, its API and
its database — and their own address, their own accounts, their own data. It does not get this
project's website: the marketing pages, the privacy notice about *this* deployment, and the project's
`security.txt` all belong to the project's own origin, not to somebody's instance.

An instance answers `/` by sending you to `/app`, and serves the application, its assets and its API.
Ask it for `/install/`, `/privacy/` or the project's sitemap and you get **its own** 404 — not this
project's pages at somebody else's address. The only pages of this project an instance links are the
terms and the privacy notice, and it points at them here, on this site, when `PROJECT_URL` says where
that is.

## If you are using it

| | |
| --- | --- |
| **[Using the application](using.md)** | the board, a card, an initiative, the views, and keeping a copy |
| **[Board types](board-types.md)** | team, programme and portfolio boards, and which level fits the work |

## If you are installing it

Follow these in order. Each one is short, and each ends where the next begins.

| | |
| --- | --- |
| 1. **[Install](install.md)** | Node 26, three commands, and what the first run writes |
| 2. **[Configure](configure.md)** | every environment variable, its default, and what happens when it is unset |
| 2b. **[Identity](identity.md)** | signing in through an issuer, and provisioning people from a directory (SCIM) |
| 3. **[TLS and the proxy](tls.md)** | the one thing every operator must get right, with Caddy and nginx |
| 4. **[Upgrade](upgrade.md)** | what a release does to your database, and how to go back |
| 5. **[Backup and restore](backup.md)** | the copy, the schedule, and the drill that proves it |

Prefer a container to a systemd unit? **[In a container](docker.md)** is the same path with
`docker compose up -d` as the whole install.

A fresh machine can go from nothing to a running instance in about ten minutes, and most of that is
the build.

## If you are reading the code

| | |
| --- | --- |
| **[Architecture](architecture.md)** | the layers, the workspace boundary, and how a request becomes work |
| **[The two runtimes](server-runtime.md)** | Worker and Node from one codebase, and the rule that keeps it honest |
| **[The API](api.md)** | every route, what it answers, and how a session is carried |
| **[The REST API](rest-api.md)** | `/api/v1`: the supported surface, its conventions, and the promise that it does not move |
| **[MCP](mcp.md)** | the agent's door: the tool list, both transports, and the rule that an agent writes what a person asked for |
| **[The data model](data-model-v2.md)** | what a workspace is made of |
| **[Admin, identity and roles](admin.md)** | the design behind the two axes — instance and workspace — and the roles each answers |
| **[Lean metrics](metrics.md)** | what the Flow view measures today, the plan to strengthen it, and what it will not become |
| **[Collaboration](collaboration.md)** | how two people edit at once without losing a change |
| **[The public site](public-site.md)** | what the project's site says, and why each page exists |

## If you are contributing

| | |
| --- | --- |
| **[CONTRIBUTING](../CONTRIBUTING.md)** | running it, the checks that gate a merge, and what a pull request needs |
| **[SECURITY](../SECURITY.md)** | how to report a vulnerability, and what is out of scope |
| **[AGENTS](../AGENTS.md)** | the house rules, including the one about which services this project does not use |
| **[Roadmap](roadmap.md)** | what is built, what is next, and what is deliberately not planned |

## How this documentation is kept honest

- **One home.** Every page exists once, here. The site links to these files rather than copying them,
  because a page that exists twice will drift and one of the two will be wrong.
- **The wiki is a guide, not a second home.** `npm run docs:wiki` publishes the reader's pages —
  using the application, install, configure, identity, TLS, upgrade, backup and the container — to the
  [GitHub Wiki](https://github.com/malcolmbastien/kanbantoolkit/wiki) with a sidebar and a search box.
  It is rendered from these files, so a change is made here and republished — never made there; a
  page edited in the wiki is one the next publish replaces. The engineering pages stay in this
  directory, and the guide links to one where a page needs it.
- **The links are checked.** `npm run docs:check` fails when a relative link points at a file that
  does not exist, when a file in this directory is not listed above, or when the commands quoted in
  these pages are not the commands `package.json` runs.
- **The operator's pages say when they were last run.** Each ends with the release it was verified
  against. A page that cannot say that is a page nobody has followed.
