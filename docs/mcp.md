# The MCP server

Kanban Toolkit speaks [Model Context Protocol](https://modelcontextprotocol.io) so an agent can read and
write the board. It is not a second product: the tools are named after the acts a person has, they
call the same operations as [`/api/v1`](rest-api.md), and they are decided by the same domain rules.
A move an agent makes is a move — it can be refused by a WIP limit, it lands in the trail, and it
says whose token did it.

## Two transports, one tool table

| Transport | Who it is for | How |
| --- | --- | --- |
| **Streamable HTTP** | an agent that cannot spawn a process, or a remote one | `POST <instance>/mcp` with `Authorization: Bearer <token>` |
| **stdio** | an agent running on your machine | `npm run mcp` — a bridge that forwards to `/mcp` |

Both serve the same list, because the list is one table (`server/mcp/tools.ts`). The stdio process
decides nothing: it reads JSON-RPC on stdin, forwards each message to the instance with the token,
and writes the answer. A local agent and a remote one are the same caller with the same limits, and a
revocation is felt on the next message.

There is **no unauthenticated mode on either transport**. A local agent still says who it is, or the
trail cannot say who filed the card.

## Connecting

### The token

Either the CLI, in a terminal:

```bash
npm run kanbantoolkit -- login --url https://board.example.com
```

…which prints a code, waits for you to approve it in the browser, and writes the secret to
`~/.config/kanbantoolkit/token`; or **Admin → Connect an agent** in the app, which mints a scoped token and
shows both configurations below with the secret in them, once.

A token is a person's: it acts as its owner, it can never reach past their role, and every write it
makes is audited under their name. Mint it read-only unless the agent needs to write.

### An agent that calls over HTTP

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

The endpoint is stateless: no session id to remember, no server-to-client stream to hold open, and a
restart costs the agent nothing. `GET /mcp` answers `405` and says so.

### An agent on your machine (stdio)

```json
{
  "mcpServers": {
    "kanbantoolkit": {
      "command": "npx",
      "args": ["tsx", "server/mcp.ts"],
      "env": {
        "KANBANTOOLKIT_URL": "https://board.example.com",
        "KANBANTOOLKIT_TOKEN_FILE": "/home/you/.config/kanbantoolkit/token"
      }
    }
  }
}
```

`KANBANTOOLKIT_TOKEN` works instead of the file if you must; the file is better, because that is where the
CLI keeps it and a config that travels does not carry a secret. The bridge needs the repository (or
the image, run with `docker exec -i kanbantoolkit tsx server/mcp.ts`); everything else runs on the
instance.

## The tools

Reads:

| Tool | Scope | What it returns |
| --- | --- | --- |
| `list_boards` | `boards:read` | every board: id, name, band, archived, WIP enforcement |
| `get_board` | `boards:read` | one board with its two lane trees, its placements, the items on it — this is where `laneId` comes from |
| `search_items` | `items:read` | the app's own search: a substring of the title, never a query language |
| `get_item` | `items:read` | one item: fields, parent, placements, revision, rollup, history |
| `list_objectives` | `boards:read` | objectives with the completeness their work gives them (`null` when nothing serves one) and their key results |
| `list_people` | `people:read` | ids and names, so an assignee is a person and not a guess |
| `workspace_summary` | `boards:read` | counts and the board list, and the columns of the first team board with how many items each holds |

Writes:

| Tool | Scope | What it refuses |
| --- | --- | --- |
| `create_item` | `items:write` | a board, lane, type, parent, tag or assignee that does not exist; a lane of the other workflow; a `size` (the board counts issues, not points); a `createdById` — the server records the caller as the creator |
| `update_item` | `items:write` | a stale `baseRev` (with the current item); a retype into or out of Initiative; a `size`; a `createdById`; a parent that is not an initiative or would make a cycle |
| `move_item` | `items:write` | a `block` lane at its limit; a `justify` lane without a reason; a card into an initiatives cell or the reverse; an initiative across its section |
| `set_parent` | `items:write` | a parent that is not an initiative, the item itself, or its own descendant |

Reads are bounded: a page is 50 by default and never more than 200, and `workspace_summary` exists so
an agent does not have to page through 400 cards to answer "what is in Done".

**There is no generative tool, and that is a decision.** No tool fills a board with plausible cards,
rewrites it from a summary, or fabricates history — the product's rule is that the app writes what
somebody wrote, and a model's guess is nobody's words. `create_item` is somebody writing; a tool that
invented the words would not be.

There is also no bulk write, no `force` argument, no SQL or filter-expression language, and no
unauthenticated mode. A batch of twenty cards is twenty calls, each refused or recorded on its own.

## What a refusal looks like

A tool that refuses is a tool that worked. The answer is a **result** with `isError: true` and the
operation's own sentence — not a thrown error, not a 500:

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

The `structuredContent.error` is stable, and it is the same vocabulary `/api/v1` uses:
`wip_blocked`, `reason_required`, `section_fixed`, `parent_invalid`, `stale`, `role_forbidden`,
`invalid`, `not_found`. An agent can tell a person what happened and try the right thing next, rather
than retrying a bare failure.

A read-only token's `tools/list` contains **no write tool at all** — not one that refuses, which would
invite an agent to argue with it.

## The rule

An agent writes what a person asked for. It may choose the words of a card it was asked to file; it
may not invent work, and nothing in this server will do it for the model.

## Out of scope, on purpose

- **Prompts and sampling.** This is a server that lets an agent read and write the board, not a chat
  product inside Kanban Toolkit.
- **Server-initiated streams.** No `GET /mcp` event stream: the tools are request/response, and a
  stream nobody uses is a connection somebody has to keep alive.
- **An unauthenticated local mode.** The trail has to be able to say who acted.
