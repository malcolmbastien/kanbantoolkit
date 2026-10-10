# Flowline

**Work is a graph, not a board. Flight levels are resolutions of a view over that
graph. Nothing carries hand-maintained state that could be derived.**

Flowline is an MVP prototype built from [`flowline-mvp-prd.md`](./flowline-mvp-prd.md).
It proves the two load-bearing ideas in one sitting:

1. **One item, three boards, no duplication.** A single epic renders as an L2 card on
   its value-stream board, a **boundary pin** on a team board at L3, and a rollup
   contribution on the L1 portfolio — one identity, three renderings.
2. **Dependency self-cleaning.** Resolve a blocker and the dependent's state flips
   to *Satisfied* with nobody touching it, shown on both boards.

Plus the derived facts that are the actual moat: **level**, **dependency state**, and
**portfolio status** are all computed — there is no level field, no dependency status
field, and no curated exec board.

## No Google, no Firebase

This app has **zero Google or Firebase dependencies**, by design.

- Runtime: a static Vite + React SPA. All state is in the browser (`localStorage`).
  No backend, no auth, no cloud services of any kind.
- Deploy target: **Vercel** (static build in `dist/`). It also runs on any static host.
- The only external service anywhere is the LLM used **offline at authoring time** by
  Taskmaster (see below), which talks to your **OpenCode Go** subscription.

A repo-wide check for `google|firebase|gemini|gcloud|firestore` returns nothing outside
`node_modules`.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

```bash
npm run build        # tsc -b && vite build  ->  dist/
npm run preview      # serve the production build
npm test             # Vitest: derivation + store behaviour
npm run lint         # oxlint
```

### Deep links (addressable views)

One graph, addressable boards:

```
/?board=b-bravo                       # Team Bravo — Flow (L3), with boundary pins
/?board=b-core-epics                  # Core Experience — Epics (L2)
/?board=b-portfolio                   # Portfolio (L1)
/?board=b-core-flow&item=st-signup-form
```

## The demo guide

The floating **Guide** panel walks the six behaviours. In short:

| # | What to do | What it proves |
|---|---|---|
| 1 | Open "New signup flow", flip resolution L1→L2→L3 | One identity, three renderings |
| 2 | Add a child to a story; watch its level change in the panel | Level is computed, not a field |
| 3 | Set the "API decision" epic to **Done** | Dependency state self-cleans |
| 4 | Open "Build signup form"; it serves 2 objectives | Attribution never inflates WIP |
| 5 | On the Epics board hit **+ Epic** | Soft-block demands a recorded reason |
| 6 | Open the Portfolio board | Computed status + sponsor recommendation, human-confirmed |

## Architecture

```
src/
  domain/
    types.ts        # nodes + typed edges; NO board field on Item
    lifecycles.ts   # L1 initiative / L2 epic / L3 story column sets
    derive.ts       # level, dependencyState, portfolioStatus, limits, pressure
    board.ts        # board = scope ∩ resolution; rows, boundary pins, refs
    seed.ts         # the demo enterprise (one graph)
  store.ts          # zustand + localStorage; limit-aware, audited actions
  components/        # TopBar, BoardView, Card, BoundaryPin, ItemPanel, ...
  lib/               # class utils, colour maps
```

The board is a projection: `scope ∩ { items where level(item) == resolution }`. Scope
and resolution are independent. Attribution edges are excluded from every WIP and
composition-pressure count. Limit policies are keyed on
`(resolution, itemType, scope, column)` and default to **soft-block with a required
reason**.

## Taskmaster (authoring workflow)

Task generation uses [Task Master](https://github.com/eyaltoledano/claude-task-master)
driven by the **OpenCode Go** subscription — not Google.

OpenCode Go's gateway requires an `x-opencode-session` routing header that off-the-shelf
OpenAI-compatible clients don't send, so a tiny zero-dependency reverse proxy injects it:

```bash
npm run taskmaster:proxy      # http://127.0.0.1:8788  ->  https://opencode.ai/zen/go/v1   (run in one terminal)
task-master list              # ...then use Taskmaster as normal (in another)
task-master parse-prd .taskmaster/docs/prd.md
```

Setup notes:

- `OPENAI_COMPATIBLE_API_KEY` lives in `.env` (gitignored; see `.env.example`). It is
  your OpenCode Go key. Models are configured in `.taskmaster/config.json`
  (`deepseek-v4-pro` main, `deepseek-v4-flash` research, `glm-5.3` fallback).
- `.taskmaster/docs/prd.md` is the scoped MVP PRD; `flowline-mvp-prd.md` is the full
  north-star PRD.

## Out of scope for this MVP

Backend services, auth, real-time sync, integrations, org charts, custom entity types,
generic relations, time-boxes, CFD/Monte-Carlo, burndowns, capacity planning.
