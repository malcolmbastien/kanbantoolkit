/**
 * The second runtime, booted for real.
 *
 * The Worker has wrangler and the e2e suite; the Node entry had nothing, which is how a second
 * target rots. This starts `server/index.node.ts` exactly as a self-hoster would — a built client, a
 * database file, migrations applied — and uses the API the way the app does.
 *
 * Run after `npm run build`, because it serves the build.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')

if (!existsSync(join(dist, 'index.html'))) fail('run `npm run build` first — the Node entry serves the build')

const workspace = mkdtempSync(join(tmpdir(), 'kanbantoolkit-node-'))
const databasePath = join(workspace, 'kanbantoolkit.db')

function fail(message) {
  console.error(`smoke: ${message}`)
  process.exit(1)
}


/** Wait for the entry to say which port it took, since the test asks for port 0. */
function listening(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the entry did not start in 20s')), 20_000)
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
      const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`the entry exited with ${code}\n${output}`))
    })
  })
}

const checks = []
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail })
  if (!condition) console.error(`  not ok — ${name}${detail ? `: ${detail}` : ''}`)
}


const child = spawn(join(root, 'node_modules/.bin/tsx'), ['server/index.node.ts'], {
  cwd: root,
  env: { ...process.env, PORT: '0', DB_PATH: databasePath, STATIC_DIR: dist, ERROR_SALT: 'smoke' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

try {
  const base = await listening(child)

  const health = await fetch(`${base}/api/health`)
  check('health answers 200', health.status === 200, String(health.status))
  check('health says the database is reachable', (await health.json()).database === 'ok')

  // An instance is the application (task 173): `/` sends you to it, and the app's document answers
  // any path beneath `/app`, because a place in a board is a query string rather than a path.
  const root = await fetch(`${base}/`, { redirect: 'manual' })
  check('/ sends you to the app', root.status === 302 && root.headers.get('location') === '/app', `${root.status} → ${root.headers.get('location')}`)

  const page = await fetch(`${base}/app?board=b-atlas&item=init-signup`)
  check('a deep link serves the app', page.status === 200, String(page.status))
  check('a deep link serves HTML', (page.headers.get('content-type') ?? '').includes('text/html'))

  const shell = await (await fetch(`${base}/app`)).text()
  const asset = shell.match(/src="(\/assets\/[^"]+)/)?.[1]
  check('the app document names its own chunk', Boolean(asset), asset ?? 'none')
  if (asset) {
    const chunk = await fetch(`${base}${asset}`)
    check('the app’s chunk is served', chunk.status === 200, String(chunk.status))
  }
  check('the icon is served', (await fetch(`${base}/favicon.svg`)).status === 200)

  // The project's site is not part of an instance: its pages are in the same build and must not be
  // reachable from somebody's deployment.
  for (const path of ['/install/', '/product/', '/privacy/', '/terms/', '/security/', '/sitemap.xml', '/security.txt']) {
    check(`${path} is not an instance page`, (await fetch(`${base}${path}`)).status === 404, path)
  }

  const missing = await fetch(`${base}/no/such/place`)
  check('an unknown path is a 404', missing.status === 404, String(missing.status))
  check('the 404 is the instance’s own', (await missing.text()).includes('Kanban Toolkit instance for'))
  check('an instance is not indexed', (await (await fetch(`${base}/robots.txt`)).text()).includes('Disallow: /'))

  const report = await fetch(`${base}/api/errors`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'smoke', stack: '', url: '/?board=b-atlas', view: 'board', release: 'ci', ua: 'smoke' }),
  })
  check('a report is accepted', report.status === 204, String(report.status))

  const large = await fetch(`${base}/api/errors`, { method: 'POST', body: 'x'.repeat(9 * 1024) })
  check('an oversized body is refused', large.status === 413, String(large.status))

  const method = await fetch(`${base}/api/errors`)
  check('a method the endpoint does not have is refused', method.status === 405, String(method.status))

  const rows = new DatabaseSync(databasePath)
  const stored = rows.prepare('SELECT COUNT(*) AS n FROM errors').get()
  check('the report was stored', stored.n === 1, String(stored.n))
  rows.close()
} catch (error) {
  checks.push({ name: 'the entry ran', ok: false, detail: error.message })
  console.error(`  not ok — the entry ran: ${error.message}`)
} finally {
  child.kill('SIGTERM')
  rmSync(workspace, { recursive: true, force: true })
}

const failed = checks.filter((c) => !c.ok)
console.log(`\nNode entry: ${checks.length - failed.length}/${checks.length} checks passed.`)
if (failed.length) {
  console.error('The Node runtime is not behaving like the Worker. That is the seam failing.')
  process.exit(1)
}
