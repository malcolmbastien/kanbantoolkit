# Architecture

One application, two runtimes, one database schema. This page is the map: what the pieces are, what
may import what, and what happens to a request from the moment a browser sends it.

The deeper arguments live in their own pages: [the two runtimes](server-runtime.md),
[the data model](data-model-v2.md), [collaboration](collaboration.md) and [the API](api.md).

## The layers

```
src/domain/     pure rules — no framework, no store, no network, unit tested
src/            the client: React, the store, the views, localStorage persistence
server/         the API: one Hono app, portable, no Cloudflare-only imports
worker/         the Cloudflare entry: bindings in, app out
server/index.node.ts   the Node entry: a port, a file, a directory
```

The dependency rule is a table in [server-runtime.md](server-runtime.md), and it is enforced by CI:
`npm run portable` fails if `server/` imports `cloudflare:workers`, `D1Database`, `env.ASSETS` or any
Cloudflare-only storage.

Two consequences worth holding on to:

- **The client works with no server at all.** `dist/` on any static host is a complete board; the
  workspace lives in `localStorage`. The server adds accounts, sharing and a second device, and takes
  nothing away.
- **A rule that can be written as a function of the data belongs in `src/domain/`.** Rollup, depth,
  WIP, dependency state, objective coverage: each is a pure function with tests, and both the client
  and the server call the same one.

## The boundary

One deployment is one workspace. The workspace is the tenant, and every row of work names it:
`boards`, `lanes`, `items`, `placements`, `edges`, `links`, `objectives`, `key_results`,
`board_templates`, `people`, `issue_types`, `item_log`. A trigger refuses an insert or an update that
leaves `workspace_id` empty.

**Which workspace a request is about is decided by the session, never by the request.** `access.ts`
resolves it from the caller's memberships; a workspace named in a path is honoured only when the
caller belongs to it (or, for an instance administrator, when it exists). A client cannot point a
read at a workspace it is not in, and a write that would reach across the boundary is a `404` — the
same answer as "no such thing", because naming it would confirm it exists.

Two axes of authority, deliberately separate:

| | Where | What it means |
| --- | --- | --- |
| **the door** | `instance_members.role` | may this person sign in at all, and do they administer the deployment |
| **the authority** | `workspace_members.role`, or a group | what they may read, write, invite or delete in this workspace |

An instance administrator may repair a workspace. A workspace administrator runs their team and
nothing else. The permission matrix is `src/domain/roles.ts`, and it is read on every request rather
than cached in the session — a demotion is visible on the next request, with no re-login.

## A request, end to end

1. **The proxy** terminates TLS and forwards to the process (or Cloudflare's edge does it).
2. **The entry** — `server/index.node.ts` or `worker/index.ts` — builds a `Runtime`: where the
   database is, how to read the client's address, and whether there is a live channel. Nothing else
   differs between the two.
3. **`access.ts`** reads the session cookie, resolves the caller and their workspace, and refuses
   with `401` (I do not know you), `403` (I know you and you may not), or `404` (there is nothing here
   for you).
4. **The route** does one thing, through the domain's rules, in one transaction.
5. **The change feed.** A write bumps the item's revision and appends a row to `changes`. The live
   channel is then rung with a **nudge** — `{"revision": n}` — and never with the change itself: a
   client that receives a nudge reads the feed it already knows how to read.

## Offline and conflict

The browser keeps the workspace in `localStorage` and queues edits when the connection drops. On the
way back it sends them in order, each with the revision it was based on:

- the revision is **still** the stored one → the write lands, revision + 1;
- the revision has **moved past** → `409` with the item as it is now; the client keeps the server's
  answer and never merges by hand;
- the card is **held** by somebody else's lease → `423`, with who holds it;
- a retry after a lost response carries the change's key, and the server answers with what is stored
  rather than applying it twice — which is what makes a queue safe to flush twice.

## The live channel

A socket that says "the feed moved", not a payload feed. On Cloudflare it is a Durable Object per
workspace, holding hibernatable sockets; on Node it is the process's own `ws` server; with neither,
clients poll `/api/workspace/changes?since=<cursor>` and content themselves. `LIVE=0` forces the
poll, which is how CI exercises the fallback.

The point is that the fallback is not a degraded mode: the same client code reads the same feed, and
the socket is only a way to be told when to read it.

## Where the state lives

| | |
| --- | --- |
| **The database** | everything the server holds — accounts, sessions, boards, cards, history, the audit trail |
| **The browser** | a copy of the workspace, a queue of edits not yet sent, snapshots of recent states, and the last account it saw |
| **The environment** | provider credentials, the database path, the salt — never in the database, never in `dist/` |

## Reading on

- **[The API](api.md)** — every route and what it answers.
- **[The data model](data-model-v2.md)** — the tables, and the one workspace they belong to.
- **[Collaboration](collaboration.md)** — the lease and the change feed in full.
- **[Install](install.md)** — putting one of these on a machine.
