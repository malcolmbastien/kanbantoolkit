# Kanban Toolkit — collaboration

> Design, not code. One person holds a card's pen at a time: how that is scoped, arbitrated and made
> safe when a lease lapses, and what the app must do before any of it is built.

**Status:** partly built. The lease, its heartbeat and the revision check are in the code
(`server/workspace/locks.ts`, `src/lib/lease.ts`, and the `/items/:id/lock` routes), and an instance uses
them. This page is still the design record for the rest, including the takeover notices and field-level
presence in Stage 3.

## The requirement

Two people must not edit the same card's content at once. One holds it; the other sees who, and can
still read the card and move it around the board. The pen is taken when the **drawer opens**, not at
the first keystroke.

## What counts as editing

| Write | Examples | Governed by the lock |
| --- | --- | --- |
| **Content** | title, description, type, priority, tags, people, dates, checklist, kind | **Yes** |
| **Relationships** | parent, dependencies, attribution | **Yes** |
| **Arrangement** | moving it between lanes, reordering it within a lane | **No** |

An **agent** is a writer too. Its token has no tab to hold a lease with, so any live lease is somebody
else's pen: `/api/v1` and `/mcp` refuse content, block and relationship writes with `423 locked` while a
person has the card open, and name them. A move is arrangement and stays allowed, and a note is an
append — an agent reporting back is never blocked by somebody reading.

A `Placement` is its own record, written to the item's log by `moveCard`/`moveCardToIndex`, and
reversible. Board moves stay last-write-wins, and a card someone else is editing can
still be dragged.

## The lease

A lock held by a browser that vanishes — closed laptop, dead wifi, crashed tab — strands the card, so
the lock is a **lease**: short life, renewed while someone is there.

| Fact | Value | Why |
| --- | --- | --- |
| TTL | 60 s (`LEASE_MS`) | Survives a slow heartbeat; a vanished holder costs nothing |
| Heartbeat | every 15 s (`HEARTBEAT_MS`) | Renewed while the drawer is open and the tab is visible |
| Acquired on | **opening the card** | A card somebody has open is locked to everybody else: reading a card is a request to work on it |
| Released on | drawer close, `pagehide` | Best effort; the TTL covers what those miss |
| Taken over on | expiry | Automatic, for whoever touches it next. No manual "steal" button in v1 |
| Keyed by | user **and session** | One person in two tabs is told "you have this open in another tab", not blocked by themselves |

The lease is renewed for as long as the drawer is open, so a card left open stays locked until the
person closes it or navigates away; a closed laptop frees the card within a minute. A lapsed lease is
taken again by the open drawer itself, and again on the next edit intent, so a night offline does
not leave a card editable without a pen.

`ItemPanel` asks for the pen when it opens the card and lets go when it closes. The edit-intent
handlers (focus into a field, and the press that leads there) are the retry after a lapse, not the
acquisition. A Viewer's drawer and an archived card take nothing: neither may write, and a reader
must never lock an author out.

## The revision is the guarantee

A lease can lapse mid-sentence: A's TTL expires while they are typing, B takes the pen, A's next
keystroke arrives. The lock makes that rare. What makes a lost update impossible is a **per-item
revision**: every write carries the `rev` it was based on, and a stale write is refused rather than
applied.

That matters more than usual here because **the app has no Save button** — every keystroke is a
write.

- **Coalesce.** Over a network, writes are grouped per editing gesture and flushed on blur, close
  or ~500 ms of idle. The lease must outlive the flush.
- **Refuse instead of merge.** A stale write (409) freezes further writes and names who changed
  what. The field keeps the local text and offers to copy it or reload the card.
- **Never queue a refusal.** An offline edit may be queued only if it was accepted. An edit refused
  for a lock is dropped, not replayed after the lock is gone.

## Identity

Locks are keyed by the **server's** identity, never a name the client supplies. Today's `meUserId`
is a pointer into the local users directory — good for "whose browser this is", not an authority.
Accounts arrive with Stage 2, and the lock row carries both the user and the session.

Log entries gain an optional `by` as part of the groundwork: the conflict message needs the name, and
that field is also the audit trail.

## Data model

One row per held card; `item_id` is the primary key, so two holders cannot both be right.

```
Lock { itemId, userId, sessionId, holderName, acquiredAt, expiresAt }
```

Acquire is a single conditional write — `… WHERE expires_at < now()` — so the store settles the race,
not the client. In Postgres that is one `INSERT … ON CONFLICT … DO UPDATE … WHERE` statement; behind
a Durable Object it is a single-threaded compare-and-set. Locks are **never** persisted in
`kanbantoolkit-state-v3`: they are session state, like selection and filters.

## Protocol

```
POST   /items/:id/lock       → 200 { lock } | 423 { holder }
POST   /items/:id/heartbeat  → 200 | 409 { holder }
DELETE /items/:id/lock       → 204
PATCH  /items/:id            { rev, patch } → 200 { rev } | 409 { rev, by } | 423 { holder }
WS     /workspace            presence, lock.acquired, lock.released, item.changed, placement.changed
```

`423 Locked` for "someone else holds it"; `409 Conflict` for "it changed while you were editing".
The two are different sentences in the UI and stay different on the wire.

## Client state

A `presence` slice, beside the other view state and excluded from `persistedSlice`:

```
presence {
  connected: boolean
  locks: Record<itemId, Lock>       // who holds what, from the server
  lastSeen: Record<userId, number>  // for the "editing" mark on the board
}
```

The drawer reads `locks[itemId]`: absent or mine → editable; someone else → read-only with a banner
naming them. Opening the card asks for the pen, and a refusal carries the holder's name. A reader's drawer still
updates live as the holder types.

## The UI contract

- **The drawer stays open and readable.** Read-only is a state of the fields, not a closed panel: the
  holder is named at the top, and values keep the shape values wear rather than turning into disabled
  grey boxes.
- **The card says who has the pen**, with a mark that cannot be mistaken for an assignee: an assignee
  avatar means "works on this", the editing mark means "has it open right now".
- **Bulk actions refuse as a whole**, following `setParents`: a selection containing a card someone
  else holds is refused before anything is written, and names the card.
- **A refused write stops the field and explains**, rather than accepting keystrokes into a void.
- **Your own second tab** gets "you have this open in another tab", not a lock-out.

## Failure modes

| Situation | What happens |
| --- | --- |
| Holder closes the tab | `pagehide` releases it; if that is missed, the TTL does |
| Holder leaves the drawer open | The card stays locked while that tab is open; closing the tab or the TTL frees it |
| Holder's wifi dies | The lease lapses within a minute; the next person takes it |
| TTL lapses mid-typing | The next write is refused; the field keeps the text and says who changed it |
| Two people acquire at once | The store settles it; one gets `200`, the other `409` |
| Same person in two tabs | The second is told; the first keeps the pen |
| Bulk action over a held card | Refused as a whole, naming the card |
| Offline | Your own accepted edits queue; an edit refused for a lock is never queued |
| Someone drags a card being edited | Allowed — arrangement is not content; both see the move |

## Groundwork in the app today

Safe to do before accounts exist:

1. **One item-write seam.** Item mutations are spread across roughly twenty store actions and
   twenty-one separate `items: state.items.map` sites. A lock check wants one place to live — the
   shape `moveCard` already gives placements.
2. **`rev` on `Item`** (optional, so no migration): bumped by that seam, and the number a 409 is
   judged against.
3. **`by` on log entries** (optional): authors, for the history and the conflict message.
4. **The AGENTS line** for the scope rule above (content and relationships, never arrangement), so
   the rule outlives the next change to the store.

## Where it lands

Phase 1 of the production plan gains the four groundwork items; **Stage 2** ships the lease, presence
and the revision check alongside accounts and the server-authoritative store, because "who is editing"
needs real identity; **Stage 3** adds the polish — takeover notices, "ask to take over", and
field-level presence.

## Open questions

- Does a relationship edit need the *other* card's lock? **Recommendation:** no. The lock belongs to
  the card whose content changes; an edge is recorded on both logs, but only the edited card's drawer
  is blocked.
- "Ask to take over" — a nudge to the holder, or nothing? Not needed for v1.
- Field-level presence ("Maya is in the description") — pleasant, not required.
- Per-field last-write-wins as an alternative to blocking: rejected, because the product wants one pen
  in a card, and the revision check already prevents silent overwrites.

## Non-goals

- **No CRDT in v1.** The model is discrete fields, not a shared text buffer; the only free text is the
  description, and it is locked rather than merged.
- **No blocking of arrangement.** Board moves stay available to everyone.
- **No offline editing of a card someone else holds**, and no replay of edits that were refused.
