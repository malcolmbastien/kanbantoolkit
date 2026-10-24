/**
 * The Cloudflare entry.
 *
 * It wires bindings to the application and does nothing else: the routes live in `server/`, which
 * runs unchanged on a machine someone owns. If a route, a query or a rule is ever written here, it
 * has been written in the one file a self-hoster cannot run.
 *
 * `/api/*` reaches this Worker because `wrangler.jsonc` says so; every other path is answered by the
 * asset router without this script running at all.
 */

import { createApp } from '../server/app'
import { liveCaller } from '../server/live'
import { WORKSPACE_ID } from '../server/auth/session'
import { d1 } from './d1'

export { WorkspaceChannel } from './channel'

export interface Env {
  /** The error log. Absent until the database is created — see the README. */
  DB?: D1Database
  /** Mixed into the address hash, so the table holds a hash rather than a person's address. */
  ERROR_SALT?: string
  /** The live channel: one Durable Object per workspace. See `channel.ts`. */
  WORKSPACE_CHANNEL?: DurableObjectNamespace
}

const database = (env: unknown) => {
  const bound = (env as Env).DB
  return bound ? d1(bound) : undefined
}

const app = createApp(
  {
    database,
    clientIp: (request) => request.headers.get('cf-connecting-ip') ?? 'unknown',
    /**
     * The channel, from this runtime's side: the write path rings the workspace's object, which
     * fans the nudge out to the sockets it holds. A deployment without the binding is a deployment
     * whose clients poll — which is the same feed, two seconds behind.
     */
    live: {
      publish: async (env, workspaceId, revision) => {
        const binding = (env as Env).WORKSPACE_CHANNEL
        if (!binding) return
        try {
          await binding.get(binding.idFromName(workspaceId)).fetch('https://channel/publish', {
            method: 'POST',
            body: JSON.stringify({ revision }),
          })
        } catch {
          // A nudge that could not be delivered is a change the other device reads on its next
          // poll. It must never fail the write that caused it.
        }
      },
    },
  },
  {
    /**
     * The socket, from this runtime's side. The guard runs first — the same cookie, the same
     * membership — and the upgrade is then handed to the workspace's object, which is the only
     * place that can see every listener.
     */
    live: async (c) => {
      const env = c.env as Env
      const db = database(env)
      if (!db) return c.json({ error: 'not configured' }, 503)

      const caller = await liveCaller(db, env, c.req.header('cookie'), c.req.url)
      if (!caller) return c.json({ error: 'sign in to listen' }, 401)

      const binding = env.WORKSPACE_CHANNEL
      if (!binding) return c.json({ error: 'this instance has no live channel' }, 503)

      return binding.get(binding.idFromName(WORKSPACE_ID)).fetch(c.req.raw)
    },
  },
)

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx)
  },
}
