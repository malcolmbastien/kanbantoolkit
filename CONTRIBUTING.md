# Contributing to Kanban Toolkit

Kanban Toolkit is **AGPL-3.0-or-later** software you install and run yourself. Contributions are welcome on
those terms — there is no CLA and no copyright assignment.

If something is broken or missing, an [issue](https://github.com/malcolmbastien/kanbantoolkit/issues) is
the place to say so. A pull request is welcome too; what follows is the whole of the process.

## Running it

Node **26** (the version CI runs).

```bash
npm install
npm run dev          # http://localhost:5173/app — the app lives under /app
```

`npm run build` writes the site and the app into `dist/`; `npm run server` serves them from Node with
a SQLite file. The app works with no server at all — the static build is a complete board.

## The checks

```bash
npm test             # the domain, the store, and the server's routes
npm run scan         # the dependency rule: no forbidden services
```

CI runs those and the rest — `npm run build`, `npm run lint`, `npm run test:e2e`, `npm run site:check`,
`npm run docs:check`, `npm run size`, `npm run smoke:node`. Run the ones your change touches.

The browsable documentation wiki is generated from `docs/`, so it is never edited there: after a change,
`npm run docs:wiki` republishes it. `npm run docs:check` already fails when a page is missing from the
map in `scripts/wiki.mjs`.

## Where things are

- `src/domain/` — the rules, as pure functions: no framework, no store, no network, unit tested.
- `server/` — what both runtimes share; `worker/` and `server/index.node.ts` are the two entries, and
  nothing in `server/` may import a Cloudflare binding.
- [`AGENTS.md`](AGENTS.md) — the house rules, including the one `npm run scan` enforces.
- [`docs/server-runtime.md`](docs/server-runtime.md) — the two runtimes and the line between them.
- `.taskmaster/` — the backlog this work is planned in, cited by number in comments. Nothing in it is
  needed to build, test or run the app.

## A pull request

- **One thing.** A fix and a restyle are two pull requests.
- **A test that fails without it** — a rule in `src/domain/` gets a unit test; a flow a person
  performs gets an e2e in `e2e/`.
- **A migration** (`migrations/NNNN_name.sql`) if the schema changes. D1 and a SQLite file run the
  same file, so one that only works on one of them is a bug.
- **The reason in the commit**, in the shape `git log` already uses.

## Releases

The version in `package.json`, a `vX.Y.Z` tag, and a note on the tag saying what changed for a person
using it. If `migrations/` changed, the note says to take a backup first: the server applies pending
migrations on start and refuses to serve a database it cannot migrate.

## Licence

By contributing you agree that your contribution is licensed under the **GNU Affero General Public
License, version 3 or later**, the same terms as the rest of the project. If your employer owns your
work, get their permission before you send it.
