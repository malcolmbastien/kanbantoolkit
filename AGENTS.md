# AGENTS.md — Flowline

## Hard rule: no Firebase, no Google tracking

Firebase and Google's tracking and cloud-AI services stay out of this project — runtime, build or
tooling. **Not allowed:** Firebase or Firestore; Google Analytics, Tag Manager, or any other Google
tracking or ads tag; Google Cloud (`gcloud`) and Vertex; Gemini and `gemini-cli`. Google Fonts
stays out too — the app sets its type with its own stack, so a third-party font host buys it
nothing.

**Allowed, because it serves the end user and nothing else leans on it:** **Google Sign-In**, as
*one* way in and never the only one. Someone without a Google account must be able to use the app,
so a second provider — Microsoft — stands beside it, and no account is required to be a Google one.
Both OAuth clients are optional in development too: the app must run with them unset.

Federating with a *customer's* identity provider (even a Google Workspace one) is a deliberate
enterprise decision, and not something this rule forbids by itself.

The app is a static Vite + React SPA deployed to Cloudflare Workers (assets in `dist/`, configured by `wrangler.jsonc`); all state lives in `localStorage`.

Before finishing any task, run:

```bash
npm run scan      # scripts/scan-deps.sh — the same command CI runs
```

It must pass. A bare `google` is no longer a violation, which is why the scan names the forbidden
things instead. (`README.md`, `AGENTS.md`, the script itself and the task backlog quote the rule by
name; `docs/` may name the allowed services — a user-facing "Sign in with Google" is legitimate —
but the app itself never names a forbidden one.)

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
- **A parent is set by dropping, and the rule is the model's.** A **card** dragged onto an
  initiative card becomes its child — a hierarchy edit rather than a move: the card stays in its own
  lane. An **initiative** dragged onto another is a *move*, not a hierarchy edit: dragging one
  initiative onto another means "put it with that one", so it lands in that cell, and its parent is
  set from its own panel or the card menu.
  The target is resolved from the **rectangles** of the initiative cards (`parentTargetUnder`),
  because a card is `pointer-events-none` while one is in the air, which is what lets the lane
  beneath it answer. `canSetParent` is the one rule — the parent must be an initiative, and an item
  is never its own ancestor — and it is read by both the store and the preview, so a target that
  lights up is a target the drop accepts. `setParent` refuses *before* dropping the old parent, so
  asking for something impossible cannot quietly detach the item instead, and it writes the change
  to the item's log. The bulk bar's **Roll up to** is the same act for a whole selection, in one
  write (`setParents`): the same rule is judged for every item *before* anything is written, so a
  selection that would cycle refuses as a whole rather than half-applying, and it offers only the
  candidates it would accept — a target that is listed is a target the operation takes.
- **Hierarchy is generic and structural.** A card has at most one parent (`setParent`
  enforces it). `depth` is derived — never add a `level` field.
- **An item's identity is its `id`, and that is the app's own business.** Edges, placements, the
  log and the URL all point at it; no surface prints it. There is no derived *display reference*:
  a `USER6` numbered from an item's position changes when a card is added or a type changes, so it
  is a name that lies about being one — the words on the card are what a person reads and searches
  by.
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
  `backlog`. A Backlog leaf does **not** drag its parent's *status* backwards — a partly-planned
  initiative is still in progress — but it does count in `Rollup.percent`, which is the size of
  the delivered leaves over the size of **all** the leaves below an item, unsized counting as 1.
  Unplanned work is work, so adding it moves the number back; the counts stay counts, beside it.
  The inconsistency is surfaced, not enforced: when a committed item (Not Started / In Progress)
  sits over Backlog leaves, `uncommittedBelow` raises a **warning** on the card. Never a block,
  never an auto-correction.
- **An initiative has no estimate.** Its size is the sum of the sizes of the items below it, and
  the field is refused for one the way a kind is refused for a card — a card keeps its estimate.
  The health rules that read an initiative's own numbers therefore lose their input: the size
  warning is gone, the date warning (`outlasted`) stays.
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
- **A key result is a statement, not a measurement.** It is an id, an objective and a line of
  text — what the objective means, in the words of the people who set it — and nothing else. A
  number entered by hand cannot be connected to the work, so it can disagree with the work and no
  test can find the disagreement. **An objective's completeness comes from the work that serves
  it**: `objectiveRollup` returns the same `Rollup` an item gets, over the union of the leaves
  below the initiatives attributed to the objective — each leaf once, however many attributed
  initiatives sit above it. An objective nothing serves has **no** rollup (`undefined`), not 0%:
  the coverage gap says that in words. The `score` is a different thing and stays — the grade a
  person gives at the end of a period.
- Limits are per-lane `wipLimit`s, and a board's `wipEnforcement` says what they do: **visualize**
  (the default) tints a lane at or over its limit and lets moves through, **justify** holds a move
  that would breach until a reason is given — recorded on the card — and **block** refuses it. The
  rule lives in `moveCard` alone, the one seam every path into a lane goes through, and it
  **answers** whether the card is now in the lane, because a drop is a move *and* a position: the
  caller writes the position only when the answer is yes, or it lands the card the policy just
  stopped. A held move carries the place the gesture offered, so answering lands the card where it
  was dropped rather than at the end. WIP is the cards workflow's own — an initiatives lane neither
  shows a limit nor enforces one. Counts read the **column**, not the view: narrowing what you
  *see* (search, filters, focus) never changes the load a column carries.
- **An error report is about the code, never the workspace.** `POST /api/errors` accepts a
  message, a stack, the path, the view, the build and the browser — not a place's query, which is
  where board and item ids live. Reporting is silent in development, capped per page, and the
  endpoint answers `503` rather than failing when its database is not configured.
- Before finishing any task, run `npm run scan` and `npm test`.

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
