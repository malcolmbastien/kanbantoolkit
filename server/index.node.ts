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
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app'
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

const app = createApp({
  database: () => db,
  // The runtime's own header. A self-hoster behind a proxy gets the forwarded address; anyone
  // else gets `unknown` rather than a guess.
  clientIp: (request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
})

// The client, served the way the asset router serves it: files first, and the app for every other
// path, so a deep link opens the board rather than a 404. Registered after the API, which answers
// its own paths and never falls through to here.
app.use('*', serveStatic({ root: staticDir }))
app.get('*', serveStatic({ path: `${staticDir}/index.html` }))

serve({ fetch: (request) => app.fetch(request, process.env), port }, (info) => {
  // The port is printed because a smoke test and a container both need to know it, and `PORT=0`
  // is how a test avoids colliding with whatever else is on the machine.
  console.log(`flowline listening on http://127.0.0.1:${info.port}`)
})
