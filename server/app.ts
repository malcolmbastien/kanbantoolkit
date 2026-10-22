/**
 * The whole API, as one `fetch` handler.
 *
 * Nothing here knows which machine it is running on. A Worker exports this app; a Node process
 * serves it. The three things that are genuinely per-runtime arrive through `Runtime`, so they are
 * named in one place rather than scattered as conditionals:
 *
 * - the database, which is a binding on Cloudflare and a file on a self-hosted instance;
 * - the client's address, which is a header either way but not the same one;
 * - the salt mixed into the stored hash, which is configuration everywhere.
 */

import { Hono } from 'hono'
import type { Database } from './db'
import { parseReport } from './report'

export interface Runtime {
  /** The database for this request, or undefined when the deployment has none configured. */
  database(env: unknown): Database | undefined
  /** The address that made the request, as the runtime sees it. */
  clientIp(request: Request): string
  /** Mixed into the stored hash, so the table holds a hash rather than a person's address. */
  salt(env: unknown): string
}

/** A report is a few kilobytes at most; anything larger is not one of ours. */
const MAX_BODY = 8 * 1024
/** One address may report this many failures an hour before the endpoint stops listening. */
const PER_HOUR = 30

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function createApp(runtime: Runtime) {
  // `object` rather than a shape: the app never reads a binding itself. Whatever the runtime
  // passes arrives at `Runtime`, which is the only code that knows what a binding is.
  const app = new Hono<{ Bindings: object }>()

  /**
   * Whether this instance can serve. It asks the database rather than assuming, so a deployment
   * whose storage is misconfigured says so instead of answering 200 and failing later.
   */
  app.get('/api/health', async (c) => {
    const db = runtime.database(c.env)
    if (!db) return c.json({ ok: false, database: 'not configured' }, 503)
    try {
      await db.get('SELECT 1 AS one')
      return c.json({ ok: true, database: 'ok' })
    } catch {
      return c.json({ ok: false, database: 'unreachable' }, 503)
    }
  })

  app.post('/api/errors', async (c) => {
    // The binding arrives with the database. Until then the endpoint says so rather than failing
    // in a way that looks like the app is broken.
    const db = runtime.database(c.env)
    if (!db) return c.json({ error: 'not configured' }, 503)

    const body = await c.req.text()
    if (body.length > MAX_BODY) return c.json({ error: 'too large' }, 413)

    let input: unknown
    try {
      input = JSON.parse(body)
    } catch {
      return c.json({ error: 'invalid json' }, 400)
    }
    const report = parseReport(input)
    if (!report) return c.json({ error: 'invalid report' }, 400)

    // The address is hashed with a salt: enough to slow a flood, not enough to identify anyone.
    const ipHash = await hash(`${runtime.clientIp(c.req.raw)}:${runtime.salt(c.env)}`)
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    try {
      const recent = await db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM errors WHERE ip_hash = ?1 AND at >= ?2',
        [ipHash, since],
      )
      if ((recent?.n ?? 0) >= PER_HOUR) return c.json({ error: 'too many reports' }, 429)

      await db.run(
        'INSERT INTO errors (message, stack, url, view, release, ua, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
        [report.message, report.stack, report.url, report.view, report.release, report.ua, ipHash],
      )
    } catch {
      // A database that cannot be reached is not the reporter's fault, and must not look like a
      // rejected report either.
      return c.json({ error: 'not configured' }, 503)
    }

    return c.body(null, 204)
  })

  // The endpoint answers POST; anything else is a method it does not have, not a path it does not
  // know — and saying so is what the endpoint did before it moved here.
  app.all('/api/errors', (c) => c.json({ error: 'method not allowed' }, 405))
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

  return app
}

export type App = ReturnType<typeof createApp>
