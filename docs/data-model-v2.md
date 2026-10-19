# Flowline — generic model (v2)

> Supersedes the fixed `initiative > epic > story` hierarchy. Types are user-defined
> labels; the hierarchy is structural (parent/child); a card's board and cell are explicit
> **placement** records; board columns are a **recursive LeanKit lane tree** — any cell can
> be split into columns or rows, locally.

## Entities

```
IssueType  { id, name, color }                              # custom, editable in-app
Board      { id, name }
Lane       { id, boardId, parentId, order, name,            # recursive tree
             orientation?, stage?, wipLimit? }              # stage lives on top-level columns
Item       { id, title, typeId, size?, assignee?, ... }     # no board/state/level field
Edge       { decomposition | dependency | attribution }
Placement  { id, boardId, itemId, laneId }                  # the card's board + cell
```

## Rules

- **One parent, many children.** `setParent` replaces any existing parent, so a card has at
  most one.
- **Lanes are a recursive tree.**
  - A lane with **no children is a leaf: a cell**. Placements reference leaf lanes.
  - A lane with children is a **container**; `orientation` says how children are arranged:
    `columns` (side by side) or `rows` (stacked).
  - Any **leaf can be split** into a container of either orientation (its cards move into
    the first sub-lane); containers can gain **added** sub-lanes. Because splits are local,
    the grid is **non-uniform** — exactly LeanKit.
  - **All design actions live behind edit mode** so the working board stays clean.
- **Types are labels.** Columns come from the board's lane tree, not the type.
- **Derived facts (not stored):**
  - `depth(item)` = distance from a root via decomposition — replaces the old level.
  - `statusOf(item)` = the `stage` of the top-level column the card's cell sits under
    (sub-lanes inherit it); dependency state is arithmetic over two cells.
  - attribution never counts as work.
- **Placement is explicit but many-to-many.** One placement record per board, so an item
  can sit on several boards with one identity.
- **WIP limits** are per-lane `wipLimit`s, and a board's `wipEnforcement` decides what they do:
  `visualize` tints a lane at or over its limit and lets moves through, `justify` holds a move
  until a reason is given, `block` refuses it. The rule lives in `moveCard`, which answers
  whether the move happened.

## What changed from v1

| v1 | v2 |
|---|---|
| `Item.type` (initiative/epic/story/defect) | `Item.typeId` → custom `IssueType` |
| resolution L1/L2/L3 + derived level | removed; `depth` is the structural fact |
| `Board.resolution` + `scopeId` | `Board` owns a recursive lane tree |
| scope ∩ level == resolution | `Placement` records (one per board) |
| lifecycles keyed by resolution | top-level columns carry the `stage`; sub-lanes inherit |
| `LimitPolicy` | `Lane.wipLimit` |
