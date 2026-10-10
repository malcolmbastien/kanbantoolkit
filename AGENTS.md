# AGENTS.md — Flowline

## Hard rule: no Google, no Firebase

This project must contain **no Google or Firebase services or dependencies** — runtime,
build, or tooling. Do not add Firebase, Firestore, Google Auth, Google Fonts, gstatic
assets, Gemini, Vertex, or `gemini-cli`. The app is a static Vite + React SPA deployed
to Vercel; all state lives in `localStorage`.

Before finishing any task, run:

```bash
grep -rinE 'google|firebase|gemini|gcloud|gstatic|firestore' . \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude=README.md --exclude=AGENTS.md
```

It must return nothing. (`README.md`/`AGENTS.md` mention the rule itself; the PRD/docs
should stay free of service names too.)

## Taskmaster

Task generation is powered by the **OpenCode Go** subscription via a local header-injecting
proxy (see `scripts/opencode-go-proxy.mjs`). Start it before any `task-master` command:

```bash
npm run taskmaster:proxy    # terminal 1
task-master list            # terminal 2
```

- Models: `.taskmaster/config.json` → provider `openai-compatible`, baseURL
  `http://127.0.0.1:8788/v1`.
- Key: `OPENAI_COMPATIBLE_API_KEY` in `.env` (gitignored). Never commit it.
- Scoped PRD: `.taskmaster/docs/prd.md`.

## Conventions

- TypeScript strict; path alias `@/*` → `src/*`.
- Domain logic lives in `src/domain/` and must stay pure and framework-free; it is unit
  tested in `*.test.ts` (`npm test`).
- **Hierarchy is generic and structural.** A card has at most one parent (`setParent`
  enforces it). `depth` is derived — never add a `level` field.
- **Issue types are labels + colour.** Columns come from a board's lane tree, never from
  the type. Never add a lifecycle to `IssueType`.
- **Boards are a recursive lane tree.** A leaf lane is a cell; a container arranges children
  in columns or rows; any cell can be split. Board-design actions (`splitLane`, `addLane`,
  `removeLane`) mutate the tree and are surfaced only in **edit mode**.
- **Placement is explicit**: a card's board + cell is a `Placement` record (one per board).
- Dependency state is derived from the two endpoints' cells; never store a dependency
  status field. Attribution never counts as WIP.
- Limits are per-lane `wipLimit`s; soft-block with a required, recorded reason.
- Before finishing any task, run the no-Google/Firebase scan above and `npm test`.

## Persisted state (localStorage)

The app persists to `flowline-state-v3` via `zustand/persist`. When you add a
**required field** to a persisted entity (Board/Lane/Item/Placement):

1. bump `version` in the persist config, and
2. add a `migrate(persisted)` that backfills the field for old data.

Also make display components defensive for fields that may be missing on rehydrate
(e.g. `LevelBadge` falls back to `LEVEL_STYLES.team`). A hard-refresh with stale
`localStorage` should never throw.

## Commands

```bash
npm run dev      # dev server
npm run build    # typecheck + production build
npm test         # vitest
npm run lint     # oxlint
```
