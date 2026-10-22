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

import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app'
import { openSqlite } from './sqlite'

const port = Number(process.env.PORT ?? 8787)
const databasePath = process.env.DB_PATH ?? 'flowline.db'
const staticDir = process.env.STATIC_DIR ?? './dist'
const salt = process.env.ERROR_SALT ?? 'flowline'

const db = openSqlite(databasePath)

const app = createApp({
  database: () => db,
  // The runtime's own header. A self-hoster behind a proxy gets the forwarded address; anyone
  // else gets `unknown` rather than a guess.
  clientIp: (request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
  salt: () => salt,
})

// The client, served the way the asset router serves it: files first, and the app for every other
// path, so a deep link opens the board rather than a 404. Registered after the API, which answers
// its own paths and never falls through to here.
app.use('*', serveStatic({ root: staticDir }))
app.get('*', serveStatic({ path: `${staticDir}/index.html` }))

serve({ fetch: app.fetch, port }, (info) => {
  // The port is printed because a smoke test and a container both need to know it, and `PORT=0`
  // is how a test avoids colliding with whatever else is on the machine.
  console.log(`flowline listening on http://127.0.0.1:${info.port}`)
})
