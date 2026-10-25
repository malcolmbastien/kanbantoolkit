# Flowline documentation

Flowline is a board for a team's flow and for the read management makes of it, on a machine you own:
one Node process, one SQLite file, and no service in between. This directory is the documentation —
it lives with the code, so the version you are reading is the version you cloned.

## If you are installing it

Follow these in order. Each one is short, and each ends where the next begins.

| | |
| --- | --- |
| 1. **[Install](install.md)** | Node 26, three commands, and what the first run writes |
| 2. **[Configure](configure.md)** | every environment variable, its default, and what happens when it is unset |
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
| **[The data model](data-model-v2.md)** | what a workspace is made of |
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
- **The links are checked.** `npm run docs:check` fails when a relative link points at a file that
  does not exist, when a file in this directory is not listed above, or when the commands quoted in
  these pages are not the commands `package.json` runs.
- **The operator's pages say when they were last run.** Each ends with the release it was verified
  against. A page that cannot say that is a page nobody has followed.
