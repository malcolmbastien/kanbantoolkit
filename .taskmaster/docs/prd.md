# Flowline — Core Experience MVP (prototype PRD)

> Scoped derivative of `flowline-mvp-prd.md`. The full PRD is the north star; **this**
> document defines the slice we build first. Goal: a local-first prototype that lets a
> reviewer *feel* the two load-bearing ideas in one sitting:
>
> **1. One item, three boards, no duplication.**  **2. Dependency self-cleaning.**

## Product principles (inherited from the full PRD)

These are build constraints, not aspirations. See `flowline-mvp-prd.md` §2.1–2.2.

1. **A joy to use** — fast, quiet, predictable; a board reads at a glance.
2. **Respect the user's time** — derive what the graph already knows (level, status,
   dependency state, roll-up); never ask for a fact the system can compute.
3. **Human in control — no AI slop** — nothing is generated, guessed, or changed behind the
   user's back; every state is derived from the user's structure or set explicitly. If it
   can't show its work, it doesn't ship.
4. **Intelligent roll-up, one truth for two audiences** — the same graph read at the
   resolution each audience needs. Executives get a clear high-level flow with accountability
   and a way to drill down; teams get the freedom to define their own flows and decompose
   initiatives their way. Roll-up is a view of the graph, so it stays honest without a second
   data-entry burden.

## 1. What this MVP must prove

A single graph read at different resolutions. Items have **no board membership field**.
Board membership is computed from scope ∩ resolution. Levels and dependency state are
**derived**, never typed.

| # | Behaviour | Why it matters |
|---|---|---|
| A | Resolution switcher (L1 initiative / L2 epic / L3 story) changes the **column set** and the **counting unit**, without changing scope. | The structural move. |
| B | One epic renders on three boards with one identity: L2 card on its value-stream board, L3 **boundary pin** on a team board, rollup contribution on the L1 portfolio. | Item 1 of the PRD definition-of-done. |
| C | **Level is computed** from decomposition. Re-parenting children changes an item's level. There is no level field. | Derivation is the moat. |
| D | **Dependency state is computed** from both endpoints. Resolving a dependency flips the dependent's state with nobody touching it. | Item 3 — the other load-bearing idea. |
| E | **Attribution never counts as WIP.** One story attributed to two objectives reads as one unit of work. | Keeps counting honest. |
| F | A configurable **limit** (epics per value stream) soft-blocks with a **required reason**, and the epic carrying open descendants shows **composition pressure**. | Limits working. |
| G | **Portfolio rollup**: an initiative's status is computed from committed work and shown on a **management board dashboard**. | The exec board stops lying. |

## 2. Tech stack (local-first prototype)

- **Vite + React 19 + TypeScript**, strict.
- **Tailwind CSS v4** for the LeanKit-style dense visual language.
- **Zustand** for state; **persist to localStorage**. No backend, no auth, no third-party services.
- **@dnd-kit** for drag-and-drop of cards between columns/rows.
- **lucide-react** icons. **clsx + tailwind-merge** for class composition.
- **Vitest** for unit tests of the derivation functions (level, dependency state, rollup).
- Seeded in-memory demo enterprise so the board is populated on first load.
- A **"Reset demo"** action restores the seed.

## 3. Domain model

Everything is nodes and typed edges. No `board` field anywhere.

```
Scope { id, name, kind: enterprise | value_stream | team | function, parentId }
Item  { id, title, description?, type: initiative|epic|story|defect,
        valueStreamId, teamId?, state, size?, assignee?, createdAt, resolvedAt? }
Edge      { id, kind: decomposition | attribution, from, to }
ItemLink  { id, from, to, reason? }   # "to depends on from" — immediate, no approval state
LimitPolicy { id, resolution, itemType, scopeId?, column?, enforcement, thresholds }
Objective / KeyResult — commitment-limited entities, never in columns.
```

### Lifecycles (columns) per resolution
- **L1 initiative**: Idea → Option → Bet → Committed → Rejected; plus **Dormant** as a
  first-class state (not an archive).
- **L2 epic**: Backlog → Analyze → In Progress → Ready → Done.
- **L3 story/defect**: Backlog → In Progress → Review → Done.

### Derivation rules (the point of the product)
- `level(item)`: initiative → L1. Else if it decomposes into epics → L2. Else if it
  decomposes into stories → L3. Else L3 (schedulable floor).
- `dependencyState(dependency, dependent)`: dependent resolved → Closed; dependency
  resolved, dependent unresolved → Satisfied; dependency unresolved, dependent not
  started → Open (planning risk); dependency unresolved, dependent in progress →
  Open (live blockage).
- `portfolioStatus(initiative)`: computed from its committed/decomposed epics.
- Attribution edges are excluded from all WIP counts and composition pressure.

## 4. Screens / UX

- **Top bar**: brand, Board selector, Scope selector, **Resolution switcher**
  (Initiative L1 / Epic L2 / Story L3), search, zoom, Reset demo.
- **Board**: vertical state columns × horizontal scope lanes. Lane headers show
  `count / limit` coloured at yellow/red thresholds. Row rail shows per-row count.
- **Cards**: type pill (colour-coded), title, id + size, left stripe by value stream,
  bottom icon row (dependency count, child count, blocked flag).
- **Boundary pins**: a card shown where it does not belong renders with no pill, no WIP
  count, dashed left border, "waiting on: <title>" and opens the item in a **side panel**
  scoped to its own board (never navigate away).
- **Ghost lane**: when a dependency enters from outside the scope, a read-only lane at the
  board edge lists only the binding items.
- **Item side panel**: details, children, dependencies (raise), the
  computed level and dependency states with the derivation shown.
- **Limit dialog**: soft-block returns a **required reason** before the move is allowed.

## 5. Seed demo enterprise

One enterprise, two value streams, three teams.

- Enterprise
  - **Core Experience**: Team Alpha, Team Bravo
  - **Platform Services**: Team Platform
- 1 initiative (Onboarding Redesign) decomposing into ~5 epics across both streams.
- 2 objectives; stories attributed many-to-many to prove attribution doesn't inflate.
- Stories per epic; a defect.
- Cross-team dependency: a Team Bravo story blocked by the Platform **"API decision"** epic.
- Epic limit per value stream = 4, seeded with 5 epics so the soft block is demonstrable.
- One epic carries ~18 open descendants to show composition pressure.

## 6. Out of scope for this MVP

Backend services, auth, real-time sync, integrations, org charts, custom entity types,
generic relations, time-boxes, CFD/Monte-Carlo, burndowns, capacity planning, and any
screen that does not serve behaviours A–G.

## 7. Definition of done

1. `npm run dev` shows a populated LeanKit-style board; `npm run build` and
   `npm test` are green.
2. Switching resolution changes columns and counting unit; scope is unchanged.
3. The seeded epic appears as an L2 card, an L3 boundary pin, and an L1 rollup
   contribution — one identity, three renderings.
4. Dragging all children away from an epic changes its computed level.
5. Resolving the dependency epic flips the dependent story to **Satisfied** on both boards
   with no manual edit.
6. The two-objective story contributes **1** to WIP.
7. Adding a 5th epic to a stream triggers the soft block and demands a reason.
8. Each management board has a dashboard listing its initiatives with work progress,
   target date, status, and a count of blocked work down the chain.
