# The REST API

`/api/v1` is the surface a script may build on: the same board, the same rules and the same trail as
the app. [The API](api.md) is the internal one the client calls; this page is the one with a promise
attached.

## What it promises

Within `v1`:

- **Fields are added, never removed and never retyped.** A client may read the fields documented here
  and rely on them. One exception is on the record: `autoArchiveDays` left `GET /vocabulary` when the
  setting itself did — finished work is filed after a week, always. A document that still sends it is
  not refused; the field is simply not stored.
- **A new field is always optional.** A response may grow; it will not grow a field you must send.
- **A new *required* field in a request is a breaking change**, so it does not happen inside `v1`.
- **`code` in an error body is stable.** Branch on it; never on `message`, which is for a person.
- **A breaking change becomes `v2`.** `v1` keeps running beside it, answering with a `Sunset` header, for
  at least one minor release.

The document at `GET /api/v1/openapi.json` is generated from the table that mounts the routes, and a
test fails when the two disagree. Generate a client from it rather than from this page.

## Getting a credential

A script uses a token, never a session: it has no browser, and a cookie carries no scopes. The tool
acquires the token rather than a person copying it by hand:

```bash
npm run kanbantoolkit -- login --url https://board.example.com
```

It prints a code and a URL, waits while a person approves it in the browser, and writes the secret to
`~/.config/kanbantoolkit/token` with mode `0600`. Then:

```bash
TOKEN=$(npm run --silent kanbantoolkit -- token)
curl -s -H "Authorization: Bearer $TOKEN" https://board.example.com/api/v1/boards
```

Every answer carries the credential's limits back:

| Header | |
| --- | --- |
| `RateLimit-Limit` | requests allowed in the current minute |
| `RateLimit-Remaining` | how many are left |
| `RateLimit-Reset` | seconds until the window renews |

The window is per token, kept in memory, and configured with `API_RATE_LIMIT` (default 120 a minute).
A spent window is `429`, with `{"error":{"code":"rate_limited"}}` and a `retryAfter` in its details.

### What a token may do

Two ceilings, both read on every request: the token's **scopes** and the owner's **role**. A demotion
tightens every token its holder has, with nothing to revoke.

| Scope | Reaches |
| --- | --- |
| `boards:read` | the boards, and one board's trees and placements |
| `items:read` | cards and initiatives, search |
| `people:read` | names and ids |
| `items:comment` | notes on cards |
| `boards:write` | creating and reshaping boards, within the role |
| `items:write` | creating, changing and moving cards and initiatives |
| `objectives:write` | periods, objectives and key results |
| `workspace:admin` | settings, people, and restoring a workspace file (`POST /workspace`) |

A route that needs a scope your token does not have answers `403 scope_required`, with the scope in
`details.scope`. A route whose *action* your role does not allow answers `403 role_forbidden`: the
first is the token you chose, the second is the person you are.

## The resources

| Route | Scope | What it does |
| --- | --- | --- |
| `GET /boards` | `boards:read` | every board, with its band |
| `GET /boards/{boardId}` | `boards:read` | one board: its cards flows and its initiatives flow, its placements, the items on it |
| `GET /items` | `items:read` | items, filtered by `boardId`, `laneId` (with its subtree), `typeId`, `q`, `updatedSince` |
| `GET /items/{itemId}` | `items:read` | one item, with its parent, placements, rollup and history |
| `POST /items` | `items:write` | create a card or an initiative and place it |
| `PATCH /items/{itemId}` | `items:write` | change its fields; `baseRev` is required |
| `POST /boards/{boardId}/items/{itemId}/move` | `items:write` | move it into a cell, at a position |
| `GET /objectives` | `boards:read` | objectives with their completeness and key results |
| `POST /objectives/{objectiveId}/initiatives/{itemId}` | `items:write` | map a top-level initiative to an objective; one objective per initiative, so this moves it |
| `DELETE /objectives/{objectiveId}/initiatives/{itemId}` | `items:write` | unmap it |
| `GET /vocabulary` | `boards:read` | issue types, board templates, objectives and key results, with `rev` |
| `PUT /vocabulary` | `boards:read`, then per list | replace the whole vocabulary; requires `rev`, and a list the token's scopes or the role do not allow refuses the document |
| `GET /people` | `people:read` | names and ids, so an assignment names a person |
| `GET /search?q=` | `items:read` | the app's own search over titles, descriptions and notes, not a query language; each result carries the clipped matching line |
| `GET /workspace` | `boards:read` | the workspace file, for a backup |
| `POST /workspace` | `workspace:admin` | restore a file into an empty instance |

A note is an item-log entry of kind `noted`. It may carry `mentions`, a list of user ids beside the
note text; a mention is part of the note, not a thread, and the typed `@Name` stays in `note`.

The board design is written through `PUT /api/workspace/structure`, which belongs to the app and
changes with it, so it is not part of v1. A board's shape is read here through
`GET /boards/{boardId}`. The workspace's words are here too: `GET` and `PUT /vocabulary` use the same
document, revision and per-list rules as the app.

A board's lane trees are **flows**: one **initiatives** flow and one or more **cards** flows.
`GET /boards/{boardId}` returns both views. `workflows.cards` is the board's **first** cards flow, the
shape v1 always had, and `workflows.initiatives` is the initiatives flow. `flows` lists every flow with
its `id`, `name`, `kind`, `order` and `lanes`. An item is a card or an initiative; its `typeId` is what
makes it one, not a different resource.

There is no `size` field. The board counts issues, not points, and progress is the number finished over
the number below.

`createdById` is the person who made the item. The server records it from the session and returns it
on every item; a body that sends or changes it is refused with `422 invalid` and the field name,
rather than silently dropped.

`externalLabel` and `externalUrl` are the card's reference elsewhere — a ticket, a design, a page.
The URL must be `http` or `https`; anything else is refused, and an empty URL clears the label with
it. The app never fetches the address, so a link is a way for a reader to leave the board, not an
integration. `add_note` through MCP writes a note without taking a revision; the history names the
token it came through.

An initiative is placed in the initiatives flow, and a card in a cards cell, in any of the board's cards
flows. Moving between cards flows is a move. A route that tries to cross the two kinds answers
`422 wrong_workflow`.

## Conventions

**Pagination.** `?limit=` (default 50, max 200) and `?cursor=`. The answer is `{ data, nextCursor }`;
`nextCursor` is `null` on the last page. The cursor is opaque — send it back, do not parse it.

**Incremental reads.** `?updatedSince=<ISO timestamp>` returns only items whose content changed after
that moment. Note the time *before* your read, then ask again with it.

**Revisions.** A `PATCH` carries `baseRev`: the revision you read. If the item has moved past it the
answer is `409 stale`, and `details.item` is the current item. A move does not need one (it is
arrangement, not content), but it may carry one and be refused the same way.

**Idempotency.** `Idempotency-Key: <your key>` on `POST /items` and `PATCH /items/{id}` makes a retry
safe: the key names the change, and a replay answers with what the change wrote instead of writing it
twice. It lives in the same table the app's own queue uses, and is pruned after a day.

**One error body.** Every refusal:

```json
{ "error": { "code": "wip_blocked", "message": "Done is at its limit of 5.", "details": { "laneId": "l-done", "limit": 5 } } }
```

| Status | `code` | When |
| --- | --- | --- |
| `401` | `token_required` | no `Authorization: Bearer` — a session cookie is not accepted here |
| `401` | `invalid_token` | revoked, expired, or never a token |
| `403` | `scope_required` | the token does not carry the scope; `details.scope` says which |
| `403` | `role_forbidden` | the owner's role does not allow the action |
| `404` | `not_found` | no such board, item or cell |
| `409` | `stale` | the revision moved; `details.item` is the truth |
| `409` | `not_empty` | an import into a workspace that already has boards |
| `422` | `wip_blocked` | the lane's policy is `block` and it is at its limit |
| `422` | `reason_required` | the lane's policy is `justify`; send `reason` |
| `422` | `section_fixed` | an initiative's section is derived from its work; the move would cross one |
| `422` | `parent_invalid` | a parent must be an initiative, and nothing is its own ancestor |
| `422` | `invalid` | a field this route will not take |
| `429` | `rate_limited` | the minute is spent; `details.retryAfter` |

**What a move refuses.** The WIP policy is the board's, not the API's: `visualize` lets it through,
`justify` answers `reason_required` until a reason is given, and `block` refuses. A move into another
workflow, or an initiative across a section, is refused in the same words the app uses: the same
function (`src/domain/move.ts`) decides.

**The trail.** Every write answers as the token's owner and is recorded as `api.write`, naming the
operation, the item and the token. A script cannot write without a trail, and cannot write as somebody
else: a token belongs to one account, and its scopes are that account's to give.

## A worked script

Move every card on one board into the board's first Not Started cell, one at a time, and print what
happened to each. This shell version works in a CI job:

```bash
TOKEN=$(npm run --silent kanbantoolkit -- token)
API=https://board.example.com/api/v1

BOARD=$1 # e.g. "Team Atlas"
BOARD_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/boards" |
  jq -r --arg name "$BOARD" '.data[] | select(.name == $name) | .id')

# Every cards flow, by name — `workflows.cards` is only the first one.
TARGET=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/boards/$BOARD_ID" |
  jq -r '[.flows[] | select(.kind == "cards") | .lanes[]
          | select(.stage == "notStarted") | .id][0]')

curl -s -H "Authorization: Bearer $TOKEN" "$API/items?boardId=$BOARD_ID&includeArchived=false" |
  jq -r '.data[] | select(.laneId != null) | .id' |
  while read -r id; do
    curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
      -d "{\"laneId\":\"$TARGET\"}" "$API/boards/$BOARD_ID/items/$id/move" |
      jq -c '{id: .item.id, lane: .placement.laneId, refused: .error.code}'
  done
```

The same kind of work in Node. This script files one card per line of an input file, and it reports a
refused request rather than stopping:

```js
const api = 'https://board.example.com/api/v1'
const token = process.env.KANBANTOOLKIT_TOKEN
const call = (path, init = {}) =>
  fetch(api + path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers } })

const boards = await (await call('/boards')).json()
const board = boards.data.find((b) => b.name === 'Team Atlas')

for (const line of (await import('node:fs')).readFileSync('titles.txt', 'utf8').split('\n').filter(Boolean)) {
  const answer = await call('/items', {
    method: 'POST',
    // The key names the change: a retry after a timeout files one card, not two.
    headers: { 'idempotency-key': `file-${line}` },
    body: JSON.stringify({ boardId: board.id, title: line, typeId: 't-story' }),
  })
  const body = await answer.json()
  if (!answer.ok) {
    console.error(line, '—', body.error.code, body.error.message)
    continue
  }
  console.log('filed', body.item.id, body.item.title)
}
```

There is no bulk endpoint: a batch of twenty cards is twenty calls, each with its own trail entry.

## The other door

An agent can reach the same acts through **MCP**, over `POST /mcp` or through the stdio bridge, with a
token like the one above. The tools are named after the acts (`create_item`, `move_item`,
`set_parent`) and call the same operations this page describes, so a WIP limit refuses an agent in the
same words. See [the MCP server](mcp.md).

## What is not here

- **A query language.** Search is the app's search; a filter expression language would be a second API
  with none of this one's rules.
- **Unscoped tokens.** A token with no scopes reaches nothing; there is no "all" spelling.
- **An unauthenticated mode.** The document is public; everything else needs a credential, because the
  trail has to be able to say who acted.
