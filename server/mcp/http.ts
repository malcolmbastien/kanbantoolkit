/**
 * MCP over Streamable HTTP (task 170).
 *
 * One `POST /mcp`, a bearer token, a JSON-RPC message in and (unless it was a notification) a
 * JSON-RPC answer out, as `application/json`. Stateless on purpose: no `Mcp-Session-Id` to keep, no
 * server-initiated stream to hold open, so a restart or a second instance costs a client nothing.
 * `GET /mcp` is answered `405`, which is what the transport spec says a server that offers no
 * server-to-client stream should do — better than a hanging request that looks like a failure.
 *
 * The door is the same one `/api/v1` uses (`requireToken`): a session cookie is refused with the
 * sentence that says to acquire a token, and the caller is the token's owner with the token's scopes.
 */

import { Hono } from 'hono'
import type { Runtime } from '../runtime'
import { requireToken, type V1Vars } from '../v1/routes'
import { limitPerMinute, spend } from '../rate-limit'
import { handleRpc } from './protocol'

export function mcpRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object; Variables: V1Vars }>()

  routes.post('/', async (c) => {
    const caller = await requireToken(c, runtime)
    if (caller instanceof Response) return caller

    // The same per-token window `/api/v1` spends from. A whole-workspace read over MCP is one of
    // the most expensive requests a token can make, and the limit is about the credential rather
    // than the door it came through. Spend before parsing: every POST is a request.
    const limit = limitPerMinute(c.env)
    const spent = spend(caller.tokenId, limit)
    c.header('RateLimit-Limit', String(limit))
    c.header('RateLimit-Remaining', String(spent.remaining))
    c.header('RateLimit-Reset', String(spent.reset))
    if (!spent.allowed) {
      c.header('Retry-After', String(spent.reset))
      return c.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32000,
            message: `this token may make ${limit} requests a minute; try again in ${spent.reset}s`,
          },
        },
        429,
      )
    }

    const message = await c.req.json().catch(() => undefined)
    if (message === undefined) {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'the body is not JSON' } }, 400)
    }

    const answer = await handleRpc(caller, message)
    // A notification is 202 with no body: there is nothing to say to a client that asked nothing.
    return answer.body === undefined ? c.body(null, 202) : c.json(answer.body as never, answer.status as 200)
  })

  routes.get('/', (c) => {
    c.header('Allow', 'POST')
    return c.json(
      { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'this server offers no server-to-client stream; POST a JSON-RPC message instead' } },
      405,
    )
  })

  return routes
}
