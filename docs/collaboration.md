# Kanban Toolkit — collaboration

> Design, not code. A team tool needs one person to hold a card's pen at a time: this is how that
> is scoped, arbitrated, and made safe when a lease lapses — and what the app must already be able
> to do before any of it is built.

**Status:** design only. Nothing here is implemented, and none of it is needed by the local-first
build. It is the spec for **Stage 2** of the production plan (accounts and a server-authoritative
store); the groundwork it depends on is listed at the end so it can be done early, cheaply, and
without rework.

## The requirement

Two people must not edit the same card's content at once. One holds it; the other sees who, and
can still read the card and move it around the board.

## What counts as editing

| Write | Examples | Governed by the lock |
| --- | --- | --- |
| **Content** | title, description, type, priority, tags, people, dates, checklist, kind | **Yes** |
| **Relationships** | parent, dependencies, attribution | **Yes** — these are facts about the card, whoever edits them and from wherever |
| **Arrangement** | moving it between lanes, reordering it within a lane | **No** |

Arrangement is separate in the model on purpose: a `Placement` is its own record, it is written to
the item's log by `moveCard`/`moveCardToIndex`, and it is reversible. If an open drawer froze a
card's position, one person reading a card during a planning session would stop the whole board
being arranged — and the drawer is the app's *reading* surface, opened by a single click. So board
moves stay last-write-wins, as they are today, and a card someone else is editing can still be
dragged.

The promise is therefore: **one person edits a card's content at a time; anyone can read it and
arrange it.**

## The lease

A lock held by a browser that vanishes — closed laptop, dead wifi, crashed tab — strands the card,
and in a team tool that is worse than the conflict it prevents. So the lock is a **lease** with a
short life, renewed while someone is actually there.

| Fact | Value | Why |
| --- | --- | --- |
| TTL | 45–60 s | Long enough to survive a slow heartbeat, short enough that a vanished holder costs nothing |
| Heartbeat | every ~15 s | Renewed while the drawer is open and the tab is visible |
| Acquired on | the first **edit intent** | Focus into a field, not opening the card: reading stays free and two people can look at the same card |
| Released on | drawer close, blur, `pagehide` | Best effort; the TTL covers what those miss |
| Taken over on | expiry | Automatic, for whoever touches it next. No manual "steal" button in v1 — a steal button is optimistic concurrency with extra steps |
| Keyed by | user **and session** | One person in two tabs must be told "you have this open in another tab", not blocked by themselves |

Renewal stops after a few minutes without an edit, so a drawer left open overnight does not hold a
card forever; when that person comes back and types, the write is refused and the drawer explains
why rather than silently dropping the keystroke.

There is already a hook for the text half of this: `ItemPanel` brackets free-text editing with
`startTextEdit`/`endTextEdit` (focus → one log entry on blur, via `logTextEdit`). That bracket is
the natural acquire/release point for the title and description; the discrete fields write once
per gesture, so they acquire on change.

## The revision is the guarantee

A lease can lapse mid-sentence: A's TTL expires while they are typing, B takes the pen, A's next
keystroke arrives. The lock is the *UX* that makes that rare. The thing that makes a lost update
impossible is a **per-item revision**: every write carries the `rev` it was based on, and a stale
write is refused rather than applied.

That matters more than usual here because **the app has no Save button** — every keystroke is a
write.

- **Coalesce.** Over a network, writes are grouped per editing gesture and flushed on blur, close
  or ~500 ms of idle. The lease must outlive the flush.
- **Refuse instead of merge.** A stale write (409) freezes further writes and names who changed
  what. The field keeps the local text — losing typed words is the worst outcome — and offers to
  copy it or reload the card.
- **Never queue a refusal.** An offline edit may be queued only if it was accepted. An edit refused
  for a lock is dropped, not replayed after the lock is gone: replaying it is exactly the lost
  update the lock exists to prevent.

## Identity

Locks are keyed by the **server's** identity, never a name the client supplies. Today's `meUserId`
is a pointer into the local users directory — good for "whose browser this is", not an authority.
Accounts arrive with Stage 2, and the lock row carries both the user and the session.

Log entries gain an optional `by` as part of the groundwork: a team tool's history without authors
is half a history, and the conflict message needs the name. That field is also the audit trail.

## Data model

One row per held card; `item_id` is the primary key, so two holders cannot both be right.

```
Lock { itemId, userId, sessionId, holderName, acquiredAt, expiresAt }
```

Acquire is a single conditional write — `… WHERE expires_at < now()` — so the race is settled by
the store, not the client. In Postgres that is one `INSERT … ON CONFLICT … DO UPDATE … WHERE`
statement; behind a Durable Object it is a single-threaded compare-and-set. Locks are **never**
persisted in `kanbantoolkit-state-v3`: they are session state, like selection and filters.

## Protocol

```
POST   /items/:id/lock       → 200 { lock } | 409 { holder }
POST   /items/:id/heartbeat  → 200 | 409 { holder }
DELETE /items/:id/lock       → 204
PATCH  /items/:id            { rev, patch } → 200 { rev } | 409 { rev, by } | 423 { holder }
WS     /workspace            presence, lock.acquired, lock.released, item.changed, placement.changed
```

`423 Locked` for "someone else holds it"; `409 Conflict` for "it changed while you were editing".
The two are different sentences in the UI and should stay different on the wire.

## Client state

A `presence` slice, beside the other view state and excluded from `persistedSlice`:

```
presence {
  connected: boolean
  locks: Record<itemId, Lock>       // who holds what, from the server
  lastSeen: Record<userId, number>  // for the "editing" mark on the board
}
```

The drawer reads `locks[itemId]`: absent or mine → editable; someone else → read-only with a
banner naming them. A reader's drawer still updates live as the holder types, so reading a card is
never stale.

## The UI contract

- **The drawer stays open and readable.** Read-only is a state of the fields, not a closed panel:
  the holder is named at the top, and values keep the shape values wear rather than turning into
  disabled grey boxes — the same language the derived Status uses.
- **The card says who has the pen**, with a mark that cannot be mistaken for an assignee (an
  assignee avatar means "works on this"; the editing mark means "has it open right now").
- **Bulk actions refuse as a whole**, following the precedent `setParents` set: a selection that
  contains a card someone else holds is refused before anything is written, and names the card.
- **A refused write stops the field and explains**, rather than accepting keystrokes into a void.
- **Your own second tab** gets "you have this open in another tab", not a lock-out.

## Failure modes

| Situation | What happens |
| --- | --- |
| Holder closes the tab | `pagehide` releases it; if that is missed, the TTL does |
| Holder's wifi dies | The lease lapses within a minute; the next person takes it |
| TTL lapses mid-typing | The next write is refused; the field keeps the text and says who changed it |
| Two people acquire at once | The store settles it; one gets `200`, the other `409` |
| Same person in two tabs | The second is told; the first keeps the pen |
| Bulk action over a held card | Refused as a whole, naming the card |
| Offline | Your own accepted edits queue; an edit refused for a lock is never queued |
| Someone drags a card being edited | Allowed — arrangement is not content; both see the move |

## Groundwork in the app today

Safe to do before accounts exist, and cheaper now than after the backend lands:

1. **One item-write seam.** Item mutations are spread across roughly twenty store actions and
   twenty-one separate `items: state.items.map` sites. A lock check wants one place to live — the
   shape `moveCard` already gives placements.
2. **`rev` on `Item`** (optional, so no migration): bumped by that seam, and the number a 409 is
   judged against.
3. **`by` on log entries** (optional): authors, for the history and the conflict message.
4. **The AGENTS line** for the scope rule above (content and relationships, never arrangement), so
   the rule outlives the next change to the store.

## Where it lands

Phase 1 of the production plan gains the four groundwork items; **Stage 2** ships the lease,
presence and the revision check alongside accounts and the server-authoritative store, because
"who is editing" needs real identity; **Stage 3** adds the polish — takeover notices, "ask to take
over", and field-level presence.

## Open questions

- Does a relationship edit need the *other* card's lock? **Recommendation:** no. The lock belongs
  to the card whose content changes; an edge is recorded on both logs, but only the edited card's
  drawer is blocked.
- "Ask to take over" — a nudge to the holder, or nothing? Not needed for v1.
- Field-level presence ("Maya is in the description") — pleasant, not required.
- Per-field last-write-wins as an alternative to blocking: rejected for now, because the product
  wants one pen in a card, and because the revision check already prevents silent overwrites
  without needing it.

## Non-goals

- **No CRDT in v1.** The model is discrete fields, not a shared text buffer; the only free text is
  the description, and it is locked rather than merged.
- **No blocking of arrangement.** Board moves stay available to everyone.
- **No offline editing of a card someone else holds**, and no replay of edits that were refused.
