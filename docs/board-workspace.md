# Flowline — board workspace (plan)

> A place to see the organisation's boards. Today the only way to reach a board is the
> TopBar picker, and board-level admin is scattered between the TopBar (create / delete, in
> edit mode) and Board settings (band, card types, WIP, linked boards). With bands and a
> multi-parent aggregation graph, *"what boards do we have, and how do they relate?"* has
> no answer anywhere in the UI.

Status: **plan — not built.** Open questions at the end.

## Why

- **There is no index.** The picker is a switcher: it lists boards but tells you nothing
  about them, and you can only see it by opening it.
- **Admin is scattered.** Creating and deleting boards lives in the TopBar's edit mode;
  band, card types, WIP enforcement and aggregation edges live in Board settings. Both are
  reached from a board you already had to find.
- **The graph is invisible.** Bands are lenses over an acyclic aggregation DAG. Nothing
  shows which team boards feed which programs, or which boards are unlinked.
- **Orphans go unnoticed.** A team board no coordination board links, or a program with
  nothing linked to it, is a real configuration gap with no surface.

## What it is

A top-level view — the **Boards** workspace — listing every board in the organisation.
**Browsing first, management second**: the point is to see the shape of the org, and only
then to act on it.

## Where it lives

- A TopBar toggle beside **Objectives** / **Archive**, so it is reachable from anywhere.
- The board picker's footer gets a **Manage boards…** entry, so the switcher leads to the
  index rather than being a dead end.

## The shape of the list

**Grouped by band (Portfolio → Program → Team), then by name. Each board appears once.**

The aggregation graph is a **DAG**, not a tree: a team board can be linked by two programs
(`Team Atlas` is linked by both `Growth value stream` and `Product Delivery`). A tree would
have to either duplicate the row or pick one parent and quietly lie. So a row **names its
parents** instead of nesting under one — the same conclusion the board picker reached.

```
[PORTFOLIO]  Company Strategy            3 initiatives
             rolls up to  —                        aggregates  Digital line of business · Product Delivery

[PROGRAM]    Growth value stream         2 initiatives
             rolls up to  Digital line of business  aggregates  Team Atlas · Team Nova

[TEAM]       Team Atlas                  1 initiative
             rolls up to  Growth value stream · Product Delivery
```

(Figures above are the seeded org, to show the shape.)

## What each row carries

- **band badge** and name — the same visual language as everywhere else.
- **its own initiatives**, counted the way the board itself counts them.
- **rolls up to** (parent boards) and **aggregates** (linked boards) — as text, because the
  graph is not a tree.
- **what the headline actually is** is an open question (see below): a rolled-up percentage
  is the obvious choice but needs defining for a board that holds initiatives at several
  levels, and it is the expensive part to compute for every board at once.
- a marker when a lane is **at or over its WIP limit** — a board-level "needs attention".

## Gaps the workspace should surface

Gaps are first-class elsewhere in the app (`okrCoverage`, `uncommittedBelow`); the board
graph deserves the same treatment. Worth flagging inline:

- a board with **no initiatives** — nothing is being tracked on it;
- a **program or portfolio with nothing linked** — it aggregates nothing;
- a **team board no coordination board links** — it is an orphan in the graph.

## Actions

| Action | Notes |
|---|---|
| **Open** | switches to the board (the row's primary action) |
| **New board** | name + band, from the workspace header |
| **Rename / change band** | band is currently Board settings only |
| **Link / unlink** | the aggregation edges — currently Board settings only |
| **Board settings** | opens the existing per-board dialog |
| **Delete** | routed through the confirm dialog |

## Where today's controls would move

- The TopBar's edit-mode **Board +** and **delete** are board admin reached from inside a
  board. Moving them here gives board admin one home.
- **Board settings stays per-board** — it is board-scoped config, and the workspace links
  to it rather than absorbing it.

## Relation to the existing surfaces

| Surface | Scope |
|---|---|
| Board picker (TopBar) | *switch to* a board — a shortcut |
| **Board workspace** (new) | *the organisation's* boards — browse + admin |
| Board settings (per board) | one board's configuration |
| Strategy map (portfolio board) | one portfolio's OKRs ↔ strategic initiatives |

## First slice

Enough to be useful and to prove the shape:

1. TopBar **Boards** toggle opening the workspace.
2. The grouped list: band badge, name, initiatives count + rolled-up %, and the
   rolls-up-to / aggregates text.
3. **Open** a board from a row.
4. **New board** (name + band) in the workspace header.

Rename, band changes, linking and delete follow once the list itself feels right.

## Out of scope

- Templates, the new-team-board wizard, and duplicate board — **task 21**.
- Moving work between boards — **task 42**.

## Open questions

1. **Replace or sit alongside?** Does the workspace take over the TopBar's edit-mode board
   controls, or do both stay? (One home is cleaner; a quick-create in the nav is handy.)
2. **What is a board's headline?** Initiative count is cheap and honest. A rolled-up
   percentage needs defining (across its own initiatives? across all its work?) and means
   `rollupOf` per initiative per board on one page — is that acceptable at org scale, or
   should rows show counts and compute progress lazily?
3. **Text or picture?** Rows naming their parents (recommended) versus a small DAG diagram.
   A tree is out — the graph is not one.
4. **Search / filter?** Worth it only past a certain board count; not in the first slice.
5. **Does duplicate board belong here** (task 21), or stay a board-settings action?
