/**
 * The person's own profile.
 *
 * Everything here is about *oneself*: a signed-in person editing their own name, picture and
 * language. Nothing here can change an address, a status or a role — those are other people's
 * decisions, made elsewhere, and a field in this body is ignored rather than merged.
 *
 * Email is read-only because it comes from an identity the provider verified. Letting somebody type
 * a different one would be letting them claim an address nobody vouched for.
 */

import { Hono } from 'hono'
import { requireUser } from './access'
import type { Runtime } from './runtime'

/** A picture is a decoration, not a document. Anything larger is not a profile photo. */
const MAX_AVATAR = 256 * 1024
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const LANGUAGES = /^[a-z]{2}$/i

interface Profile {
  name?: unknown
  avatarUrl?: unknown
  timezone?: unknown
  language?: unknown
}

/**
 * A data URL we are willing to store, or a path, or nothing.
 *
 * The size is measured on the decoded bytes rather than the base64 string, because that is the image
 * the browser will actually hold.
 */
export function readAvatar(value: unknown): { ok: true; avatarUrl?: string } | { ok: false; reason: string } {
  if (value === undefined) return { ok: true }
  if (value === null || value === '') return { ok: true, avatarUrl: undefined }
  if (typeof value !== 'string') return { ok: false, reason: 'the picture must be a string' }

  if (!value.startsWith('data:')) {
    // A path or an https URL: no size to measure here, and nothing to decode.
    return value.length <= 2_000 ? { ok: true, avatarUrl: value } : { ok: false, reason: 'that address is too long' }
  }

  const match = /^data:([^;,]+);base64,([a-z0-9+/=]+)$/i.exec(value)
  if (!match) return { ok: false, reason: 'the picture must be a base64 image' }
  if (!AVATAR_TYPES.includes(match[1].toLowerCase())) {
    return { ok: false, reason: 'the picture must be a png, jpeg or webp' }
  }

  const bytes = Math.floor((match[2].length * 3) / 4)
  if (bytes > MAX_AVATAR) return { ok: false, reason: 'the picture must be smaller than 256 KB' }
  return { ok: true, avatarUrl: value }
}

/** An IANA zone the runtime recognises — the only honest test of one. */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function meRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  routes.get('/', async (c) => {
    const caller = await requireUser(c, runtime)
    if (caller instanceof Response) return caller

    const row = await caller.db.get<{ avatar_url: string | null; timezone: string | null; language: string | null }>(
      'SELECT avatar_url, timezone, language FROM users WHERE id = ?1',
      [caller.user.id],
    )
    return c.json({
      id: caller.user.id,
      name: caller.user.name,
      email: caller.user.email,
      avatarUrl: row?.avatar_url ?? undefined,
      timezone: row?.timezone ?? undefined,
      language: row?.language ?? undefined,
      instanceRole: caller.user.instanceRole,
    })
  })

  /**
   * Change what is one's own.
   *
   * The whitelist is the whole security model: `email`, `status`, `instanceRole` and any role field
   * are not read. A forged body does nothing rather than something partial.
   */
  routes.patch('/', async (c) => {
    const caller = await requireUser(c, runtime)
    if (caller instanceof Response) return caller

    const body = (await c.req.json().catch(() => null)) as Profile | null
    const updates: Record<string, string | null> = {}

    if (body && 'name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
      if (!name) return c.json({ error: 'a name is required' }, 400)
      updates.name = name
    }

    if (body && 'timezone' in body) {
      const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : ''
      if (!timezone) updates.timezone = null
      else if (!isTimeZone(timezone)) return c.json({ error: 'that is not a time zone' }, 400)
      else updates.timezone = timezone
    }

    if (body && 'language' in body) {
      const language = typeof body.language === 'string' ? body.language.trim() : ''
      if (!language) updates.language = null
      else if (!LANGUAGES.test(language)) return c.json({ error: 'that is not a language code' }, 400)
      else updates.language = language.toLowerCase()
    }

    if (body && 'avatarUrl' in body) {
      const avatar = readAvatar(body.avatarUrl)
      if (!avatar.ok) return c.json({ error: avatar.reason }, 422)
      updates.avatar_url = avatar.avatarUrl ?? null
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ error: 'nothing to change' }, 400)
    }

    const columns = Object.keys(updates)
    const values = Object.values(updates)
    await caller.db.batch([
      {
        sql: `UPDATE users SET ${columns.map((column, index) => `${column} = ?${index + 1}`).join(', ')}, updated_at = ?${columns.length + 1} WHERE id = ?${columns.length + 2}`,
        params: [...values, new Date().toISOString(), caller.user.id],
      },
      {
        sql: 'INSERT INTO audit_events (actor_id, action, target_type, target_id, data) VALUES (?1, ?2, ?3, ?4, ?5)',
        // Field names only: the values of a picture are not something a trail should carry.
        params: [caller.user.id, 'user.edit', 'user', caller.user.id, JSON.stringify({ fields: columns })],
      },
    ])

    return c.body(null, 204)
  })

  routes.get('/identities', async (c) => {
    const caller = await requireUser(c, runtime)
    if (caller instanceof Response) return caller

    const rows = await caller.db.all<{ provider: string; subject: string; email: string; created_at: string }>(
      'SELECT provider, subject, email, created_at FROM identities WHERE user_id = ?1 ORDER BY created_at, provider',
      [caller.user.id],
    )
    return c.json({ identities: rows })
  })

  /**
   * Unlink a door. The last one is refused: an account nobody can sign in to is a person locked out
   * by their own click, and there is no administrator-side "reset" to undo it.
   */
  routes.delete('/identities/:provider/:subject', async (c) => {
    const caller = await requireUser(c, runtime)
    if (caller instanceof Response) return caller

    const count = await caller.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM identities WHERE user_id = ?1', [
      caller.user.id,
    ])
    if ((count?.n ?? 0) <= 1) {
      return c.json({ error: 'this is the only way into your account; link another before removing it' }, 409)
    }

    await caller.db.batch([
      {
        sql: 'DELETE FROM identities WHERE user_id = ?1 AND provider = ?2 AND subject = ?3',
        params: [caller.user.id, c.req.param('provider'), c.req.param('subject')],
      },
      {
        sql: 'INSERT INTO audit_events (actor_id, action, target_type, target_id, data) VALUES (?1, ?2, ?3, ?4, ?5)',
        params: [
          caller.user.id,
          'identity.unlink',
          'identity',
          `${c.req.param('provider')}:${c.req.param('subject')}`,
          null,
        ],
      },
    ])

    return c.body(null, 204)
  })

  return routes
}
