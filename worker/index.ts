/**
 * The Worker behind the app: static assets, and one endpoint that accepts error reports.
 *
 * `/api/*` is routed here by `assets.run_worker_first`; everything else is answered by the asset
 * router without the script running at all. The endpoint is the only server-side surface today,
 * and it is deliberately small: validate, cap, store, answer.
 */

import { parseReport } from './report'

export interface Env {
  ASSETS: Fetcher
  /** The error log. Absent until the database is created — see the README. */
  DB?: D1Database
  /** Mixed into the address hash, so the table holds a hash rather than a person's address. */
  ERROR_SALT?: string
}

/** A report is a few kilobytes at most; anything larger is not one of ours. */
const MAX_BODY = 8 * 1024
/** One address may report this many failures an hour before the endpoint stops listening. */
const PER_HOUR = 30

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function errors(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  // The binding arrives with the database. Until then the endpoint says so rather than failing
  // in a way that looks like the app is broken.
  if (!env.DB) return json({ error: 'not configured' }, 503)

  const body = await request.text()
  if (body.length > MAX_BODY) return json({ error: 'too large' }, 413)

  let input: unknown
  try {
    input = JSON.parse(body)
  } catch {
    return json({ error: 'invalid json' }, 400)
  }
  const report = parseReport(input)
  if (!report) return json({ error: 'invalid report' }, 400)

  // The address is hashed with a salt: enough to slow a flood, not enough to identify anyone.
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const ipHash = await hash(`${ip}:${env.ERROR_SALT ?? 'flowline'}`)
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  try {
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM errors WHERE ip_hash = ?1 AND at >= ?2')
      .bind(ipHash, since)
      .first<{ n: number }>()
    if ((recent?.n ?? 0) >= PER_HOUR) return json({ error: 'too many reports' }, 429)

    await env.DB.prepare(
      'INSERT INTO errors (message, stack, url, view, release, ua, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
    )
      .bind(report.message, report.stack, report.url, report.view, report.release, report.ua, ipHash)
      .run()
  } catch {
    // A database that cannot be reached is not the reporter's fault, and must not look like a
    // rejected report either.
    return json({ error: 'not configured' }, 503)
  }

  return new Response(null, { status: 204 })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/errors') return errors(request, env)
    if (pathname.startsWith('/api/')) return json({ error: 'not found' }, 404)
    return env.ASSETS.fetch(request)
  },
}
