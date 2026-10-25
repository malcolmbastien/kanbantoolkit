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
import { WebSocketServer } from 'ws'
import { createApp } from './app'
import { consoleMailer } from './mail'
import { smtpMailer } from './mail-smtp'
import { liveCaller, publish, subscribe } from './live'
import { WORKSPACE_ID } from './auth/session'
import { migrate } from './migrate'
import type { Migration } from './migrate'
import { openSqlite } from './sqlite'
import { workspaceName } from './config'

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

/**
 * Mail, if this machine has a relay.
 *
 * `MAIL_CONSOLE=1` writes messages to the log instead — development, and the e2e lane, which must not
 * open a socket to somebody's mail server. Otherwise `SMTP_URL` and `MAIL_FROM` decide, and without
 * both there is no mailer at all: the magic-link door is absent rather than broken.
 */
const mail = process.env.MAIL_CONSOLE === '1' ? consoleMailer() : smtpMailer(process.env)

/**
 * The version this instance is, read once from the package it shipped with.
 *
 * The image carries `package.json` for exactly this, and `/api/health` reports it — so three
 * containers on three machines can be told apart by curling them, rather than by remembering.
 */
const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }).version

const app = createApp(
  {
    database: () => db,
    // The runtime's own header. A self-hoster behind a proxy gets the forwarded address; anyone
    // else gets `unknown` rather than a guess.
    clientIp: (request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    // The bell, from this runtime's side: one process, one map of listeners.
    ...(live && { live: { publish: (_env: unknown, workspaceId: string, revision: number) => publish(workspaceId, revision) } }),
    ...(mail && { mail }),
    ...(version && { version }),
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

/**
 * The page an instance answers a wrong address with.
 *
 * Self-contained — no stylesheet, no script, no link into the project's site — and it names the
 * workspace, because an address that does not exist raises exactly one question: which deployment is
 * this? The only way on is the application.
 */
function notFoundPage(workspace: string): string {
  const name = workspace.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Not found — ${name}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <style>
      :root { color-scheme: light }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: #ffffff; color: #172b3c;
        font: 16px/1.65 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        padding: 2rem;
      }
      main { max-width: 28rem }
      p { color: #526374 }
      a { color: #086dbf; font-weight: 600 }
      code { background: #f4f7fa; padding: 0.1em 0.35em; border-radius: 4px }
    </style>
  </head>
  <body>
    <main>
      <h1>There is nothing at this address.</h1>
      <p>This is the Flowline instance for <strong>${name}</strong>. The application is at <code>/app</code>.</p>
      <p><a href="/app">Open the board</a></p>
    </main>
  </body>
</html>
`
}

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

/**
 * A file **an instance serves**, or nothing — never a path that climbs out of the static directory.
 *
 * The allowlist is the point (task 173): an instance is the application, so it serves the app's own
 * document and assets, its icon, and nothing else. The project's site pages live in the same build
 * and are deliberately not reachable here — a team's instance should not answer `/install/` with
 * this project's marketing page or `/privacy/` with a notice about the demo.
 */
function staticFile(pathname: string): string | undefined {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  const full = join(staticDir, clean)
  if (!full.startsWith(normalize(staticDir))) return undefined
  if (existsSync(full) && statSync(full).isFile()) return full
  // A page lives at a directory: `/install/` is `dist/install/index.html`.
  const index = join(full, 'index.html')
  return existsSync(index) && statSync(index).isFile() ? index : undefined
}

/**
 * What an instance answers.
 *
 * It is the application and nothing else (task 173): `/` sends you to the app, the app's own document
 * and assets are served, the API answers under `/api`, and every other address is this instance's
 * 404. The project's site — `/install/`, `/product/`, `/privacy/`, its sitemap and its `security.txt`
 * — is not part of an instance and is not served here.
 */
app.get('/', (c) => c.redirect('/app', 302))

/** The app's document, at `/app` and anywhere beneath it: a place in a board is a query string. */
const shell = () => new Response(readFileSync(join(staticDir, 'app/index.html')), { headers: { 'content-type': TYPES['.html'] } })
app.get('/app', shell)
app.get('/app/*', shell)

/** The app's own files: its chunks under `/assets`, and the icon its document asks for. */
app.get('/assets/*', (c) => {
  const file = staticFile(new URL(c.req.url).pathname)
  if (!file) return c.notFound()
  return new Response(readFileSync(file), { headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' } })
})
app.get('/favicon.svg', () => new Response(readFileSync(join(staticDir, 'favicon.svg')), { headers: { 'content-type': TYPES['.svg'] } }))

/** An instance is one team's private work: no crawler has any business here. */
app.get('/robots.txt', () => new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': TYPES['.txt'] } }))

/**
 * Everything else is nothing, and says so with a 404 — the instance's own page, not the project's.
 * It names the workspace, because "which deployment am I looking at" is the question a wrong address
 * actually raises.
 */
app.notFound((c) => {
  if (c.req.method !== 'GET') return c.json({ error: 'not found' }, 404)
  return new Response(notFoundPage(workspaceName(process.env)), {
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
