# Flowline

**Work is a graph. Boards are views. Types are yours.**

Flowline is a prototype built from [`flowline-mvp-prd.md`](./flowline-mvp-prd.md) and then
generalised (see [`docs/data-model-v2.md`](./docs/data-model-v2.md)). It replaces the fixed
`Initiative > Epic > Story` hierarchy with:

- **A generic parent/child hierarchy** — any card has **one parent** and **any number of
  children**. Structural **depth** is derived from that chain; there is no level field.
- **User-defined issue types** — create, rename and recolour types in-app. A type is a
  label + colour; any type can sit in any column.
- **LeanKit-style lane boards** — a recursive lane tree. A **leaf lane is a cell**; a
  **container** arranges its children in columns (side by side) or rows (stacked). Any cell
  can be split into a container of either orientation, recursively — so the grid is
  **non-uniform**, exactly like LeanKit. All design controls (split / add / rename /
  remove lanes) live behind an **Edit board** mode.
- **Fixed post-it cards, fluid lanes.** A card is a fixed 180×112 note; lanes **expand to
  fit every card** in them (no in-cell scrolling), so a row is as tall as its busiest cell.
- **Flight-level badge.** Every board is labelled by Kanban flight level — **Portfolio**,
  **Project**, or **Team** — shown as a badge in the toolbar and board header and editable
  inline. It's an orientation label for a board, distinct from an item's derived `depth`.
- **Management boards vs team boards.** A board is one or the other, by level: a
  **management board** (Portfolio level) shows an **Initiatives workflow** of its own top-level
  initiatives — wide summary cards with a **progress bar + %** and **card symbols** summarising
  the **linked work** at a glance (team initiatives for a top-level initiative, cards for a
  team-level one) — plus **Linked workflows**: a rollup band per team board it aggregates (add
  them via **Add linked workflow**). A **team board** shows its own initiative flow. Pick a
  board from the **Board** menu; there's no separate view toggle.
- **Initiatives on boards; cards beneath.** A board's flow shows its **Initiative-typed
  items** (positioned by rollup); their children are the detailed cards, seen by opening an
  initiative. From a management initiative you can **link** down to a new team initiative: it's
  created on a team board as a child, so its cards roll up the hierarchy.
- **Rollup boards.** Mark a board as *rollup* and each card's column is **derived from the
  status of the work at the lowest level** of its subtree — mapped onto the board's start /
  in-progress / done lanes — rather than stored. Parents also show a computed **%** done.
  Nothing is typed: status, depth and rollup are all computed.
- **Three typed columns.** Every board's top level is exactly three columns typed
  **Not Started / In Progress / Done**. A leaf's status is the *type* of the column it
  ultimately sits under, which is what makes status roll up the hierarchy. The top-level
  columns are fixed — you refine them by **splitting** (e.g. In Progress → Dev / Test), and
  sub-lanes inherit the type; the editor hides add/remove/flip/rename there.
- **Explicit placements** — a card's board + cell is stored as a `Placement` record (one
  per board), so a single card can still live on several boards with one identity.

And the derived facts that don't go away: **dependency state** is computed from both
endpoints' cells, and **attribution never counts as work**.

## No Google, no Firebase

This app has **zero Google or Firebase dependencies**, by design.

- Runtime: a static Vite + React SPA. All state is in the browser (`localStorage`).
  No backend, no auth, no cloud services of any kind.
- Deploy target: **Vercel** (static build in `dist/`). Runs on any static host.
- The only external service is the LLM used **offline at authoring time** by Taskmaster,
  which talks to your **OpenCode Go** subscription.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

```bash
npm run build        # tsc -b && vite build  ->  dist/
npm run preview      # serve the production build
npm test             # Vitest: derivation + store behaviour
npm run lint         # oxlint
```

### Deep links

```
/?board=b-core                        # Core Experience (nested lanes)
/?board=b-portfolio                   # Portfolio (row-less board)
/?board=b-platform                    # Platform Services
/?board=b-core&item=it-signup         # open a card
/?board=b-core&edit=1                 # start in board edit mode
/?board=b-design                      # the seeded sketch layout (nested Doing/Projects)
/?board=b-team-alpha                  # a team board (its own initiatives)
```

## What to try

Things to try:

1. **Custom types** — open **Types**; rename/add a type and recolour it. A card can be any type.
2. **Generic hierarchy** — open a card; set its parent or add a child (choose the child's
   type). One parent, many children; depth updates.
3. **Edit board** — create a **new board**, then build any layout: split a cell into
   **columns** or **rows** (locally — Team Alpha's `In Progress` is split, Team Bravo's is
   not), **add** lanes, **flip** a container's orientation, mark **start/done** columns, set
   **WIP** limits, rename and remove. Experiment freely: **Save** keeps the design,
   **Cancel** reverts to the state you started editing from.
4. **Initiatives roll up** — open *Onboarding Redesign*: its children are team initiatives (one per team board), never cards; each team initiative's cards roll up into its %.
5. **Dependency self-cleans** — set "API decision" to Done; the blocked story flips to
   Satisfied with nobody touching it.
6. **Attribution never inflates** — "Build signup form" serves 2 objectives; WIP stays 1.
7. **WIP limits are visible, not enforced** — a lane over its limit shows red; moves are never blocked.

## Architecture

```
src/
  domain/
    types.ts     # IssueType, Board, Lane, Item, Placement, Edge  (no board/level field on Item)
    lanes.ts     # lane tree: leaves, depth, spans, per-lane WIP counts
    derive.ts    # depth, statusOf (from the cell), dependencyState, pressure, attribution
    board.ts     # items on a board (via placements) + display refs
    seed.ts      # the demo graph: custom types, two boards, a split column, multi-board placement
  store.ts       # zustand + localStorage; placements, lane splits, type CRUD, single parent
  components/     # TopBar, BoardView (nested lanes), Card, BoundaryPin, ItemPanel, TypeEditor
  lib/            # class utils, colour helpers
```

- A **board** owns a recursive **lane tree**: a leaf lane is a cell that holds cards; a
  container arranges children in columns or rows. `leafLanes()` flattens it; the renderer
  recurses so the grid can be non-uniform. `splitLane`/`addLane`/`removeLane` mutate the
  tree; all design controls show only in **edit mode**.
- **Status is derived from the column type**: a leaf's status is the `stage` of the
  top-level column it sits under (sub-lanes inherit it), and `statusOf()` reads that.
  Dependency state is arithmetic over two cells.
- **`setParent`** drops any existing decomposition parent, enforcing one parent.

## Taskmaster (authoring workflow)

Task generation uses [Task Master](https://github.com/eyaltoledano/claude-task-master)
driven by the **OpenCode Go** subscription — not Google. The gateway requires an
`x-opencode-session` header that off-the-shelf clients don't send, so a tiny zero-dependency
reverse proxy injects it:

```bash
npm run taskmaster:proxy      # terminal 1: http://127.0.0.1:8788 -> https://opencode.ai/zen/go/v1
task-master list              # terminal 2
task-master parse-prd .taskmaster/docs/prd.md
```

- `OPENAI_COMPATIBLE_API_KEY` lives in `.env` (gitignored; see `.env.example`).
- Models are configured in `.taskmaster/config.json`.
- Tags: `master` (the original MVP breakdown) and `backlog` (the post-foundation
  feature backlog, `.taskmaster/docs/features.md`). Use `task-master list --tag=backlog`.
