/**
 * The live channel's portable half: the bell, and who may listen.
 *
 * The transports are per-runtime — a Durable Object, a socket server — but the two questions they
 * share are these: does a nudge reach every listener of *that* workspace, and is the person on the
 * other end allowed to be there. Both are answered here, so the entries only wire.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { LIVE_PATH, listeners, liveCaller, publish, subscribe } from './live'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

async function world() {
  const db = database()
  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  const request = (path: string, init?: RequestInit) => app.request(path, init, { AUTH_DEV: '1' })
  const response = await request('/api/auth/dev', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ada@example.com' }),
  })
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0]
  return { db, request, cookie }
}

describe('the bell', () => {
  it('rings every listener of a workspace, and only that workspace', () => {
    const heard: number[] = []
    const elsewhere: number[] = []
    const off = subscribe('workspace', (nudge) => heard.push(nudge.revision))
    const offOther = subscribe('another', (nudge) => elsewhere.push(nudge.revision))

    publish('workspace', 7)
    expect(heard).toEqual([7])
    expect(elsewhere).toEqual([])
    expect(listeners('workspace')).toBe(1)

    // A closed connection is a listener that stops hearing, not an error to clean up later.
    off()
    publish('workspace', 8)
    expect(heard).toEqual([7])
    expect(listeners('workspace')).toBe(0)
    offOther()
  })

  it('does not let one broken listener stop the others', () => {
    const heard: number[] = []
    const offBad = subscribe('workspace', () => {
      throw new Error('that socket has gone')
    })
    const offGood = subscribe('workspace', (nudge) => heard.push(nudge.revision))

    expect(() => publish('workspace', 3)).not.toThrow()
    expect(heard).toEqual([3])
    offBad()
    offGood()
  })
})

describe('who may listen', () => {
  it('is the session, checked the way the API checks it', async () => {
    const { db, cookie } = await world()

    // No cookie, a cookie that is not a session, and a session that is somebody — three answers,
    // and only the last one opens a channel.
    expect(await liveCaller(db, {}, undefined, 'http://x/')).toBeUndefined()
    expect(await liveCaller(db, {}, 'fl_session=nonsense', 'http://x/')).toBeUndefined()

    const caller = await liveCaller(db, {}, cookie, 'http://x/')
    expect(caller?.workspaceRole).toBe('admin')
    expect(caller?.user.email).toBe('ada@example.com')
  })

  it('is refused to somebody who is not a member of this instance', async () => {
    const { db } = await world()
    await db.run("INSERT INTO users (id, name, email) VALUES ('stranger', 'Stranger', 'stranger@example.com')")
    // A session row with no membership: the door is what makes a socket a place in a workspace.
    await db.run(
      "INSERT INTO sessions (id, public_id, user_id, expires_at) VALUES ('abc', 'abc', 'stranger', '2999-01-01T00:00:00.000Z')",
    )
    // The token's hash, not the token: the row is keyed by the fingerprint.
    const { sha256 } = await import('./auth/oauth')
    const token = 'a-real-token'
    await db.run('UPDATE sessions SET id = ?1 WHERE id = ?2', [await sha256(token), 'abc'])
    expect(await liveCaller(db, {}, `fl_session=${token}`, 'http://x/')).toBeUndefined()
  })
})

describe('the route', () => {
  it('is mounted where the API catch-all cannot shadow it', async () => {
    // The entry hands over its own transport; this stands in for it, because the transport itself
    // is a socket and not a response.
    const app = createApp(
      { database: () => database(), clientIp: () => 'x' },
      { live: (c) => c.text('the channel') },
    )
    const response = await app.request(LIVE_PATH, {}, {})
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('the channel')
  })

  it('says the path is not there when the entry has no channel', async () => {
    const app = createApp({ database: () => database(), clientIp: () => 'x' })
    const response = await app.request(LIVE_PATH, {}, {})
    expect(response.status).toBe(404)
  })
})
