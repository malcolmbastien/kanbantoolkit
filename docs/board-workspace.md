# Flowline — board workspace (plan)

> A place to search, browse, create, archive and delete the organisation's boards, and to
> manage the templates they are created from. Board admin also stays inside each board —
> this is **another way in, not the only one**. Today the only way to reach a board is the
> TopBar picker, which is a switcher with nothing to browse.

Status: **plan — not built.** Decisions taken so far and open questions at the end.

## Why

- **There is no index.** The picker lists boards but tells you nothing, and you can only see
  it by opening it. There is nowhere to look at the org's boards.
- **Creating a board is buried.** `New board` lives in the TopBar behind edit mode, and
  every new board starts as the same four typed columns — there is no way to reuse a board
  design you have already settled on.
- **Boards cannot be retired.** Deleting is permanent and is the only way to get a board out
  of the picker. Items learned this lesson already: task 12 added archiving so Done work
  leaves the board without being destroyed. Boards have no equivalent.

## What it is

A top-level **Boards** workspace:

| | |
|---|---|
| **Search** | by board name |
| **Browse** | every board, grouped by band |
| **Create** | name + band, optionally from a template |
| **Archive** | retire a board without destroying it |
| **Delete** | permanent, behind the confirm dialog |
| **Templates** | save a board's design as a template; rename and remove templates |

Board admin **also remains inside each board** (the TopBar's create/delete, Board settings'
band and linked boards). The workspace duplicates the entry points rather than moving them.

## Where it lives

- A TopBar toggle beside **Objectives** / **Archive**.
- The board picker's footer gets a **Manage boards…** entry, so the switcher is not a dead
  end.

## Browsing

Rows **grouped by band** (Portfolio → Program → Team), then by name. Each board appears
**once**, and for now a row carries only:

```
[PORTFOLIO]  Company Strategy
[PROGRAM]    Growth value stream
[PROGRAM]    Product Delivery
[TEAM]       Team Atlas
[TEAM]       Team Nova
```

- **Name + band badge only**, for now — no counts, no progress.
- A **search** field filters by name.
- A toggle to **include archived boards** (hidden by default).
- Opening a row switches to that board.

*Not a tree:* the aggregation graph is a **DAG** — a team board can be linked by two
programs — so nesting would either duplicate rows or pick one parent and lie. The same
conclusion the board picker reached. If the graph is shown here later, rows should name
their parents.

## Creating

- **New board**: name + band, and optionally a **template** to start from.
- The built-in standard (the four typed columns, Backlog → Done) is the default, so the
  current behaviour is what you get when you pick nothing.

## Archiving boards — new model work

Mirrors item archiving (task 12), because the reasoning is identical: retiring something
should not destroy it.

- Add `Board.archived` (with `archivedAt`), plus `archived` / `unarchived` board events if
  we want the log.
- An archived board is **hidden from the board picker, the workspace's default list, and
  the aggregation bands** — a retired program stops collecting rollups.
- It stays **openable by deep link** and its **items and placements are untouched**.
- Persist version bump + migration (the project's convention whenever the persisted shape
  changes).
- **Open:** do archived boards keep their aggregation edges, or are the edges suspended
  while archived? Suspending is tidier; keeping them means unarchiving restores the graph
  exactly.

## Templates — new model work

A template is a **board design, not its work**:

```
BoardTemplate { id, name, band, lanes, cardTypeIds?, defaultCardTypeId?, wipEnforcement? }
```

- `lanes` is the board's lane tree — names, orientation, `stage`, `wipLimit` — with fresh
  ids minted on instantiation. **No items, no placements, no linked boards** (those are
  org-specific).
- Managed in the workspace: **save an existing board as a template**, rename, remove.
- Used when creating a board.
- Persist version bump + migration (a new persisted collection).

## Deleting

Reuse `removeBoard` + the confirm dialog. Unchanged, just reachable from here too.

## Later — not in the first slice

- A per-board **headline** beyond name + band: initiative count, stage spread, or a
  rolled-up percentage (which needs defining, and is the expensive part to compute for
  every board at once).
- **Graph gaps inline**: a board with no initiatives, a program/portfolio with nothing
  linked, a team board no coordination board links.
- **Rename / change band** and **link / unlink** from the workspace.

## Out of scope

- The new-team-board **wizard** and **duplicate board** — still **task 21**. The *templates*
  half of that task now lives here.

## First slice

1. TopBar **Boards** toggle opening the workspace.
2. The grouped list: **name + band badge**, with search.
3. **Open** a board from a row.
4. **New board**: name + band.

Then, in order: archiving (model + migration), then templates.

## Open questions

1. **Archived boards and the graph** — suspend the aggregation edges while archived, or keep
   them and rely on the archived board being filtered out of every band?
2. **Can you open an archived board?** Read-only, or fully usable? (Items stay archived-able
   either way.)
3. **Template fidelity** — is `lanes` + card types + WIP enough, or do templates need to
   carry more of Board settings?
4. **Where does the template library live** — inside the workspace only, or also reachable
   from Board settings ("save as template" while you are configuring a board)?
5. **Does the workspace need filters** beyond search (band, has-initiatives, unlinked)? Not
   in the first slice.
