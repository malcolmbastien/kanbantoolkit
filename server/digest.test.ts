/**
 * Delivery: preferences, one digest per period, and links that stop it.
 *
 * The workspace is fixed and the clock is fixed, so the message itself can be asserted — its
 * sections, its counts, and the fact that two events in one period are one email. The mailer is a
 * list, because a test that opened a socket would be a test of somebody's relay.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { issueSession } from './auth/session'
import type { Database } from './db'
import { sendDigests } from './digest'
import { emitEvent } from './events'
import { mailToken } from './mail-token'
import type { Message } from './mail'
import { fromSqlite } from './sqlite'
import { watchItem } from './watch'
import type { Workspace } from './workspace/types'
import { writeWorkspace } from './workspace/write'
import type { Item } from '../src/domain/types'

const MIGRATIONS = new URL('../migrations/', import.meta.url)
const NOW = Date.UTC(2026, 10, 3, 8, 30, 0) // Tue 3 Nov 2026, 08:30 UTC

function database(): Database {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  title: id,
  typeId: 't-card',
  createdAt: 1,
  rev: 0,
  ...over,
})

function workspace(): Workspace {
  return {
    users: [
      { id: 'u-ada', name: 'Ada' },
      { id: 'u-grace', name: 'Grace' },
    ],
    issueTypes: [
      { id: 't-card', name: 'Card', color: '#3b82f6' },
      { id: 't-init', name: 'Initiative', color: '#7c3aed' },
    ],
    boards: [{ id: 'b-1', name: 'Team Atlas', band: 'team', description: '' }],
    flows: [
      { id: 'f-cards', boardId: 'b-1', kind: 'cards', name: 'Cards', order: 0 },
      { id: 'f-init', boardId: 'b-1', kind: 'initiatives', name: 'Initiatives', order: 0 },
    ],
    lanes: [
      { id: 'l-backlog', boardId: 'b-1', parentId: null, order: 0, name: 'Backlog', flowId: 'f-cards', stage: 'backlog' },
      { id: 'l-done', boardId: 'b-1', parentId: null, order: 1, name: 'Done', flowId: 'f-cards', stage: 'done' },
      { id: 'l-sec', boardId: 'b-1', parentId: null, order: 0, name: 'Backlog', flowId: 'f-init', stage: 'backlog' },
      { id: 'l-cell', boardId: 'b-1', parentId: 'l-sec', order: 0, name: 'Uncommitted', flowId: 'f-init' },
    ],
    items: [
      item('i-watch', { title: 'Rebuild the signup form' }),
      item('i-assigned', { title: 'Email verification', assignees: ['u-ada'] }),
      item('i-mention', { title: 'Rate-limit the gateway' }),
      item('i-init', { title: 'Signup', typeId: 't-init' }),
      item('i-due', { title: 'Ship the legal page', assignees: ['u-ada'], dueDate: '2026-11-05' }),
    ],
    placements: [
      { id: 'p-1', boardId: 'b-1', itemId: 'i-watch', laneId: 'l-backlog', laneEnteredAt: 1, rank: 0 },
      { id: 'p-2', boardId: 'b-1', itemId: 'i-assigned', laneId: 'l-backlog', laneEnteredAt: 1, rank: 1 },
      { id: 'p-3', boardId: 'b-1', itemId: 'i-mention', laneId: 'l-backlog', laneEnteredAt: 1, rank: 2 },
      { id: 'p-4', boardId: 'b-1', itemId: 'i-init', laneId: 'l-cell', laneEnteredAt: 1, rank: 0 },
      { id: 'p-5', boardId: 'b-1', itemId: 'i-due', laneId: 'l-backlog', laneEnteredAt: 1, rank: 3 },
    ],
    edges: [],
    links: [],
    objectives: [],
    periods: [],
    keyResults: [],
    boardTemplates: [],
    savedFilters: [],
    collapsedLanes: {},
    boardId: 'b-1',
  }
}

async function world(options: { mailOn?: boolean; frequency?: string; withMailer?: boolean } = {}) {
  const db = database()
  await writeWorkspace(db, workspace(), 'workspace')
  for (const [id, email] of [
    ['u-ada', 'ada@example.com'],
    ['u-grace', 'grace@example.com'],
    ['u-outside', 'outside@example.com'],
  ] as const) {
    await db.run('INSERT OR IGNORE INTO users (id, name, email) VALUES (?1, ?2, ?3)', [id, id, email])
    await db.run('INSERT OR IGNORE INTO instance_members (user_id, role) VALUES (?1, ?2)', [id, 'member'])
  }
  for (const id of ['u-ada', 'u-grace']) {
    await db.run('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, ?3)', [
      'workspace',
      id,
      id === 'u-ada' ? 'admin' : 'editor',
    ])
  }
  if (options.mailOn) {
    await db.run('UPDATE users SET mail_on = 1, mail_frequency = ?1, timezone = ?2 WHERE id = ?3', [
      options.frequency ?? 'daily',
      'UTC',
      'u-ada',
    ])
  }
  const sent: Message[] = []
  const mail = { async send(message: Message) { sent.push(message) } }
  return { db, sent, mail: options.withMailer === false ? undefined : mail }
}

const call = async (db: Database, mail: { send(message: Message): Promise<void> } | undefined) =>
  createApp({ database: () => db, clientIp: () => '203.0.113.7', ...(mail ? { mail } : {}) })

async function signedIn(db: Database, id = 'u-ada'): Promise<string> {
  return `fl_session=${(await issueSession(db, id)).token}`
}

describe('the digest', () => {
  it('is one plain-text message per period, with every reason in its own section', async () => {
    const { db, sent, mail } = await world({ mailOn: true })
    await watchItem(db, 'workspace', 'u-ada', 'i-watch')
    await watchItem(db, 'workspace', 'u-ada', 'i-mention')
    await watchItem(db, 'workspace', 'u-ada', 'i-init')

    await emitEvent(db, 'workspace', 'item.moved', {
      itemId: 'i-watch',
      title: 'Rebuild the signup form',
      boardId: 'b-1',
      laneId: 'l-done',
      fromStage: 'backlog',
      toStage: 'done',
    }, 'u-grace')
    await emitEvent(db, 'workspace', 'item.created', {
      itemId: 'i-assigned',
      title: 'Email verification',
    }, 'u-grace')
    await emitEvent(db, 'workspace', 'item.noted', {
      itemId: 'i-mention',
      entryId: 'n-1',
      mentions: ['u-ada'],
    }, 'u-grace')
    await emitEvent(db, 'workspace', 'initiative.health_changed', {
      initiativeId: 'i-init',
      before: { level: 'healthy', flags: [] },
      after: { level: 'atRisk', flags: ['blocked'] },
    }, 'u-grace')

    const report = await sendDigests(db, {
      mail,
      env: { PUBLIC_URL: 'https://atlas.example' },
      now: NOW,
    })
    expect(report).toEqual({ sent: 1, skipped: 0, unavailable: false })
    expect(sent).toHaveLength(1)

    const message = sent[0]
    expect(message.to).toBe('ada@example.com')
    expect(message.subject).toBe('Your day on Kanban Toolkit')
    expect(message.text).toContain('Changes on the work you watch')
    expect(message.text).toContain('Grace moved Rebuild the signup form from Backlog to Done')
    expect(message.text).toContain('Assigned to you')
    expect(message.text).toContain('Email verification')
    expect(message.text).toContain('You were mentioned')
    expect(message.text).toContain('Rate-limit the gateway — Grace mentioned you')
    expect(message.text).toContain('Due this week')
    expect(message.text).toContain('Ship the legal page — due Thu 5 Nov')
    expect(message.text).toContain('Watched initiatives at risk')
    expect(message.text).toContain('Signup is now at risk (was on track)')
    expect(message.text).toContain('https://atlas.example/api/mail/unsubscribe?token=')
    expect(message.text).toContain('https://atlas.example/api/mail/preferences?token=')
    expect(message.headers?.['List-Unsubscribe']).toContain('/api/mail/unsubscribe?token=')
    expect(message.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    // Plain text: no markup, no remote resource.
    expect(message.text).not.toContain('<')
    expect(message.text).not.toContain('http://track')

    // The same period is not sent twice.
    expect(await sendDigests(db, { mail, env: { PUBLIC_URL: 'https://atlas.example' }, now: NOW })).toEqual({
      sent: 0,
      skipped: 1,
      unavailable: false,
    })
    expect(sent).toHaveLength(1)
  })

  it('does not quote a card’s history that predates the watch', async () => {
    const { db, sent, mail } = await world({ mailOn: true, frequency: 'immediate' })

    // An edit before the watch, then the watch, then a change after it.
    await emitEvent(db, 'workspace', 'item.updated', { itemId: 'i-watch', fields: ['title'] }, 'u-grace')
    await watchItem(db, 'workspace', 'u-ada', 'i-watch')
    await emitEvent(
      db,
      'workspace',
      'item.blocked',
      { itemId: 'i-watch', reason: 'Needs a decision' },
      'u-grace',
    )

    expect(await sendDigests(db, { mail, now: NOW })).toMatchObject({ sent: 1 })
    expect(sent[0].text).toContain('blocked Rebuild the signup form — Needs a decision')
    expect(sent[0].text).not.toContain('edited Rebuild the signup form')
  })

  it('batches an immediate person’s events into one message, and sends nothing when there is no event', async () => {
    const { db, sent, mail } = await world({ mailOn: true, frequency: 'immediate' })
    await watchItem(db, 'workspace', 'u-ada', 'i-watch')
    for (const [index, at] of [1, 2, 3].entries()) {
      await emitEvent(db, 'workspace', 'item.moved', {
        itemId: 'i-watch',
        title: 'Rebuild the signup form',
        boardId: 'b-1',
        laneId: 'l-done',
        fromStage: 'backlog',
        toStage: 'done',
        at: at + index,
      }, 'u-grace')
    }

    expect(await sendDigests(db, { mail, now: NOW })).toEqual({ sent: 1, skipped: 0, unavailable: false })
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toContain('(3 changes)')

    // No new event: the due reminder alone is not an immediate email.
    expect(await sendDigests(db, { mail, now: NOW + 60_000 })).toEqual({ sent: 0, skipped: 1, unavailable: false })
    expect(sent).toHaveLength(1)
  })

  it('does not send before 08:00 in the reader’s own morning, and sends on the next local day', async () => {
    const { db, sent, mail } = await world({ mailOn: true, frequency: 'daily' })
    await watchItem(db, 'workspace', 'u-ada', 'i-watch')
    await emitEvent(db, 'workspace', 'item.noted', { itemId: 'i-watch', entryId: 'n-1' }, 'u-grace')

    // 05:00 UTC is still the previous evening somewhere west of the reader's 08:00, and before it
    // in UTC — the time zone is what "morning" means.
    expect(await sendDigests(db, { mail, now: Date.UTC(2026, 10, 3, 5, 0, 0) })).toEqual({
      sent: 0,
      skipped: 1,
      unavailable: false,
    })
    expect(sent).toHaveLength(0)

    expect(await sendDigests(db, { mail, now: NOW })).toMatchObject({ sent: 1 })
    expect(sent).toHaveLength(1)

    // Tuesday again, a week later: due, and the week's news is a new message.
    await emitEvent(db, 'workspace', 'item.noted', { itemId: 'i-watch', entryId: 'n-2' }, 'u-grace')
    expect(await sendDigests(db, { mail, now: NOW + 7 * 86_400_000 })).toMatchObject({ sent: 1 })
    expect(sent).toHaveLength(2)
  })

  it('is absent, not broken, when the deployment has no mailer', async () => {
    const { db } = await world({ mailOn: false })
    expect(await sendDigests(db, { now: NOW })).toEqual({ sent: 0, skipped: 0, unavailable: true })
  })

  it('gives a non-member nothing, even with the preference on', async () => {
    const { db, sent, mail } = await world({ mailOn: false })
    await db.run("UPDATE users SET mail_on = 1, mail_frequency = 'immediate' WHERE id = 'u-outside'")
    await watchItem(db, 'workspace', 'u-outside', 'i-watch')
    await emitEvent(db, 'workspace', 'item.noted', { itemId: 'i-watch', entryId: 'n-1' }, 'u-grace')
    expect(await sendDigests(db, { mail, now: NOW })).toEqual({ sent: 0, skipped: 0, unavailable: false })
    expect(sent).toHaveLength(0)
  })
})

describe('delivery preferences', () => {
  it('round-trips on the profile, and says when the instance cannot deliver', async () => {
    const { db, mail } = await world({ withMailer: true })
    const cookie = await signedIn(db)
    const app = await call(db, mail)
    const request = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set('cookie', cookie)
      return app.request(path, { ...init, headers }, {})
    }

    const before = (await (await request('/api/me')).json()) as {
      mailAvailable: boolean
      mailOn: boolean
      mailFrequency: string
    }
    expect(before).toMatchObject({ mailAvailable: true, mailOn: false, mailFrequency: 'daily' })

    expect(
      (
        await request('/api/me', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mailOn: true, mailFrequency: 'immediate' }),
        })
      ).status,
    ).toBe(204)
    const after = (await (await request('/api/me')).json()) as { mailOn: boolean; mailFrequency: string }
    expect(after).toMatchObject({ mailOn: true, mailFrequency: 'immediate' })

    // An instance without a relay refuses the preference rather than storing one it cannot honour.
    const bare = await call(db, undefined)
    const refused = await bare.request(
      '/api/me',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ mailOn: true }),
      },
      {},
    )
    expect(refused.status).toBe(422)

    // The frequency is a closed vocabulary.
    const nonsense = await request('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mailFrequency: 'hourly' }),
    })
    expect(nonsense.status).toBe(400)
  })

  it('stops delivery with the token, without a session', async () => {
    const { db, sent, mail } = await world({ mailOn: true, frequency: 'immediate' })
    await watchItem(db, 'workspace', 'u-ada', 'i-watch')
    await emitEvent(db, 'workspace', 'item.noted', { itemId: 'i-watch', entryId: 'n-1' }, 'u-grace')

    const token = await mailToken({ PUBLIC_URL: 'https://atlas.example' }, 'workspace', 'u-ada', 'unsubscribe')
    const app = await call(db, mail)
    const page = await app.request(`/api/mail/unsubscribe?token=${encodeURIComponent(token)}`, {}, {})
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('You will not receive email')

    expect(await sendDigests(db, { mail, now: NOW })).toEqual({ sent: 0, skipped: 0, unavailable: false })
    expect(sent).toHaveLength(0)

    const row = await db.get<{ mail_on: number }>('SELECT mail_on FROM users WHERE id = ?1', ['u-ada'])
    expect(row?.mail_on).toBe(0)
  })

  it('refuses a token that was changed, and one made for another action', async () => {
    const { db, mail } = await world({ mailOn: true })
    const app = await call(db, mail)
    const token = await mailToken({ PUBLIC_URL: 'https://atlas.example' }, 'workspace', 'u-ada', 'preferences')
    // A preferences token is not an unsubscribe token.
    expect((await app.request(`/api/mail/unsubscribe?token=${encodeURIComponent(token)}`, {}, {})).status).toBe(400)
    // A payload whose user was swapped is not signed by this instance.
    const swapped = `${Buffer.from(JSON.stringify({ w: 'workspace', u: 'u-grace', a: 'unsubscribe', v: 1 })).toString('hex')}.${token.split('.')[1]}`
    expect((await app.request(`/api/mail/unsubscribe?token=${encodeURIComponent(swapped)}`, {}, {})).status).toBe(400)
    // The preferences action redirects to the profile instead.
    const preferences = await app.request(`/api/mail/preferences?token=${encodeURIComponent(token)}`, {}, {})
    expect([302, 303]).toContain(preferences.status)
    expect(preferences.headers.get('location')).toBe('/app?profile=1')
  })
})
