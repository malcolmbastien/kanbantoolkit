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
- **Boards are two recursive lane trees.** A lane carries `workflow: 'cards' | 'initiatives'`,
  and a board has one root per workflow. A leaf lane is a cell; a container arranges children
  in columns or rows; any cell can be split. Board-design actions (`splitLane`, `addLane`,
  `removeLane`) mutate one tree and are surfaced only in **edit mode**. The two trees are
  independent and a subtree never mixes them, so every walk stays inside its own workflow —
  which is why `rootLane`, `topLevelLanes` and `leafLanes` take the workflow as a **required**
  argument (the compiler finds the sites that would otherwise silently mix the two).
- **Two workflows, two trees.** The **cards** workflow is the team's own flow — its column
  names, its splits, its WIP limits, reworked whenever they like. The **initiatives** workflow
  is the external representation management reads: typed sections and the cells initiatives are
  arranged in. Neither is a copy of the other and nothing is entered twice — an initiative's
  *section* is derived from the work below — so a team can reshape its board on Tuesday and the
  portfolio is still correct on Wednesday. A template designs the **cards** workflow only; every
  board starts with the **standard** initiatives workflow (four sections, one cell each).
- **Four typed top-level columns, per workflow.** Each root has exactly the four typed columns
  `stage: 'backlog' | 'notStarted' | 'inProgress' | 'done'` (Backlog / Not Started / In
  Progress / Done) — one per stage, never more. These are fixed — `addLane`/`removeLane`
  on the root and `setLaneOrientation` on the root are no-ops; refinement happens by
  **splitting**, and descendants inherit the stage via `effectiveStage`. A leaf's status
  comes from its column's stage, which makes status roll up the hierarchy. A board that
  needs two *done* states (accepted vs released) splits Done into cells; it does not add a
  column.
- **The initiatives flow.** A typed column of the **initiatives** tree is a **section** of a
  board's initiatives flow and its leaves are its **cells**. An initiative's section is
  *derived* — `rollupOf` picks the section whose stage matches its bucket — while its cell is
  *arranged*: `Placement.laneId`, falling back to the section's first cell when that placement
  is stale (`initiativeCellOf`). So splitting a **section** gives initiatives cells to arrange
  within, but a move can never cross a section (`moveInitiative` refuses it). Splitting a cards
  column does none of this — the workflows are independent — and `moveInitiative`/`moveCard`
  each refuse the other's lanes. Lane editing is surfaced in the initiatives flow too, because a
  program board has no cards workflow to edit from.
- **Rollup reads leaves only, and never claims completion early.** All done → `done`; anything
  under way → `inProgress`; anything committed → `notStarted`; every leaf uncommitted →
  `backlog`. A Backlog leaf does **not** drag its parent backwards — a partly-planned
  initiative is still in progress. The inconsistency is surfaced, not enforced: when a
  committed item (Not Started / In Progress) sits over Backlog leaves, `uncommittedBelow`
  raises a **warning** on the card. Never a block, never an auto-correction.
- **Placement is explicit**: a card's board + cell is a `Placement` record (one per board).
- **Boards show initiatives**: a board's flow renders items of the **Initiative** issue type,
  placed by rollup (card children are drill-in). **Only a board that renders a cards workflow makes
  cards** — a coordination board (programme or portfolio) shows bands or objective-grouped flows
  and no cards workflow, so neither the toolbar's *Card* nor the palette's *New card* is offered
  there. *Initiative* is, because an initiative is what such a board is read for. A board has a
  **flight-level band**
  (`band: 'team' | 'program' | 'portfolio'`) that picks its lens: a
  **team** board renders work, while a **program** board aggregates other boards — its own
  initiatives plus a band per `linkedBoardIds`. Bands are
  lenses, not depths: the aggregation graph may be any depth and mix teams with other
  coordination boards, so long as it stays **acyclic** (`canLinkBoard`). The current
  "portfolio" surface is a coordination board; there is no separate portfolio entity.
  A **portfolio** board leads with a **strategy map** (`StrategyMap`) and nothing else: each
  **objective** heads the board's own **initiatives workflow** (`BoardSummary` narrowed with
  `onlyIds`) holding the strategic initiatives attributed to it, with both coverage gaps inline —
  an objective nothing serves says so in words, and an initiative serving nothing gets a flow of
  its own. The map is therefore the portfolio's flow *and* the OKR-coverage section, grouped by
  what the work is for, and it carries **no bands**: a portfolio is read for what the work is
  *for*, and the rollups of the boards beneath it belong to the programme boards. The links stay
  in the model — a programme under a portfolio still rolls up — so this is one surface's choice,
  not a rule about the data.
  `linkTeamInitiative` creates a team initiative as a decomposition child of a management
  initiative so it rolls up.
- Dependency state is derived from the two endpoints' cells; never store a dependency
  status field. Attribution never counts as WIP. OKRs attach to **strategic initiatives**
  only — an Initiative placed on a portfolio board; everything below inherits through the
  decomposition (`isStrategicInitiative`). **An initiative serves one objective**, so attribution
  is a choice and not a set: mapping one that already serves another *moves* it, the same shape as
  `setParent` and a board's kind, and `setAttribution` is the one door that keeps it.
  `okrCoverage` surfaces the two gaps: a strategic initiative with no OKR, and an OKR with no
  strategic initiative.
- Limits are per-lane `wipLimit`s and are **visual only** — a lane over its limit shows red, but moves are never blocked (no prompts). Counts read the **column**, not the view: narrowing what you *see* (search, filters, focus) never changes the load a column carries.
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
