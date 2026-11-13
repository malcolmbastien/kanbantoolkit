import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fileBackups } from './file-backup'
import { fromSqlite } from './sqlite'

const MIGRATIONS = new URL('../migrations/', import.meta.url)
let scratch: string | undefined

function database(): Database {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

function liveFile(): string {
  scratch = mkdtempSync(join(tmpdir(), 'kanbantoolkit-backup-routes-'))
  const path = join(scratch, 'kanbantoolkit.db')
  const raw = new DatabaseSync(path)
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  raw.exec(`
    INSERT INTO boards (id, name, band, description, position, workspace_id)
      VALUES ('b-1', 'Atlas', 'team', 'Kept.', 0, 'workspace');
    INSERT INTO items (id, title, type_id, created_at, rev, workspace_id)
      VALUES ('i-1', 'A card', 't-card', 1700000000000, 1, 'workspace');
  `)
  raw.close()
  return path
}

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
  scratch = undefined
})

const cookie = (response: Response) =>
  `fl_session=${(response.headers.get('set-cookie') ?? '').match(/fl_session=([^;]+)/)?.[1] ?? ''}`

async function world(withFiles: boolean) {
  const db = database()
  const app = createApp({
    database: () => db,
    clientIp: () => '203.0.113.9',
    ...(withFiles ? { backups: fileBackups(liveFile()) } : {}),
  })
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, { AUTH_DEV: '1' })
  const signed = cookie(
    await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com' }),
    }),
  )
  return { request, signed }
}

describe('backups from Admin', () => {
  it('reports the provider capability when the runtime has no filesystem', async () => {
    const { request, signed } = await world(false)
    const list = (await (await request('/api/admin/backups', { headers: { cookie: signed } })).json()) as {
      mode: string
      backups: unknown[]
    }
    expect(list).toEqual({ mode: 'provider', backups: [] })
    const create = await request('/api/admin/backups', { method: 'POST', headers: { cookie: signed } })
    expect(create.status).toBe(409)
    expect(await create.json()).toMatchObject({ code: 'provider_backup' })
  })

  it('takes, lists, downloads and verifies a file copy', async () => {
    const { request, signed } = await world(true)
    const created = await request('/api/admin/backups', { method: 'POST', headers: { cookie: signed } })
    expect(created.status).toBe(201)
    const copy = (await created.json()) as { name: string; bytes: number }
    expect(copy.bytes).toBeGreaterThan(0)

    const list = (await (await request('/api/admin/backups', { headers: { cookie: signed } })).json()) as {
      mode: string
      backups: Array<{ name: string }>
    }
    expect(list.mode).toBe('file')
    expect(list.backups.map((entry) => entry.name)).toEqual([copy.name])

    const download = await request(`/api/admin/backups/${copy.name}`, { headers: { cookie: signed } })
    expect(download.status).toBe(200)
    expect(download.headers.get('content-disposition')).toContain(copy.name)
    const bytes = new Uint8Array(await download.arrayBuffer())

    const staged = await request('/api/admin/backups/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', cookie: signed },
      body: bytes,
    })
    expect(staged.status).toBe(200)
    expect(await staged.json()).toMatchObject({ staged: true, boards: 1, items: 1 })
  }, 20_000)
})
