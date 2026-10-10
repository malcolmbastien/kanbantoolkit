# Flowline

**Work is a graph. Boards are views. Types are yours.**

Flowline is a prototype built from [`flowline-mvp-prd.md`](./flowline-mvp-prd.md) and then
generalised (see [`docs/data-model-v2.md`](./docs/data-model-v2.md)). It replaces the fixed
`Initiative > Epic > Story` hierarchy with:

- **A generic parent/child hierarchy** — any card has **one parent** and **any number of
  children**. Structural **depth** is derived from that chain; there is no level field.
- **User-defined issue types** — create, rename and recolour types in-app. A type is a
  label + colour; any type can sit in any column.
- **LeanKit-style lane boards** — vertical lanes (columns) and horizontal lanes (rows),
  each **splittable into sub-lanes**. A card's cell is the intersection of a leaf column
  and a leaf row.
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
```

## What to try

The **Guide** panel walks these:

1. **Custom types** — open **Types**; rename/add a type and recolour it. A card can be any type.
2. **Generic hierarchy** — open a card; set its parent or add a child (choose the child's
   type). One parent, many children; depth updates.
3. **LeanKit lanes** — split the **In Progress** column (or a **Team** row) with the split
   icon, then drag a card into a sub-lane.
4. **One card, two boards** — "New signup flow" sits on Core Experience *and* Portfolio.
5. **Dependency self-cleans** — set "API decision" to Done; the blocked story flips to
   Satisfied with nobody touching it.
6. **Attribution never inflates** — "Build signup form" serves 2 objectives; WIP stays 1.
7. **WIP limit** — drag a card into a lane at its limit; a reason is required.

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

- A **board** owns a **lane tree** per axis. `leafLanes()` gives the columns/rows;
  `leafCount()` drives `colSpan`/`rowSpan` so nested headers align.
- **Status is derived from the cell**: a card's column lane carries `isStart`/`isDone`/
  `isCancelled`, and `statusOf()` reads it. Dependency state is arithmetic over two cells.
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
