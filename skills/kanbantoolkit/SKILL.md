---
name: kanbantoolkit
description: Work a Kanban Toolkit board through its MCP server or /api/v1 — read the work, move it, file it, and report back on a card. Use when the task names a Kanban Toolkit instance or a card on one.
---

# Kanban Toolkit, for an agent

A Kanban Toolkit instance is **one workspace**, which is one team. Its boards hold **cards** (the
team's work) and **initiatives** (the outcomes the cards roll up to). A card sits in exactly one
**cell** — a leaf of a board's column tree — and its status is the stage of the column above that
cell. A board carries one **initiatives flow** (sections, and the cells initiatives are arranged in)
and one or more **cards flows** (the team's own columns, each with its own WIP limits).

Everything you can do, a person can do at the board, and the same rules decide both. You act as the
token's owner, within that person's role and the token's scopes. Your writes are recorded in the
card's history and the instance's audit trail, and the history names the token: a note that came
through `CI bot` says so.

## The doors

- **MCP** — the tools below, over Streamable HTTP (`POST /mcp`) or the stdio bridge. Prefer this.
- **REST** — `/api/v1` answers the same operations as JSON. `/openapi.json` is the schema.
- Both take `Authorization: Bearer ktk_…`. A session cookie is not a credential here.

Reads are paged (50 by default, 200 at most): pass `nextCursor` back to continue. A write that
changes a card's **fields** must send the `baseRev` you read; a stale one is refused with the
current item, so read it again and decide. A **move** and a **note** take no revision: they are
appends, and someone else's edit must not block them.

## Read first

1. `list_boards` — what exists, and which boards are archived or read-only.
2. `workspace_summary` — counts, the board list, and the columns of the first team board.
3. `get_board` — one board's columns, cells and items. The `laneId` values a move needs come from
   here; a cell is a leaf, and an initiative goes in an initiatives cell.
4. `search_items` — a plain substring over titles. It returns ids.
5. `get_item` — one item with its `rev`, parent, placements, rollup and history.
6. Only now: `create_item`, `update_item`, `move_item`, `set_parent`, `add_note`.

Never invent an id, a lane or a person. If you do not know it, read it.

## The rules that will refuse you

- **An initiative has no estimate and no size.** Its size is the work below it, and `size` is not a
  field any more — a board counts issues. Sending one is a `422`, not a silent drop.
- **A card has a type; an initiative's type is fixed.** The Initiative and Sub-task types are the
  system's: an item is never retyped into or out of them.
- **A parent must be an initiative, an item has at most one, and nothing is its own ancestor.**
  `set_parent` refuses a cycle rather than half-applying it.
- **An initiative's section is derived** from the work below it (all done → Done; anything under
  way → In Progress; anything committed → Not Started; none committed → Backlog). A move rearranges
  a cell inside that section and cannot cross it.
- **WIP is per lane, and per board policy.** `visualize` lets a move through, `justify` refuses with
  `reason_required` until you repeat the move with a reason, `block` refuses outright
  (`wip_blocked`). The reason, once accepted, is recorded on the card.
- **A due date is a promise; the target start/end is the plan.** `dueDate` is one ISO day and is
  what "overdue" means. `targetStartDate`/`targetEndDate` are the window a dashboard reads. They are
  separate fields; do not use one for the other.
- **A dependency is a link across the hierarchy**, never along it: not a parent or a descendant of
  the item, and never a loop.

## Refusals are answers

A refused call is a result with `isError: true`, a sentence a person can read, and a stable code in
`structuredContent.error`:

| Code | Means | Do |
| --- | --- | --- |
| `wip_blocked` | the lane is full and the board will not let work over | move elsewhere, or ask a person to free space |
| `reason_required` | the lane needs a reason (a `justify` policy) | repeat the move with `reason` |
| `section_fixed` | an initiative cannot leave its derived section | rearrange inside the section, or change the work below |
| `parent_invalid` | not an initiative, or a cycle | choose a different initiative |
| `stale` | a `baseRev` moved | read the item again and rebase |
| `role_forbidden` / `scope_required` | the person's role, or the token, does not allow it | stop; ask a person, do not retry |

## What not to do

- Do not invent work, history or results. **No tool generates cards** and there is no bulk write, no
  `force`, and no filter language: a batch of twenty cards is twenty calls, each accepted or refused
  on its own.
- Do not retype an initiative, move one across its section, or set a parent that is not an
  initiative; the rules exist so a reader can trust the board.
- Do not report back by editing a card's fields. Use `add_note` — it changes nothing but the
  history, and a Viewer's token can do it.
- Do not assume a token can do what its owner can: a token is capped by its scopes **and** the role.

## Reporting back

`add_note` is how you write to a person: what you did, what you found, what you need. A note takes no
revision, appears in the card's Activity, and its mentions (`@Name`) reach the person it names. The
card's history will say the note came through your token, so say who you are in the sentence if it
helps.

## More

- `docs/mcp.md` — connecting, the tools, the refusal table.
- `docs/rest-api.md` — the REST contract and what `v1` promises.
- `docs/webhooks.md` — the events an instance sends (not something you call; a receiver's side).
