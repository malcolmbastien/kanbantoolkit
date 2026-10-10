# Flowline — generic model (v2)

> Supersedes the fixed `initiative > epic > story` hierarchy. Types are now
> user-defined labels; the hierarchy is purely structural (parent/child); a card's
> board and cell are explicit **placement** records; board columns are a **LeanKit-style
> lane tree** that can be split on both axes.

## Entities

```
IssueType  { id, name, color }                              # custom, editable in-app
Board      { id, name }                                     # container with its own lane grid
Lane       { id, boardId, axis, parentId, name, order,      # axis: vertical (columns) | horizontal (rows)
             wipLimit?, isStart?, isDone?, isCancelled? }
Item       { id, title, typeId, size?, assignee?, ... }     # no board/state/level field
Edge       { decomposition | dependency | attribution }
Placement  { id, boardId, itemId, columnLaneId, rowLaneId? }# the card's board + cell
```

## Rules

- **One parent, many children.** `decomposition` edges; `setParent` replaces any
  existing parent, so a card has at most one.
- **Lanes are a tree.** Any lane can be split into ordered sub-lanes. Vertical splits
  create sub-columns, horizontal splits create sub-rows. A **cell** is the intersection
  of a leaf column and a leaf row.
- **Types are labels.** Columns come from the board's lane tree, not the type. A type
  carries colour (and, later, a default).
- **Derived facts (not stored):**
  - `depth(item)` = distance from a root via decomposition — replaces the old level.
  - dependency state = arithmetic over both endpoints' lane semantics.
  - attribution never counts as work.
- **Placement is explicit but many-to-many.** One placement record per board, so an item
  can sit on several boards with one identity.

## What changed from v1

| v1 | v2 |
|---|---|
| `Item.type` (initiative/epic/story/defect) | `Item.typeId` → custom `IssueType` |
| resolution L1/L2/L3 + derived level | removed; `depth` is the structural fact |
| `Board.resolution` + `scopeId` | `Board` owns a lane tree |
| scope ∩ level == resolution | `Placement` records |
| lifecycles keyed by resolution | columns = leaf vertical lanes (with start/done flags) |
| `LimitPolicy` | `Lane.wipLimit` |
