# The API

One `fetch` handler: Hono exposes it as `app.fetch`; the Worker exports it and the Node entry serves
it. No GraphQL, no SDK — a JSON request and a JSON answer.

This is the **internal** API: what the shipped client calls, changing with it in the same commit and
promising nobody else anything. The surface a script may build on is [`/api/v1`](rest-api.md).

Everything is under `/api`. The client is a static build, so every route here is same-origin and none
answers a request from another origin.

## The session

| | |
| --- | --- |
| **Cookie** | `fl_session` — `HttpOnly`, `SameSite=Lax`, `Secure` when `PUBLIC_URL` is https, `Path=/` |
| **How long** | 12 hours by default; 30 days if the person asked to be remembered at sign-in |
| **What it holds** | an opaque token; the session row holds a **hash** of it, the browser it was opened on, and when it was last used |
| **Revocation** | a sign-out deletes that row; "sign out everywhere" deletes all of them; an administrator can revoke one, or all of somebody's |

Every request re-reads the caller's roles from the database, so a demotion or a removal takes effect
on the next request, not at the next sign-in.

Writes are JSON with `Content-Type: application/json`, which a cross-site form cannot send; that and
`SameSite=Lax` stand in for a CSRF token.

## Machine credentials

A tool has no browser and no cookie, so it signs in with a **bearer token**:

```
Authorization: Bearer ktk_…
```

A token is minted once, shown once, stored as SHA-256, scoped, expiring and revocable. It is a
credential for a *person*: whatever it does, the audit names its owner.

**Two ceilings, both checked on every request:** the token's **scopes** — what the tool was allowed
to ask for — and the owner's **role**, read from `workspace_members` at that moment. A demotion
tightens every token its owner holds, with nothing to revoke. A token can only narrow a role, never
widen it.

| Scope | Reaches |
| --- | --- |
| `boards:read` | the boards, and search |
| `items:read` | cards and initiatives |
| `people:read` | the team roster |
| `items:comment` | a note on a card, and nothing else |
| `boards:write` | create a board; change its design, settings and templates *where the role allows* |
| `items:write` | create, edit, move, block and delete cards; commenting is included |
| `objectives:write` | periods, objectives and key results |
| `workspace:admin` | the workspace's settings, people, data and end |
| `instance:admin` | the instance's accounts, invitations and access rules |

`board.design`, `board.settings` and `board.delete` are administrator acts in the matrix, so an
editor's `boards:write` token creates boards and cannot redesign one. Minting refuses a scope the
person could not exercise *at all* (`422`, naming it) — a Viewer cannot hold `items:write` — so
`items:comment` is a scope of its own.

| Route | Authority | What it does |
| --- | --- | --- |
| `GET /api/tokens` | the session | this person's tokens, without their secrets |
| `POST /api/tokens` | the session | `{ name, scopes, expiresInDays? }` → `201 { token, secret }`; **the only time the secret is answered** |
| `DELETE /api/tokens/:id` | the session | revoke; the next request with it is `401` |
| `GET /api/tokens/self` | either credential | which credential is asking, and its scopes (`null` for a session) |
| `GET /api/admin/users/:id/tokens` | `instance:admin` | somebody else's, for revoking one (R5) |
| `POST /api/admin/users/:id/tokens` | `instance:admin` | mint for a daemon, within **that person's** role (R9) |
| `DELETE /api/admin/users/:id/tokens/:tokenId` | `instance:admin` | revoke, audited |

Expiry is 90 days unless asked otherwise; `expiresInDays: null` means never. Revoked and expired rows
stay, marked: an audit asks afterwards which credential was used.

### A tool connects itself

A tool can also connect itself, through a device flow:

| Route | Authority | What it does |
| --- | --- | --- |
| `POST /api/tokens/device` | none | `{ name, scopes }` → `{ device_code, user_code, verification_uri, expires_in }` |
| `GET /api/tokens/device/:code` | the session | what the approval screen shows: the tool's name, the scopes, the expiry |
| `POST /api/tokens/device/approve` | the session | `{ user_code, scopes? }` — the scopes may be narrowed, never widened |
| `POST /api/tokens/device/token` | none | `{ device_code }` → `428` while pending, `200 { secret }` once, `410` after |

The short code lives ten minutes, is single-use in both directions, and says nothing about who the
tool is until a person presses Approve. The CLI does the whole flow:

```
npm run kanbantoolkit -- login --url http://localhost:8787
```

It prints eight characters and an `/app?approve=…` URL, waits, and writes the secret to
`~/.config/kanbantoolkit/token` with mode `0600` — or to `KANBANTOOLKIT_TOKEN_FILE`. `kanbantoolkit whoami` says
whose credential it is and what it may reach; `kanbantoolkit token` prints it for a pipe. The secret never
passes through a clipboard, a shell history or a chat message.

### One credential, one owner

A token belongs to a person, and an account's deletion takes its tokens with it. An administrator can
list and revoke somebody's, and never sees a value: the row holds a hash. Minting *for* somebody else
is checked against **their** role, not the administrator's.

## Statuses

| | |
| --- | --- |
| `400` | the body is not the shape this route writes |
| `401` | the instance does not know you |
| `403` | it knows you, and you may not |
| `404` | there is nothing here for you — including work in a workspace you are not in, because naming it would confirm it exists |
| `409` | a disagreement: a revision moved, a name is taken, a workspace already exists |
| `422` | the body asked for something this server will not grant — a scope a role cannot hold, a name that is empty |
| `428` | a device code nobody has approved yet; the tool should keep waiting |
| `410` | this invitation is used, expired or revoked (all three look the same from outside) |
| `423` | a card is held by somebody else's lease |
| `503` | the database is not configured, is behind the code's schema, or cannot be reached |

Errors are always `{"error": "a sentence"}`. A refusal that needs more (a conflict's item, a lease's
holder) carries it beside the sentence.

## Signing in

| Route | What it does |
| --- | --- |
| `GET /api/auth/providers` | the doors this deployment actually has, and whether the development switch is on |
| `GET /api/auth/start?provider=<id>&return=<path>` | begins the flow: a state cookie, PKCE, and a redirect to the provider |
| `GET /api/auth/callback` | where the provider returns; exchanges the code, verifies the address, issues the session |
| `GET /api/auth/session` | who is signed in: `{ user, instanceRole, workspaces, dev, live }` |
| `POST /api/auth/signout` | ends this session (`204`) |
| `POST /api/auth/dev` | `{"email": "…"}` — the development identity, only when `AUTH_DEV=1` |

`return` is honoured only if it is a path on this origin; anything else is ignored, not followed.

A provider that is not configured does not appear in `/providers` and its start route answers `404`.

## The workspace

| Route | Authority | What it does |
| --- | --- | --- |
| `GET /api/workspace` | `board.read` | the whole workspace — cards without their history — plus `schema`, `meUserId`, `structureRev` and `vocabularyRev` |
| `PATCH /api/workspace/items/:id` | `item.write` | one item, based on a revision — see below |
| `GET /api/workspace/items/:id/log` | `board.read` | one card's history, one page at a time, newest first |
| `POST /api/workspace/items/:id/log` | `item.write` | append history entries without taking a revision — a move is arrangement |
| `GET /api/workspace/movements?boardId=<id>` | `board.read` | one board's moves — the stages and timestamps its flow reading charts |
| `GET /api/workspace/notes?q=<text>` | `board.read` | notes matching a query, or with `mention=me`, the notes that name the caller |
| `GET /api/workspace/changes?since=<id>` | `board.read` | the change feed after a cursor, and the leases held |
| `POST /api/workspace/items/:id/lock` | `item.write` | take the editing lease |
| `POST /api/workspace/items/:id/heartbeat` | `item.write` | renew it |
| `DELETE /api/workspace/items/:id/lock` | `item.write` | release it |
| `PUT /api/workspace/structure` | `board.design` | write the board design — boards, flows, lanes and placements — as one document, with the revision it began from |
| `PUT /api/workspace/vocabulary` | per list | write the workspace's words — issue types, templates, periods, objectives and key results — as one document, with the revision it began from |
| `POST /api/workspace/import` | `workspace.import` | replace an empty workspace with a file — refused once it has boards |
| `DELETE /api/workspace` | `workspace.delete` | end the workspace; `{"confirm": "<its name>"}` |

### Writing the workspace's words

Types, board templates, periods, objectives and key results are whole-list edits with no position of
their own, so they travel as one document, beside the design and not inside it.

```http
PUT /api/workspace/vocabulary
Content-Type: application/json

{ "rev": 4, "issueTypes": [...], "boardTemplates": [...], "periods": [...], "objectives": [...],
  "keyResults": [...] }
```

A period is a record — `{ "id", "name", "start"?, "end"? }` — and an objective names one
(`periodId`). An objective has no target date and no score: the period's window is when it is due,
and its completeness comes from the work below it.

The document is the whole truth about those lists: a row the sender did not send is deleted, so a
malformed list is refused rather than filtered. The answer is the next revision. A stale one is
refused with the revision that is there, and the client re-reads rather than sending its version
over somebody else's.

| Answer | Means |
| --- | --- |
| `200 {"rev": 5, …counts}` | it landed; the counts are what the server now holds |
| `200 {"rev": 4}` | nothing changed; no write happened, so no revision moved |
| `409 {"rev": 5}` | somebody else wrote these lists; read theirs |
| `400` | not a vocabulary document — a double id, a lane naming no flow, a missing list |
| `422 {"error", "field"}` | `issueTypes` without `None`/`Initiative`, a key result naming an objective that is not in the document, or an objective committed for a period that is not |
| `422 {"error", "fields"}` | a list this role may not change, named — and nothing is written |
| `403` | a role that may change none of it, or no session |

Permission is **per list**, because a role can hold one and not another: `board.settings` for issue
types, `template.manage` for templates, and `objective.write` for periods, objectives and key
results. A list the caller may not change is refused by name rather than dropped. The built-in
labels (`None`, `Initiative`) are the app's and are refused when the document forgets them.

How long finished work stays on a board is **not** in this document: it is the product's constant
(`AUTO_ARCHIVE_DAYS`, seven days), not a word the workspace chooses.

`savedFilters` and `collapsedLanes` are **not** in the document. They are one device's view and stay
in that browser.

### Writing an item

```http
PATCH /api/workspace/items/i-atlas-01
Content-Type: application/json

{ "item": { "id": "i-atlas-01", "title": "Ship it", … }, "baseRev": 7, "key": "change-8f3c" }
```

| Answer | Means |
| --- | --- |
| `200 {"item": {…, "rev": 8}}` | it landed |
| `200 {"item": …, "applied": true}` | this `key` already landed; that is what is stored, not a second write |
| `409 {"item": …}` | the revision moved past; the item is the current one, and the client keeps it |
| `423 {"holder": …}` | somebody else's lease is on this card |
| `404` | no such item here — including an item that exists in another workspace |

Creation is the same route: an item the server has never seen is created whatever `baseRev` says, so
a workspace that lived only in a browser can arrive one card at a time.

`log` is append-only. The client may send the entries it knows rather than the whole history, and the
server inserts only ids it does not already hold. An entry the server has is never rewritten. A
Viewer may append only notes, and a `moved` entry is a change to the work rather than a comment.

### Reading history

The workspace document carries cards, not what happened to them: opening a board does not load every
move and note ever written. Three reads answer the views that need history.

One card's history, newest first:

```http
GET /api/workspace/items/i-atlas-01/log?limit=50
```

```json
{ "entries": [{ "id": "l-8", "at": 1760000000000, "kind": "noted", "note": "Second pair of eyes", "by": "u-ada" }],
  "nextCursor": "MTc2MDAwMDAwMDAwMDpsLTM", "total": 213 }
```

`nextCursor` asks for the page before this one and is `null` at the beginning; `total` is the whole
count. A page is `50` entries unless `limit` says otherwise, and never more than `200`. An id from another workspace is `404`, not
an empty log.

One board's moves, for the flow reading:

```http
GET /api/workspace/movements?boardId=b-atlas&since=1751328000000
```

```json
{ "moves": [{ "id": "l-8", "itemId": "i-atlas-01", "at": 1760000000000, "fromStage": "inProgress", "toStage": "done" }],
  "truncated": false }
```

Only `moved` entries, and only the stages they landed in: flow metrics rebuild each card's stages
from stages, never lane names, so a renamed column does not rewrite the past. `since` is an
instant in milliseconds. The cap is 50,000 moves; when it bites the *oldest* go and `truncated` says
so.

The notes search and mentions read:

```http
GET /api/workspace/notes?q=retry
GET /api/workspace/notes?mention=me
```

```json
{ "notes": [{ "itemId": "i-atlas-01", "entry": { "id": "l-8", "at": 1760000000000, "kind": "noted",
  "note": "The retries need a budget", "mentions": ["u-grace"] } }] }
```

`q` is a case-insensitive substring of the note's words; `mention=me` is the caller's own notes and
nobody else's, so it takes no user id. Newest first, `100` by default and `200` at most.

A move appends its entry without changing the card's revision:

```http
POST /api/workspace/items/i-atlas-01/log
Content-Type: application/json

{ "entries": [{ "id": "l-9", "at": 1760000000000, "kind": "moved", "toStage": "done", "boardId": "b-atlas" }] }
```

A drag is arrangement: it changes the placement and the card's log, not the card's revision. Entries
are written as they are, ids making a retry a no-op, and `{"appended": 1}` says how many were offered.
A malformed entry refuses the whole body rather than storing half of one. Placement changes travel
with the board's design, not here.

### The change feed

```json
{
  "changes": [{ "id": 41, "rev": 8, "item": { "id": "i-atlas-01", … } }],
  "cursor": 41,
  "locks": [{ "itemId": "i-atlas-01", "holderName": "Maya Blake", "expiresAt": "…" }]
}
```

A card written twice in one page appears once, at its latest revision. Ask again with `since=<cursor>`.
`50` changes at most per answer.

## The live channel

`GET /api/workspace/live` is a WebSocket upgrade, refused with `401` unless the session is valid. Its
messages are nudges and nothing else:

```json
{ "revision": 42 }
```

Read `/api/workspace/changes` when one arrives. A deployment with no socket server answers `426` (or
the route is absent) and the client polls on the same interval it always did.

## Account and people

| Route | Authority | What it does |
| --- | --- | --- |
| `GET /api/me` | signed in | the profile |
| `PATCH /api/me` | signed in | name, timezone, language — a whitelist, so a forged body does nothing |
| `GET /api/me/sessions` | signed in | the sessions on this account, with this device marked |
| `DELETE /api/me/sessions/:id` | signed in | end one |
| `POST /api/me/signout-everywhere` | signed in | end all of them, including this one |
| `GET /api/me/identities` | signed in | the providers linked to this account |
| `DELETE /api/me/identities/:provider/:subject` | signed in | unlink one — refused if it is the last |

## Administering the deployment

`/api/admin/*` is for instance administrators, `/api/admin/workspace/*` for workspace administrators:
the deployment on one axis, the team on the other.

| Route | What it does |
| --- | --- |
| `GET`, `PATCH /api/admin/settings` | the domains admitted without an invitation (the instance is always closed) |
| `GET /api/admin/users?q=` | the directory, searchable |
| `GET /api/admin/users/:id` | one person: their roles, sessions, identities and history |
| `PATCH /api/admin/users/:id` | edit their name or address |
| `PATCH /api/admin/users/:id/instance` | make them an administrator of the deployment, or not |
| `PATCH /api/admin/users/:id/role` | their role in the workspace |
| `POST /api/admin/users/:id/deactivate`, `/activate` | close or reopen their door, keeping the account |
| `POST /api/admin/users/:id/sessions/revoke` | end their sessions |
| `DELETE /api/admin/users/:id` | remove the account; the work stays, and their name reads "Former member" |
| `POST /api/admin/users/:id/erase` | erase the person, not the work — a different promise |
| `POST /api/admin/users/bulk` | the same acts for a selection, judged whole before anything is written |
| `GET /api/admin/users.csv` | the directory as a file |
| `GET`, `POST /api/admin/invites` | the invitations, and making one |
| `POST /api/admin/invites/:id/resend`, `DELETE /api/admin/invites/:id` | send it again, or take it back |
| `GET /api/admin/workspace` | this workspace: its name and its members |
| `PATCH /api/admin/workspace` | its name |
| `POST /api/admin/workspace/invites` | invite somebody into this workspace |
| `PATCH /api/admin/workspace/members/:id` | their role |
| `POST /api/admin/workspace/members/:id/deactivate`, `/activate` | close or reopen their door |
| `DELETE /api/admin/workspace/members/:id` | remove their account |
| `GET /api/admin/groups`, `POST /api/admin/groups` | the groups, and making one |
| `PATCH`, `DELETE /api/admin/groups/:id` | edit or delete one |
| `POST /api/admin/groups/:id/members`, `DELETE /api/admin/groups/:id/members/:userId` | who is in it |
| `GET /api/admin/audit`, `GET /api/admin/audit/:id` | the trail, and one event |
| `GET /api/admin/audit.csv` | the trail as a CSV file, with the same filters and scope |
| `GET`, `POST /api/admin/webhooks` | the outbound endpoints, and making one (the secret is shown once) |
| `PATCH`, `DELETE /api/admin/webhooks/:id` | pause, resume, edit or delete an endpoint |
| `GET /api/admin/webhooks/:id/deliveries` | the delivery log, with attempts and the receiver's answer |
| `POST /api/admin/webhooks/:id/test` | queue a test delivery |
| `POST /api/admin/webhooks/deliveries/:id/retry` | try a failed delivery again |
| `POST /api/admin/webhooks/dispatch` | send every delivery that is due now |
| `GET`, `POST /api/admin/backups` | list the file copies, and take one; a Worker answers `provider` |
| `GET /api/admin/backups/:name` | download a copy |
| `POST /api/admin/backups/restore` | verify an upload and stage it for the next boot |
| `GET /api/admin/health` | the schema version, the expected one, and whether the feed is moving |

## Invitations

| Route | What it does |
| --- | --- |
| `GET /api/invite/:token` | the invitation: the address (masked), the role, the expiry — `410` for used, expired or revoked |
| `POST /api/invite/:token` | accept it, signed in as the address it was written for |

A token is accepted before the instance's access check — that is what it is for — but only for the
address it names. A forwarded link still needs a sign-in as that person.

## Creating a workspace

`POST /api/workspaces` answers `409` with a sentence: a deployment is one workspace, created with the
installation (see [install.md](install.md)). The route exists so that a stale tab or a script written
against an older API is told why, rather than given a `404`.

## Health and reports

| Route | What it does |
| --- | --- |
| `GET /api/health` | `{"ok":true,"database":"ok"}`, or `503` naming what is wrong |
| `POST /api/errors` | a report from a browser: message, stack, path, view, build, browser — never a query string, never an address |

Reports are rate-limited per hashed address and capped per page. The endpoint answers `204`, and
`503` when its database is not configured.

---

**Last verified:** 0.1.0, against the route table in `server/app.ts` and each route file beside it.
