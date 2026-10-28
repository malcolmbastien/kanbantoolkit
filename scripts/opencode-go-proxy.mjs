#!/usr/bin/env node
// Tiny reverse proxy that lets Taskmaster (or any OpenAI-compatible client) talk
// to the OpenCode Go gateway, which requires an `x-opencode-session` routing
// header that those clients do not send.
//
//   client  ──▶  http://localhost:8788/v1/...  ──▶  https://opencode.ai/zen/go/v1/...
//
// Zero dependencies. Dev tooling only — the Kanban Toolkit app runtime never uses this.

import http from 'node:http'

const PORT = Number(process.env.OPENCODE_GO_PROXY_PORT ?? 8788)
const TARGET = 'https://opencode.ai/zen/go'
const SESSION = process.env.OPENCODE_GO_SESSION ?? crypto.randomUUID()
const UA = 'kanbantoolkit-taskmaster/0.1'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'content-encoding',
  'host',
])

const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks)

  const upstreamUrl = `${TARGET}${req.url}`
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v
  }
  headers['x-opencode-session'] = SESSION
  headers['user-agent'] = UA

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      duplex: 'half',
    })

    res.writeHead(upstream.status, Object.fromEntries(
      [...upstream.headers].filter(([k]) => !HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== 'content-length'),
    ))

    if (upstream.body) {
      for await (const chunk of upstream.body) res.write(chunk)
    }
    res.end()
  } catch (err) {
    console.error(`[opencode-go-proxy] ${req.method} ${req.url} failed:`, err)
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: String(err) } }))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[opencode-go-proxy] listening on http://127.0.0.1:${PORT}`)
  console.log(`[opencode-go-proxy] forwarding to ${TARGET} (session ${SESSION})`)
})
