# The API

One `fetch` handler. Hono exposes it as `app.fetch`; the Worker exports it and the Node entry serves
it. There is no second implementation, no GraphQL and no SDK: a JSON request and a JSON answer.

This page is the **internal** API — what the shipped client calls, which changes with it in the same
commit and promises nobody else anything. The surface a script may build on is
[`/api/v1`](rest-api.md), and it says what it will not change.

Everything is under `/api`. The client is a static build, so every one of these is same-origin and no
route answers a request from another origin.

## The session

| | |
| --- | --- |
| **Cookie** | `fl_session` — `HttpOnly`, `SameSite=Lax`, `Secure` when `PUBLIC_URL` is https, `Path=/` |
| **How long** | 12 hours by default; 30 days if the person asked to be remembered at sign-in |
| **What it holds** | an opaque token; the session row holds a **hash** of it, the browser it was opened on, and when it was last used |
| **Revocation** | a sign-out deletes that row; "sign out everywhere" deletes all of them; an administrator can revoke one, or all of somebody's |

A cookie is not a claim about authority. Every request re-reads the caller's roles from the database,
so a demotion or a removal takes effect on the next request rather than at the next sign-in.

Writes are JSON with `Content-Type: application/json`, which a cross-site form cannot send — that and
`SameSite=Lax` are what stand in for a CSRF token here.

## Machine credentials

A tool has no browser and cannot hold a cookie, so it signs in with a **bearer token** instead:

```
Authorization: Bearer ktk_…
```

A token is minted once, shown once, stored as SHA-256, scoped, expiring and revocable. It is a
credential for a *person*: whatever it does, the audit says whose it was.

**Two ceilings, both checked on every request.** The first is the token's **scopes** — what the tool
was allowed to ask for. The second is the owner's **role**, read from `workspace_members` at that
moment. A demotion tightens every token its owner holds, with nothing to revoke; a token can only
ever narrow a role, never widen it.

| Scope | Reaches |
| --- | --- |
| `boards:read` | the boards, and search |
| `items:read` | cards and initiatives |
| `people:read` | the team roster |
| `items:comment` | a note on a card, and nothing else |
| `boards:write` | create a board; change its design, settings and templates *where the role allows* |
| `items:write` | create, edit, move, block and delete cards; commenting is included |
| `objectives:write` | objectives and key results |
| `workspace:admin` | the workspace's settings, people, data and end |
| `instance:admin` | the instance's accounts, invitations and access rules |

`board.design`, `board.settings` and `board.delete` are administrator acts in the matrix, so an
editor's `boards:write` token creates boards and cannot redesign one. Minting refuses a scope the
person could not exercise *at all* (`422`, naming it) — a Viewer cannot hold `items:write` — which is
why `items:comment` is a scope of its own.

| Route | Authority | What it does |
| --- | --- | --- |
| `GET /api/tokens` | the session | this person's tokens, without their secrets |
| `POST /api/tokens` | the session | `{ name, scopes, expiresInDays? }` → `201 { token, secret }`; **the only time the secret is answered** |
| `DELETE /api/tokens/:id` | the session | revoke; the next request with it is `401` |
| `GET /api/tokens/self` | either credential | which credential is asking, and its scopes (`null` for a session) |
| `GET /api/admin/users/:id/tokens` | `instance:admin` | somebody else's, for revoking one (R5) |
| `POST /api/admin/users/:id/tokens` | `instance:admin` | mint for a daemon, within **that person's** role (R9) |
| `DELETE /api/admin/users/:id/tokens/:tokenId` | `instance:admin` | revoke, audited |

Expiry is 90 days unless asked otherwise; `expiresInDays: null` means never, for a machine nobody will
revisit. Revoked and expired rows stay, marked, because "which credential was this" is a question an
audit asks after the fact.

### A tool connects itself

An administrator minting a secret by hand and pasting it somewhere is the part of this design that
does not scale, so there is a device flow:

| Route | Authority | What it does |
| --- | --- | --- |
| `POST /api/tokens/device` | none | `{ name, scopes }` → `{ device_code, user_code, verification_uri, expires_in }` |
| `GET /api/tokens/device/:code` | the session | what the approval screen shows: the tool's name, the scopes, the expiry |
| `POST /api/tokens/device/approve` | the session | `{ user_code, scopes? }` — the scopes may be narrowed, never widened |
| `POST /api/tokens/device/token` | none | `{ device_code }` → `428` while pending, `200 { secret }` once, `410` after |

The short code lives ten minutes, is single-use in both directions, and says nothing about who the
tool is until a person presses Approve. The CLI does the whole dance:

```
npm run kanbantoolkit -- login --url http://localhost:8787
```

It prints eight characters and an `/app?approve=…` URL, waits, and writes the secret to
`~/.config/kanbantoolkit/token` with mode `0600` — or to `KANBANTOOLKIT_TOKEN_FILE`. `kanbantoolkit whoami` says
whose credential it is and what it may reach; `kanbantoolkit token` prints it for a pipe. The secret never
passes through a clipboard, a shell history or a chat message.

### One credential, one owner

A token belongs to a person, and an account's deletion takes its tokens with it. An administrator can
list and revoke somebody's, and never sees a value: the row holds a hash, so there is nothing to
reveal. Minting *for* somebody else is checked against **their** role, not the administrator's.

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
holder) carries it beside the sentence rather than in it.

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

A provider that is not configured does not appear in `/providers` and its start route answers `404`,
which is what lets a sign-in page draw exactly the buttons that work.

## The workspace

| Route | Authority | What it does |
| --- | --- | --- |
| `GET /api/workspace` | `board.read` | the whole workspace, plus `schema` and `meUserId` |
| `PATCH /api/workspace/items/:id` | `item.write` | one item, based on a revision — see below |
| `GET /api/workspace/changes?since=<id>` | `board.read` | the change feed after a cursor, and the leases held |
| `POST /api/workspace/items/:id/lock` | `item.write` | take the editing lease |
| `POST /api/workspace/items/:id/heartbeat` | `item.write` | renew it |
| `DELETE /api/workspace/items/:id/lock` | `item.write` | release it |
| `POST /api/workspace/import` | `workspace.import` | replace an empty workspace with a file — refused once it has boards |
| `DELETE /api/workspace` | `workspace.delete` | end the workspace; `{"confirm": "<its name>"}` |

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

Creation is the same route: an item the server has never seen is created whatever `baseRev` says,
which is what lets a workspace that lived only in a browser arrive one card at a time.

### The change feed

```json
{
  "changes": [{ "id": 41, "rev": 8, "item": { "id": "i-atlas-01", … } }],
  "cursor": 41,
  "locks": [{ "itemId": "i-atlas-01", "holderName": "Maya Blake", "expiresAt": "…" }]
}
```

A card written twice in one page appears once, at its latest revision. Ask again with `since=<cursor>`.
`50` changes at most per answer, so a client that has been away makes a few short requests rather
than one enormous one.

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

`/api/admin/*`, for instance administrators. `/api/admin/workspace/*`, for workspace administrators.
The split is the two axes: the first is the deployment, the second is the team.

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
against an older API is told why, rather than given a `404` that reads like a typo.

## Health and reports

| Route | What it does |
| --- | --- |
| `GET /api/health` | `{"ok":true,"database":"ok"}`, or `503` naming what is wrong |
| `POST /api/errors` | a report from a browser: message, stack, path, view, build, browser — never a query string, never an address |

Reports are rate-limited per hashed address and capped per page. The endpoint answers `204`, and
`503` when its database is not configured rather than failing as though the client did something
wrong.

---

**Last verified:** 0.1.0, against the route table in `server/app.ts` and each route file beside it.
