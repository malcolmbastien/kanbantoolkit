# Flowline — Feature backlog (post-foundation)

> MVP usability + OKR/rollup work. Excludes permissions, auth and user management.
> The foundation (boards, typed lanes, Initiatives & Cards workflows, edit mode,
> rollup, management bands, lens, drag-and-drop, issue types, dependencies,
> attribution, WIP visuals, persistence, error boundary) is already built.
>
> **Priority: build Objectives & Key Results (topic 4) FIRST** — before usability —
> to establish how work connects and maps from team-level tasks up to
> organizational priorities (OKRs), including top-level initiatives rolling up
> across management boards.

Priorities: P0 = needed for a usable MVP; P1 = next; P2 = later.

## 1. Card & item usability
- P0 Full card editor: description (markdown), assignee, size, title, type in the side panel.
- P0 Delete / archive items, with rules for handling their children.
- P1 Quick-add & paste-many: paste a list into a lane to create multiple cards.
- P2 Checklists inside a card (finer than schedulable work is a checklist).
- P2 Comments / activity log per item.
- P2 Multi-select and bulk actions (move, retype, assign, delete).

## 2. Board & lane layout (edit mode)
- P0 Drag to reorder lanes and drag to resize lanes; persist sizes.
- P0 Inline rename and confirm-before-delete (replace window.prompt).
- P1 Lane settings popover: name, WIP, stage, colour, merge/delete.
- P1 Collapse/expand lanes and management bands, remembering state.
- P1 Board settings & templates: level, rollup toggle, new-team-board wizard, duplicate board.

## 3. Coordination — dependencies
- Dependency links are intentionally simple: **"A depends on B"** — no FS/SS/FF, lag, or pinning.
- The dependent raises a link; the other card confirms or rejects it (with a reason) in the item panel.
- Dependency state is derived from both endpoints: planning risk / live blockage / satisfied / closed.
- A card shows how many others depend on it ("N depend on this").

## 4. Objectives, limits & rollup — BUILD FIRST
- P0 Objectives & Key Results view: periods, commitment limits (3–5 objectives), score, and the work attributed to each objective.
- P0 Key Results: add/edit/score KRs under an objective.
- P0 Map work to objectives: attach initiatives (and cards) to objectives via attribution; show coverage and the rollup status/% of attributed work without inflating WIP.
- P0 Cross-board initiative rollup: a top-level initiative on one management board can roll up to a top-level initiative on another management board. A management board's Initiatives workflow shows its board-local top-level initiatives (an initiative whose parent is not on the same board is top-level there).
- P1 Attribution UX: attach initiatives to objectives, coverage/impact reporting.
- P1 Limits editor with configurable enforcement (visualize/warn/soft-block/hard-block), thresholds and effective dates; soft-block reason off by default.
- P1 Management board dashboard: a summary view of a board's initiatives with work progress, target date, status, and an indicator of blocked work down the chain.
- P2 Initiative health / at-risk flags beyond percent complete.

## 5. Navigation, search & filters
- P0 Global search across items in all boards, with jump-to.
- P1 Board filters/presets: by assignee, type, blocked, initiative; savable.
- P1 Lineage breadcrumb and "show on other boards" in the item panel.
- P2 Command palette / quick board switcher.

## 6. Data, safety & trust
- P0 Undo/redo (undo last change or action history).
- P0 Export and import workspace JSON.
- P1 Toasts / action feedback for move, confirm, save/cancel.

## 7. Polish, performance & reach
- P1 Empty states and contextual hints.
- P2 Virtualize large columns/boards.
- P2 Touch and responsive layout; touch drag.
- P2 Keyboard and accessibility pass.

## Objectives & KR model (for topic 4)

- `Objective { id, title, description?, period, status: active|scored, score? }`.
- `KeyResult { id, objectiveId, title, target?, current?, progress? }`.
- Objectives and KRs are commitment-limited entities — never in columns. A period
  has a commitment limit (default 3–5 objectives).
- Work maps to objectives through attribution edges (many-to-many), which never
  count as WIP. An objective's displayed work is the rollup of its attributed
  initiatives.
- Initiatives form one decomposition tree across boards, so a team's tasks roll up
  through team initiatives to a management initiative, and where required up to
  another management board's top-level initiative.
