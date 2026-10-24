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

import { readFileSync, readdirSync } from 'node:fs'
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

// The client, served the way the asset router serves it: files first, and the app for every other
// path, so a deep link opens the board rather than a 404. Registered after the API, which answers
// its own paths and never falls through to here.
app.use('*', serveStatic({ root: staticDir }))
app.get('*', serveStatic({ path: `${staticDir}/index.html` }))

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
