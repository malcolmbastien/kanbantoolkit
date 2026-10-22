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
import { d1 } from './d1'

export interface Env {
  /** The error log. Absent until the database is created — see the README. */
  DB?: D1Database
  /** Mixed into the address hash, so the table holds a hash rather than a person's address. */
  ERROR_SALT?: string
}

const app = createApp({
  database: (env) => {
    const bound = (env as Env).DB
    return bound ? d1(bound) : undefined
  },
  clientIp: (request) => request.headers.get('cf-connecting-ip') ?? 'unknown',
  salt: (env) => (env as Env).ERROR_SALT ?? 'flowline',
})

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx)
  },
}
