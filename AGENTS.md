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
- **Three typed top-level columns.** Every board's root has exactly four children typed
  `stage: 'backlog' | 'notStarted' | 'inProgress' | 'done'` (Backlog / Not Started / In
  Progress / Done). These are fixed — `addLane`/`removeLane` on the root and
  `setLaneOrientation` on the root are no-ops; refinement happens by **splitting**, and
  descendants inherit the stage via `effectiveStage`. A leaf's status comes from its column's
  stage, which makes status roll up the hierarchy.
- **The initiatives flow.** A typed column is a **section** of a board's initiatives flow and
  its leaves are its **cells**. An initiative's section is *derived* — `rollupOf` picks the
  column whose stage matches its bucket — while its cell is *arranged*: `Placement.laneId`,
  falling back to the section's first cell when that placement is stale (`initiativeCellOf`).
  So splitting a column gives initiatives cells to arrange within, but a move can never cross
  a section (`moveInitiative` refuses it). Sections and cells are the same lanes the cards
  workflow uses, so a split serves both — and lane editing is surfaced in the initiatives flow
  too, because a program board has no cards workflow to edit from.
- **Rollup reads leaves only, and never claims completion early.** All done → `done`; anything
  under way → `inProgress`; anything committed → `notStarted`; every leaf uncommitted →
  `backlog`. A Backlog leaf does **not** drag its parent backwards — a partly-planned
  initiative is still in progress. The inconsistency is surfaced, not enforced: when a
  committed item (Not Started / In Progress) sits over Backlog leaves, `uncommittedBelow`
  raises a **warning** on the card. Never a block, never an auto-correction.
- **Placement is explicit**: a card's board + cell is a `Placement` record (one per board).
- **Boards show initiatives**: a board's flow renders items of the **Initiative** issue type,
  placed by rollup (card children are drill-in). A board has a **flight-level band**
  (`band: 'team' | 'program' | 'portfolio'`) that picks its lens: a
  **team** board renders work, while a **program** or **portfolio** board
  aggregates other boards — its own initiatives plus a band per `linkedBoardIds`. Bands are
  lenses, not depths: the aggregation graph may be any depth and mix teams with other
  coordination boards, so long as it stays **acyclic** (`canLinkBoard`). The current
  "portfolio" surface is a coordination board; there is no separate portfolio entity.
  A **portfolio** board leads with a **strategy map** (`StrategyMap`): its strategic
  initiatives grouped under the **objective** they serve, with both coverage gaps inline.
  There it replaces the initiatives workflow and the separate OKR-coverage section.
  `linkTeamInitiative` creates a team initiative as a decomposition child of a management
  initiative so it rolls up.
- Dependency state is derived from the two endpoints' cells; never store a dependency
  status field. Attribution never counts as WIP. OKRs attach to **strategic initiatives**
  only — an Initiative placed on a portfolio board; everything below inherits through the
  decomposition (`isStrategicInitiative`). `okrCoverage` surfaces the two gaps: a strategic
  initiative with no OKR, and an OKR with no strategic initiative.
- Limits are per-lane `wipLimit`s and are **visual only** — a lane over its limit shows red, but moves are never blocked (no prompts). Counts read the **whole** column, never the filtered view: a focus narrows what you *see*, not the load a column carries.
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
