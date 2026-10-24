// A static host for `dist/`, with the one route the build needs.
//
// `/app` and everything beneath it is the app's document — a place in the board is a query string,
// so the path never varies. Every other path is a file, or the 404 page **with a 404**. Cloudflare
// expresses this with `_redirects` and `not_found_handling`; the Node entry expresses it in code.
// This expresses it again, in forty lines, for two jobs: the e2e lane that proves the build works
// with no API server at all, and `npm run preview` for anybody who wants to look.
//
//   node scripts/serve-dist.mjs            # http://127.0.0.1:4173
//   PORT=8080 STATIC_DIR=dist node scripts/serve-dist.mjs

import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const DIST = process.env.STATIC_DIR ?? 'dist'
const PORT = Number(process.env.PORT ?? 4173)

const TYPES = {
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

/** A file inside the build, or the page a directory stands for — never a path that climbs out. */
function staticFile(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  const full = join(DIST, clean)
  if (!full.startsWith(normalize(DIST))) return undefined
  if (existsSync(full) && statSync(full).isFile()) return full
  const index = join(full, 'index.html')
  return existsSync(index) && statSync(index).isFile() ? index : undefined
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  const app = pathname === '/app' || pathname.startsWith('/app/')
  const page = staticFile(app ? '/app/index.html' : pathname)

  if (page) {
    response.writeHead(200, { 'content-type': TYPES[extname(page)] ?? 'application/octet-stream' })
    response.end(readFileSync(page))
    return
  }

  const notFound = join(DIST, '404.html')
  response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
  response.end(existsSync(notFound) ? readFileSync(notFound) : 'Not found')
})

server.listen(PORT, () => console.log(`serving dist/ on http://127.0.0.1:${PORT}`))
