# Kanban Toolkit documentation

Kanban Toolkit is a Kanban board for the team doing the work, for program and project managers
connecting outcomes across teams, and for directors and leaders reading how the department rolls up
to its OKRs. It runs on a machine you own as a **Docker image**: one published image, one SQLite
file on a volume, no service in between. These documents live with the code, so they describe the
version you are running.

## What is in this repository

Three things, not the same:

| | What it is | Where it runs |
| --- | --- | --- |
| **The application** | `src/`, `server/`, `worker/`, `migrations/` — the board, its API and its schema | **your machine**, as an instance |
| **The website** | `site/`, built by `scripts/build-site.ts` — the project's own front door | this project's origin, and nowhere else |
| **The documentation** | `docs/` — the files you are reading | GitHub, in this repository |

**An instance is the application.** The published image gives a team the board, its API and
database — their own address, accounts and data. It does not get this
project's website: the marketing pages, the privacy notice about *this* deployment, and the project's
`security.txt` all belong to the project's own origin, not to somebody's instance.

An instance answers `/` by sending you to `/app`, and serves the application, its assets and its API.
Ask it for `/install/`, `/privacy/` or the project's sitemap and you get its own 404. The only pages
of this project an instance links are the terms and the privacy notice, and it points at them here,
on this site, when `PROJECT_URL` says where that is.

## If you are using it

| | |
| --- | --- |
| **[Using the application](using.md)** | the board, a card, an initiative, the views, and keeping a copy |
| **[Board types](board-types.md)** | team, program and portfolio boards, and which level fits the work |
| **[Reading a board](reading-a-board.md)** | the drawer, the columns, pips, rollups, multiple cards flows and external dependencies |
| **[Importing a board](import.md)** | Trello, Jira and plain CSV files, the mapping step, and what is created |
| **[Warnings and signals](warnings.md)** | every badge and warning on a card, an initiative or an objective, and what it means |

## If you are installing it

Follow these in order.

| | |
| --- | --- |
| 1. **[Install](install.md)** | the published image, one command, and what the first run writes |
| 1b. **[In a container](docker.md)** | the volume, backups taken inside it, upgrades, and what SQLite means |
| 2. **[Configure](configure.md)** | every environment variable, its default, and what happens when it is unset |
| 2b. **[Identity](identity.md)** | signing in through an issuer, and provisioning people from a directory (SCIM) |
| 3. **[TLS and the proxy](tls.md)** | certificates and a proxy, with Caddy and nginx |
| 4. **[Upgrade](upgrade.md)** | what a release does to your database, and how to go back |
| 5. **[Backup and restore](backup.md)** | the copy, the schedule, and the drill that proves it |

Without Docker — from source or a systemd unit — [install.md](install.md) has the development path;
the container is the install this project expects.

## If you are reading the code

| | |
| --- | --- |
| **[Architecture](architecture.md)** | the layers, the workspace boundary, and how a request becomes work |
| **[The two runtimes](server-runtime.md)** | Worker and Node from one codebase |
| **[The API](api.md)** | every route, what it answers, and how a session is carried |
| **[The REST API](rest-api.md)** | `/api/v1`: the supported surface and its conventions |
| **[Webhooks](webhooks.md)** | signed outbound events, the envelope, verification and retries |
| **[MCP](mcp.md)** | the agent's door: the tool list and both transports |
| **[The data model](data-model-v2.md)** | what a workspace is made of |
| **[Admin, identity and roles](admin.md)** | the two axes — instance and workspace — and the roles each answers |
| **[Lean metrics](metrics.md)** | what the Flow view measures, and what it will not become |
| **[Collaboration](collaboration.md)** | how two people edit at once without losing a change |
| **[The public site](public-site.md)** | what the project's site says, and why each page exists |

## If you are contributing

| | |
| --- | --- |
| **[CONTRIBUTING](../CONTRIBUTING.md)** | running it, the checks that gate a merge, and what a pull request needs |
| **[SECURITY](../SECURITY.md)** | how to report a vulnerability, and what is out of scope |
| **[AGENTS](../AGENTS.md)** | the house rules, including the one about which services this project does not use |
| **[Roadmap](roadmap.md)** | what is built, what is next, and what is deliberately not planned |
| **[Product review](product-review.md)** | where the product is strong, where it is thin, and candidate enhancements |

## How this documentation is kept honest

- **One home.** Every page exists once here; the site links to these files rather than copying them.
- **The wiki is a guide, not a second home.** `npm run docs:wiki` publishes the reader's pages — using
  the application, install, configure, identity, TLS, upgrade, backup and the container — to the
  [GitHub Wiki](https://github.com/malcolmbastien/kanbantoolkit/wiki) with a sidebar and a search box.
  It is rendered from these files, so a change is made here and republished; a page edited in the wiki
  is replaced by the next publish. The engineering pages stay in this directory, and the guide links
  to one where a page needs it.
- **The links are checked.** `npm run docs:check` fails when a relative link points at a file that
  does not exist, when a file in this directory is not listed above, or when the commands quoted in
  these pages are not the commands `package.json` runs.
- **The operator's pages say when they were last run.** Each ends with the release it was verified
  against.
