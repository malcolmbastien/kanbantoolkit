# Connecting an agent (MCP)

Kanban Toolkit speaks [Model Context Protocol](https://modelcontextprotocol.io), so an agent can read and
write your board on your behalf. The tools are named after things a person does on the board, they
call the same operations as [`/api/v1`](rest-api.md), and the same domain rules decide them. A move an
agent makes is a move: a WIP limit can refuse it, it is recorded in the item's history, and the
history says whose token made it.

This page is for someone who runs an instance and wants an agent to work on it. The project's
contributor rules are in [`AGENTS.md`](../AGENTS.md).

## Before you start

- A running instance you can reach, for example `https://board.example.com` or `http://localhost:8787`.
- An account that is a member of that instance. An agent acts with its owner's role and can never go
  past it.
- An MCP-capable agent, configured with one of the two transports below.

## Choose a transport

| Transport | Use it when | Needs |
| --- | --- | --- |
| **Streamable HTTP** | the agent can make HTTP requests, or runs somewhere other than your machine | the instance URL and a token |
| **stdio** | the agent runs on your machine and starts local processes | a checkout of this repository, with `npm ci` run once, and a token |

Both serve the same tool list and enforce the same rules. A revoked token stops working on its next
request under either transport.

**Docker installs use Streamable HTTP.** The container runs the server only. The stdio bridge is not
in the image, so it needs a checkout.

## Get a token

A token is a secret that identifies you to the instance. Create one in one of two ways.

**From the app.** Sign in, open **Admin → Connect an agent**, choose a name, and choose whether the
agent may write. The app shows the configuration with the secret in it, once.

- Read-only mints `boards:read`, `items:read`, `people:read` and `items:comment`.
- Read and write adds `items:write` and `objectives:write`.

**From a terminal**, using the CLI in a checkout of this repository:

```bash
npm run kanbantoolkit -- login --url https://board.example.com
```

The command prints a short code and waits. Approve the code in the browser you are signed in to, and
the CLI stores the secret in `~/.config/kanbantoolkit/token` with permissions `600`.

By default the CLI asks for `boards:read` and `items:read` only, and the token lasts the instance's
default (90 days). Add what the agent needs:

```bash
npm run kanbantoolkit -- login --url https://board.example.com \
  --scopes boards:read,items:read,items:write --days 30
```

| Scope | What it allows |
| --- | --- |
| `boards:read` | list boards, read a board, read objectives and the workspace summary |
| `items:read` | search and read items |
| `items:write` | create, update and move items, and set parents |
| `people:read` | list people, so an assignee is a real person |
| `items:comment` | add a note to an item — the one write that changes no field, so a read-only agent granted it can report back |

Mint the token read-only unless the agent needs to change the board. Grant `boards:write` only if you
have a reason: no MCP tool uses it.

A token is a secret. Anyone holding it can act as you, within its scopes. Revoke it from the app if it
leaks.

## Configure the agent

### Over HTTP

Use this for Docker installs, and for any instance the agent reaches over the network.

```json
{
  "mcpServers": {
    "kanbantoolkit": {
      "type": "http",
      "url": "https://board.example.com/mcp",
      "headers": { "Authorization": "Bearer ktk_…" }
    }
  }
}
```

Replace `ktk_…` with your token and the URL with your instance's address. The connection is
stateless: the agent or the server can restart without losing anything. A plain `GET /mcp` returns
`405` and says that this server does not stream to the client.

### On your machine (stdio)

Use this when the agent should start the bridge itself. You need a checkout of this repository, with
dependencies installed once:

```bash
git clone <repository-url> kanbantoolkit
cd kanbantoolkit && npm ci
```

Then point the agent at the checkout:

```json
{
  "mcpServers": {
    "kanbantoolkit": {
      "command": "npm",
      "args": ["--prefix", "/home/you/kanbantoolkit", "run", "--silent", "mcp"],
      "env": {
        "KANBANTOOLKIT_URL": "https://board.example.com",
        "KANBANTOOLKIT_TOKEN_FILE": "/home/you/.config/kanbantoolkit/token"
      }
    }
  }
}
```

- Replace `/home/you/kanbantoolkit` with the path to your checkout.
- `--silent` keeps npm's own messages off the protocol channel.
- `KANBANTOOLKIT_TOKEN` can replace the token file, but the file is better. A config you share does not
  then carry a secret.
- If `KANBANTOOLKIT_URL` is unset, the bridge uses `http://localhost:8787`.

The bridge is a relay: it forwards each message to your instance, so the tools, the rules and the
history are the instance's own.

## Your first session

A reasonable order for an agent:

1. `list_boards`: which boards exist, and whether each one is archived or read-only.
2. `workspace_summary`: counts and the columns of your team board, without paging through every card.
3. `get_board`: one board, its columns and cells, and the items on it. The `laneId` values you need to
   move a card come from here.
4. `search_items`: find an item by part of its title. It returns ids.
5. `get_item`: one item, with its `rev`. A write has to say which revision it was based on.
6. `update_item` or `move_item`: make the change, passing the `rev` from step 5 as `baseRev`. A
   move and a note take no revision — an append cannot be stale.
7. `add_note`: say what you did or what you need. It is the one write that changes nothing but the
   card's history, and it is how an agent reports back.

## The tools

Reads:

| Tool | Scope | What it returns |
| --- | --- | --- |
| `list_boards` | `boards:read` | every board: id, name, band, archived, WIP enforcement |
| `get_board` | `boards:read` | one board with its lane trees (one initiatives flow and one or more cards flows, each named), its placements, and the items on it |
| `search_items` | `items:read` | items whose title contains your text. It is a plain substring search, not a query language |
| `get_item` | `items:read` | one item: fields, parent, placements, revision, rollup and history |
| `list_objectives` | `boards:read` | objectives, with the completeness their work gives them (`null` when no work serves one), and their key results |
| `list_people` | `people:read` | ids and names, so an assignee is a person, not a guess |
| `workspace_summary` | `boards:read` | counts, the board list, and the columns of the first team board with how many items each holds |

Writes:

| Tool | Scope | What it refuses |
| --- | --- | --- |
| `create_item` | `items:write` | a board, lane, type, parent, tag or assignee that does not exist; a lane of the wrong kind of flow; a `size`, because boards count issues, not points; a `createdById`, because the server records the creator |
| `update_item` | `items:write` | a missing or stale `baseRev`, returning the current item; a change of type into or out of Initiative or Sub-task (`invalid`); a `size`; a `createdById`; a parent that is not an initiative, or would make a cycle |
| `move_item` | `items:write` | a `block` lane at its limit; a `justify` lane without a reason; a card into an initiatives cell, or an initiative into a cards cell; an initiative across its section |
| `set_parent` | `items:write` | a parent that is not an initiative, the item itself, or one of its own descendants |
| `add_note` | `items:comment` | an empty note, or one over 2000 characters. It changes no field and takes no revision, so a move by somebody else cannot block it; the note lands in the card's Activity with its mentions, and the activity says which token wrote it |

Reads are paged. A page holds 50 items by default and never more than 200. A list answer includes a
`nextCursor` when there is another page. Pass it back to continue.

**There is no tool that generates work.** No tool fills a board with plausible cards, rewrites it from a
summary, or invents history. The app records what people wrote. `create_item` records what the agent was
asked to file, and the words are the agent's to choose, within that request.

There is no bulk write, no `force` argument, no SQL or filter expression, and no unauthenticated mode.
A batch of twenty cards is twenty calls, and each is accepted or refused on its own.

## Give the agent the skill

[`skills/kanbantoolkit/SKILL.md`](../skills/kanbantoolkit/SKILL.md) is the same knowledge as this page, written for a model to load: the
shape of the work, the rules that will refuse it, the order to read in, and the refusal codes. Point
a skill-aware agent at that file and it does not have to be taught the board twice.

## When a tool refuses

A refusal is a normal answer, not a crash: the result has `isError: true` and a sentence a person can
read:

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "content": [{ "type": "text", "text": "Done is at its limit of 1, so a reason is needed to move into it." }],
    "structuredContent": { "error": "reason_required", "details": { "laneId": "l-done", "limit": 1 } },
    "isError": true
  }
}
```

`structuredContent.error` is a stable code, the same one `/api/v1` uses:

| Code | Meaning | What to do |
| --- | --- | --- |
| `wip_blocked` | the lane is full, and its board does not let work over the limit | move elsewhere, or ask someone to free space |
| `reason_required` | the lane needs a reason to accept the card | repeat the move with the reason |
| `section_fixed` | an initiative cannot leave its section | move it within the section |
| `parent_invalid` | the parent is not an initiative, or would create a cycle | choose a different parent |
| `stale` | the item changed since you read it; the answer includes the current item | read the new revision and decide again |
| `role_forbidden` | your role does not allow this change | ask an administrator, or use a different account |
| `invalid` | a field is missing or not allowed | correct the field named in `details` |
| `not_found` | the id is not on this instance, or not in this workspace | search again |
| `conflict` | an item with that id already exists | use a new id, or leave it out for the server to choose |

A token that cannot write has no write tools: its `tools/list` does not include them.

## Troubleshooting

- **The agent sees no tools.** The MCP connection failed, or the configuration is wrong. Check the URL or
  the `npm --prefix` path first.
- **`401` with `invalid_token`.** The token was revoked, has expired, or belongs to an account that is no
  longer a member. Create a new token.
- **The agent can read but not write.** The token is read-only. Create a token with `items:write`.
- **The bridge says it is unreachable.** Check `KANBANTOOLKIT_URL`, and whether the instance is running.
- **The bridge says there is no credential.** Set `KANBANTOOLKIT_TOKEN_FILE`, or run `login` again.
- **A write answers `stale`.** Someone changed the item after you read it. The answer includes the current
  item, so use its `rev` and decide again.

## The rule

An agent writes what a person asked for, and may choose the words of a card it was asked to file. It
may not invent work.

## Out of scope, on purpose

- **Prompts and sampling.** This is a server that lets an agent read and write the board, not a chat
  feature inside Kanban Toolkit.
- **Server-initiated streams.** There is no `GET /mcp` event stream. The tools are request and
  response.
- **An unauthenticated mode.** The history has to be able to say who acted.
