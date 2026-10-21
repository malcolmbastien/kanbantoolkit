# The road to a server

The backlog holds the detail and the requirements; this holds the order, and the reason for it.
Every phase below ends with something true and testable, not with a percentage.

## Where the project is

The static tier is complete and shipped. A board, a card, its history, its rollups, its archive,
its templates, its filters and its timeline all work offline in the browser, and `dist/` runs on any
host with no backend at all. Snapshots, storage honesty, tab sync and refusing migrations are done
(111–116), as is the deploy (106), error reporting (107), titles (109), code splitting (110) and the
end-to-end suite (124).

Nothing below takes that away. A person who never signs in keeps a working board.

## The critical path

```
129 ──► 117 ──► 118.1 ─► 118.2 ─► 118.3 ─► 118.4 ─► 118.5 ─► 118.6 ─► 118.7 ─► 120 ─► 121
                                                        │
                                                        ├─► 122 ─► 123
                                                        │        └─► 126
                                                        ├─► 119
                                                        └─► 128
```

`125` (accessibility) has no dependencies and can be done anywhere.

## Phase 0 — The server has a shape (129)

**Why first:** 117's OAuth callback is the first route this app will ever have. If it is written
before the seam exists, it is written in the one file a self-hoster cannot run, and 118 inherits
that shape.

- A Hono app in `server/`: one `fetch` handler, no bindings.
- A `Database` interface with two implementations — D1, and a SQLite file.
- `worker/index.ts` as the Cloudflare entry, `server/index.node.ts` as the Node entry.
- `/api/health` answering on both.
- A CI job that boots the Node entry and replays the API paths the e2e suite uses.

**Ends with:** the same commit serving the app from Cloudflare and from a laptop, and a check that
fails if the second entry stops working. No feature changes hands.

## Phase 1 — Identity (117)

Two providers, a session, an invitation, and a development identity switch — because the card lease
in 120 cannot be tested by one person, and a self-hoster needs to sign in before any provider exists.

**Ends with:** someone signing in with Google or Microsoft and staying signed in across a reload.
The workspace is still in the browser at this point, which is why this phase is not a public
release: accounts without a server-held workspace would be a confusing thing to hand anyone.

## Phase 2 — The workspace moves (118)

Seven steps, in order, each one shippable:

1. The schema and the read — every persisted entity has a table, one request returns the workspace.
2. One boundary — the store reads and writes through an adapter; the local build is unchanged.
3. The write path — a change goes to the server with the revision it was based on.
4. The offline queue — accepted changes wait, go once, and go in order.
5. Live — a change on one device reaches another, through a Durable Object, a Node WebSocket, or a
   poll of the revision.
6. First sign-in — a local workspace becomes the account's workspace, with its logs intact.
7. The server's schema migrates with the same discipline as the browser's.

**Ends with:** a board on one device appearing on another, and an edit made offline arriving once.
This is the first release that is honestly a hosted product — and the first that is honestly
self-hostable, because the same server runs in both places.

## Phase 3 — Collaboration (120, 121, 122, 123, 126)

- **120** — one person holds a card's pen at a time (the design is in `docs/collaboration.md`).
- **121** — a refused write keeps the words and says what happened.
- **122** — a workspace has members, and a role decides what they may do.
- **123** — a board can be shared as a read-only link, revocably.
- **126** — the product says what it does with your data, and can delete it.

**Ends with:** two people editing the same board without clobbering each other, and a link that can
be taken back.

## Phase 4 — Operations (119, 128)

- **119** — a backup exists, and someone has restored from it.
- **128** — a Docker image, a compose file, a first run that makes the first account the owner, and
  a README that states the single-instance limit of a file-backed database.

**Ends with:** `docker compose up` and a working instance someone else can run.

## What ships when

| After | A person can | Tier |
| --- | --- | --- |
| today | keep a board offline, in the browser | static |
| 129 | the same, from Cloudflare or a laptop | static, both hosts |
| 118 | open their boards from a second device; edits made offline arrive | hosted + self-host |
| 120, 121 | edit beside a colleague without clobbering them | both |
| 122, 123 | invite members; share a board read-only and revoke it | both |
| 119 | restore the workspace from a backup | both |
| 128 | run the whole thing themselves | self-host |

## Not planned, and why

- **127** (board-level history) — cancelled: a card can sit on several boards, so its history is the
  card's. The card's Activity tab is that screen.
- **104** (one permanent origin) — deferred: the testers' `workers.dev` origin will lose its data
  before the real domain, which is the point of testing there.
- **108** (usage analytics) — deferred: no tracking until the product has something to learn from,
  and self-hosters must never be counted.

## The one thing that can invalidate this plan

A decision that is cheaper now than later: **the licence**. Contributors' code cannot easily be
relicensed afterwards, so it should be chosen before the repository is open. AGPL if hosting
competitors should share back; Apache-2.0 if adoption matters more.
