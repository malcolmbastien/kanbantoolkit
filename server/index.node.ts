/**
 * The Node entry — the self-hosted one.
 *
 * It knows about a port, a file and a directory of static assets, and nothing else. The routes are
 * the same object the Worker exports, so a self-hosted instance and the hosted one cannot drift
 * apart without this file changing.
 *
 *   PORT=8787 DB_PATH=./flowline.db STATIC_DIR=./dist npm run server
 *
 * This is the entry `task 129` proves in CI. The packaged image is task 128's job.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { serve, upgradeWebSocket } from '@hono/node-server'
import type { Handler } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { WebSocketServer } from 'ws'
import { createApp } from './app'
import { liveCaller, publish, subscribe } from './live'
import { WORKSPACE_ID } from './auth/session'
import { migrate } from './migrate'
import type { Migration } from './migrate'
import { openSqlite } from './sqlite'

const port = Number(process.env.PORT ?? 8787)
const databasePath = process.env.DB_PATH ?? 'flowline.db'
const staticDir = process.env.STATIC_DIR ?? './dist'
const db = openSqlite(databasePath)

// Before the first request: a migration transforms what is there, and a failure stops the process
// rather than serving a database this code does not understand.
const migrationsDir = new URL('../migrations/', import.meta.url)
const migrations: Migration[] = readdirSync(migrationsDir)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort()
  .map((file) => ({
    version: Number(file.slice(0, 4)),
    name: file,
    sql: readFileSync(new URL(file, migrationsDir), 'utf8'),
  }))

const schema = await migrate(db, migrations)
console.log(`flowline schema v${schema.version}${schema.applied.length ? ` (applied ${schema.applied.join(', ')})` : ''}`)

/**
 * The live channel is this process's own: one socket server, one map of listeners. It is switched
 * off by `LIVE=0`, which is how CI exercises the fallback an instance with no socket server would
 * use — the same client code, polling the same feed.
 */
const live = process.env.LIVE !== '0'

const app = createApp(
  {
    database: () => db,
    // The runtime's own header. A self-hoster behind a proxy gets the forwarded address; anyone
    // else gets `unknown` rather than a guess.
    clientIp: (request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    // The bell, from this runtime's side: one process, one map of listeners.
    ...(live && { live: { publish: (_env: unknown, workspaceId: string, revision: number) => publish(workspaceId, revision) } }),
  },
  {
    /**
     * The channel, as this runtime has it: the guard reads the same cookie the API does, and then
     * the upgrade runs. A connection that fails the guard is refused before the upgrade rather
     * than opened and closed, so an unauthenticated browser never holds one.
     */
    ...(live && {
      live: ((): Handler<{ Bindings: object }> => {
            const upgrade = upgradeWebSocket(() => {
              let off: (() => void) | undefined
              return {
                onOpen: (_event: unknown, ws: { send(data: string): void }) => {
                  // A nudge, never a payload: the client reads the feed it already knows how to read.
                  off = subscribe(WORKSPACE_ID, (nudge) => {
                    try {
                      ws.send(JSON.stringify(nudge))
                    } catch {
                      // A socket that has gone is removed when it closes.
                    }
                  })
                },
                onClose: () => off?.(),
                onError: () => off?.(),
              }
            })
            return async (c: Parameters<typeof upgrade>[0], next: () => Promise<void>) => {
              const caller = await liveCaller(db, c.env, c.req.header('cookie'), c.req.url)
              if (!caller) return c.json({ error: 'sign in to listen' }, 401)
              return upgrade(c, next)
            }
      })(),
    }),
  },
)

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/** A file inside the static directory, or nothing — never a path that climbs out of it. */
function staticFile(pathname: string): string | undefined {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  const full = join(staticDir, clean)
  if (!full.startsWith(normalize(staticDir))) return undefined
  if (existsSync(full) && statSync(full).isFile()) return full
  // A page lives at a directory: `/install/` is `dist/install/index.html`.
  const index = join(full, 'index.html')
  return existsSync(index) && statSync(index).isFile() ? index : undefined
}

// Files first: the site's stylesheet and drawings, the app's chunks, robots and sitemap.
app.use('*', serveStatic({ root: staticDir }))

/**
 * The app, under `/app` and only there (task 151). `/app` and anything beneath it is the app's own
 * document, because the board's places are a query string, not a path.
 */
app.get('/app', () => {
  const page = join(staticDir, 'app/index.html')
  return new Response(readFileSync(page), { headers: { 'content-type': TYPES['.html'] } })
})
app.get('/app/*', () => {
  const page = join(staticDir, 'app/index.html')
  return new Response(readFileSync(page), { headers: { 'content-type': TYPES['.html'] } })
})

/**
 * Everything else is a page of the site, or nothing.
 *
 * The single-page fallback is gone on purpose: an unknown address answers the 404 page *with a 404*,
 * so a crawler and a person are told the same true thing.
 */
app.get('*', (c) => {
  const page = staticFile(new URL(c.req.url).pathname)
  if (page) {
    return new Response(readFileSync(page), { headers: { 'content-type': TYPES[extname(page)] ?? 'application/octet-stream' } })
  }
  const notFound = join(staticDir, '404.html')
  return new Response(existsSync(notFound) ? readFileSync(notFound) : 'Not found', {
    status: 404,
    headers: { 'content-type': TYPES['.html'] },
  })
})

// `noServer` because the HTTP server decides what upgrades: the adapter hands every upgrade to the
// route above, and a path that is not the channel is answered as a request.
const sockets = new WebSocketServer({ noServer: true })

// The adapter hands its own bindings alongside the request — that is where the socket server and
// the incoming message live, keyed by symbols the upgrade needs back on the *same* object — so the
// environment is copied onto them rather than into a new object.
serve(
  {
    fetch: (request, bindings) => {
      const env = bindings && typeof bindings === 'object' ? Object.assign(bindings, process.env) : process.env
      return app.fetch(request, env)
    },
    port,
    websocket: { server: sockets },
  },
  (info) => {
    // The port is printed because a smoke test and a container both need to know it, and `PORT=0`
    // is how a test avoids colliding with whatever else is on the machine.
    console.log(`flowline listening on http://127.0.0.1:${info.port}`)
    if (!live) console.log('live channel off: clients will poll the feed')
  },
)
