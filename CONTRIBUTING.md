# Contributing to Flowline

Flowline is **AGPL-3.0-or-later** software you install and run yourself. Contributions are welcome
on those terms — there is no CLA and no copyright assignment.

## Read this first

Two documents say more about this codebase than any style guide:

- **[`AGENTS.md`](AGENTS.md)** — the house rules, including the hard rule about which services this
  project does not use. It is not a preference: `npm run scan` enforces it, and the check names the
  forbidden things so this file does not have to.
- **[`docs/server-runtime.md`](docs/server-runtime.md)** — the two runtimes, the boundary between
  `src/`, `server/` and `worker/`, and why nothing in `server/` may import a Cloudflare binding.

`.taskmaster/` is how this work is planned: the task backlog, its PRD and the complexity report the
planning tool keeps. It is notes rather than product — nothing in it is needed to build, test or run
the app — and comments in the code cite its task numbers (`task 174`) rather than restating the
reasoning, which is why it is published alongside the code.

The domain is in `src/domain/`: pure functions, no framework, no store, no network. If a rule can be
written as a function of the data, it belongs there and it is unit tested. Everything else is a thin
layer that calls it.

## Running it

Node **26** (the version CI runs).

```bash
npm install
npm run dev          # http://localhost:5173/app — the app lives under /app
```

The app works with no server at all: the static build in `dist/` is a complete board. The server
adds accounts, sharing and a second device, and is only needed for those.

```bash
npm run build        # tsc + vite + the site, into dist/
npm run server       # the self-hosted entry: Node, a SQLite file, the built client
npm run preview      # serve the build the way a host does
```

## The checks

A pull request is ready when these pass. CI runs exactly these, and nothing else is a merge gate.

| Command | What it holds |
| --- | --- |
| `npm run build` | the types, the bundle, and the site |
| `npm test` | the domain, the store, and the server's routes |
| `npm run test:e2e` | the flows a person actually performs, against the built app |
| `npm run lint` | `oxlint` |
| `npm run scan` | the dependency rule in `AGENTS.md` |
| `npm run site:check` | the built site: page names, links, budget, no foreign requests |
| `npm run docs:check` | the docs: every link resolves, every file is listed, every command exists |
| `npm run size` | the first download stays inside its budget |
| `npm run smoke:node` | the second runtime boots and answers |

Run the ones your change touches before you push; run all of them before you ask for a review.

## What a pull request needs

1. **One thing.** A branch that fixes a bug and restyles a panel is two pull requests wearing one
   hat, and the review will say so.
2. **A test that fails without it.** A rule in `src/domain/` gets a unit test; a flow a person
   performs gets an e2e in `e2e/`. A bug fix gets a test that reproduces the bug.
3. **A release note at the tag** if a person using Flowline would notice the change — in the words
   somebody would read, not the commit subject. There is no changelog page on the site: the
   repository's releases and its history are the record.
4. **A migration** if the schema changes — `migrations/NNNN_name.sql`, applied unchanged on D1 and on
   a SQLite file. Both runtimes read the same file, so a migration that only works on one is a bug.
5. **The checks green**, and a sentence in the pull request saying what you ran.

## How to write it

- **Explain the reason, not the mechanics.** A comment that says what the code does is noise; a
  comment that says why the obvious alternative was wrong is the point. Every file in `server/` and
  `src/domain/` opens with the decision it encodes.
- **Commit messages** read `area: the sentence that says what changed`, then a body that gives the
  reason. Look at `git log` for the shape.
- **Comments are not a substitute for a test.** If the promise matters, assert it.
- **No new dependency** unless the work genuinely needs it. The client ships as a static bundle and
  its size is budgeted; a library that does what twelve lines would do is a regression.

## Releases

There is no release automation yet. A release is:

1. The version in `package.json`, bumped.
2. A tag, `vX.Y.Z`.
3. A release note on the tag, saying what changed for a person using it.
4. **If `migrations/` changed, say so in the entry** — the server applies pending migrations at
   start and refuses to serve a database it cannot migrate, so an operator needs to know to back up
   first. `npm run backup` takes a consistent copy while the server keeps running.

Before 1.0 a minor version may change a behaviour or a URL; the changelog says which, and why.

## Licence

By contributing you agree that your contribution is licensed under the **GNU Affero General Public
License, version 3 or later**, the same terms as the rest of the project. If your employer owns your
work, get their permission before you send it.
