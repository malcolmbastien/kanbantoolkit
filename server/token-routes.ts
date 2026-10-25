/**
 * Minting, listing and revoking machine credentials (task 148).
 *
 * Three ways in, and they are for three different people:
 *
 * - **A person, in their own profile** (`/api/tokens`): "make a token for my dashboard script". The
 *   secret is answered once and never again.
 * - **An administrator, for somebody else** (`/api/admin/users/:id/tokens`): a cron job, a daemon on
 *   a machine nobody will open a browser on (R9). Same scopes, same expiry, same revocation, and the
 *   list says which tokens arrived this way.
 * - **A tool, through a short code** (`/api/tokens/device`): the acquisition R7 asked for. The tool
 *   prints eight characters and a URL; the person approves in the browser they are already signed
 *   in to; the secret goes straight to the tool and never through a clipboard or a shell history.
 *
 * Nothing here ever returns a secret twice, and nothing here accepts a scope the person could not
 * exercise (R6): the refusal names the scopes, because "which checkbox" is the useful answer.
 */

import { Hono } from 'hono'
import { requireInstanceAdmin, requireUser, resolveWorkspace } from './access'
import { randomToken, sha256 } from './auth/oauth'
import { statement } from './audit'
import type { Role } from '../src/domain/roles'
import { isScope, refusedScopes, type Scope } from '../src/domain/scopes'
import { publicUrl, salt } from './config'
import type { Database } from './db'
import type { Runtime } from './runtime'
import {
  DEVICE_MINUTES,
  DEFAULT_DAYS,
  mintToken,
  parseScopes,
  publicToken,
  revokeToken,
  tokensOf,
} from './tokens'

/** A name is for a person reading a list later; it is not a description. */
const MAX_NAME = 60
/** How many codes one address may ask for in an hour. A code is cheap; a table full of them is not. */
const CODES_PER_HOUR = 20

/**
 * The alphabet a short code is built from: no `O`/`0`, no `I`/`1`, because a person reads this off a
 * terminal and types it into a browser. Eight characters from thirty-two is forty bits — useless to
 * guess, and still easy to read out loud.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

function shortCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')
}

/** What a person types, however they typed it: `abcd-efgh`, `abcd efgh` and `ABCDEFGH` are one code. */
function normalizeCode(value: string | undefined): string {
  return (value ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase()
}

/** The code as it is printed and read, with the dash that makes it two words. */
export function readableCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

interface TokenInput {
  name?: unknown
  scopes?: unknown
  expiresInDays?: unknown
}

/** A name, a set of scopes and an expiry — the shape every minting door takes. */
function readMint(body: TokenInput | null): { ok: true; name: string; scopes: Scope[]; days: number | null | undefined } | { ok: false; error: string } {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return { ok: false, error: 'give the token a name' }
  if (name.length > MAX_NAME) return { ok: false, error: `a name is at most ${MAX_NAME} characters` }

  if (!Array.isArray(body?.scopes) || body.scopes.length === 0) {
    return { ok: false, error: 'choose at least one scope' }
  }
  const scopes = [...new Set(body.scopes)]
  if (scopes.some((scope) => !isScope(scope))) return { ok: false, error: 'that is not a scope this server knows' }

  let days: number | null | undefined
  const raw = body?.expiresInDays
  if (raw === null) days = null
  else if (raw !== undefined) {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 3650) {
      return { ok: false, error: 'an expiry is a whole number of days between 1 and 3650, or null for never' }
    }
    days = raw
  }

  return { ok: true, name, scopes: scopes as Scope[], days }
}

/**
 * What this person may actually hold, from both axes.
 *
 * `undefined` means they are in no workspace at all — an instance administrator between workspaces.
 * The workspace scopes are then unreachable, and `instance:admin` still answers from the other axis.
 */
async function authorityOf(
  db: Database,
  userId: string,
): Promise<{ role: Role; instanceRole: 'admin' | 'member' } | undefined> {
  const member = await db.get<{ role: string }>('SELECT role FROM instance_members WHERE user_id = ?1', [userId])
  if (!member) return undefined
  const instanceRole = member.role === 'admin' ? 'admin' : 'member'
  const workspace = await resolveWorkspace(db, userId, instanceRole === 'admin', undefined)
  // No membership and not an administrator: no workspace scope is theirs to hold.
  return workspace ? { role: workspace.role, instanceRole } : undefined
}

/** The scopes a person cannot hold, or an empty list. A refusal names them so a screen can point. */
async function refusedFor(
  db: Database,
  userId: string,
  scopes: readonly Scope[],
): Promise<{ role: Role; instanceRole: 'admin' | 'member'; refused: Scope[] }> {
  const authority = await authorityOf(db, userId)
  if (!authority) return { role: 'viewer', instanceRole: 'member', refused: [...scopes] }
  return { ...authority, refused: refusedScopes(scopes, authority.role, authority.instanceRole) }
}

function refusal(c: Parameters<typeof requireUser>[0], role: Role, refused: Scope[]): Response {
  const who = role === 'admin' ? 'an administrator' : `a ${role}`
  return c.json(
    {
      error: `${who} may not hold ${refused.join(', ')}`,
      scopes: refused,
    },
    422,
  ) as unknown as Response
}

/** The person's own credentials: make one, list them, revoke one. */
export function tokenRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  routes.get('/', async (c) => {
    const caller = await requireUser(c, runtime)
    if (caller instanceof Response) return caller
    return c.json({ tokens: (await tokensOf(caller.db, caller.user.id)).map(publicToken) })
  })

  /**
   * A token for myself (R1, R2, R3, R6).
   *
   * The secret is in this answer and in no other: the row keeps its hash, the list never carries it,
   * and the audit carries the name and the scopes but never the value.
   */
  routes.post('/', async (c) => {
    const caller = await requireUser(c, runtime)
    if (caller instanceof Response) return caller

    const body = (await c.req.json().catch(() => null)) as TokenInput | null
    const asked = readMint(body)
    if (!asked.ok) return c.json({ error: asked.error }, 422)

    const { role, refused } = await refusedFor(caller.db, caller.user.id, asked.scopes)
    if (refused.length) return refusal(c, role, refused)

    const { secret, token } = await mintToken(caller.db, {
      userId: caller.user.id,
      name: asked.name,
      scopes: asked.scopes,
      expiresInDays: asked.days,
      origin: 'self',
    })

    await caller.db.run(
      ...audit({
        actorId: caller.user.id,
        action: 'token.create',
        targetType: 'user',
        targetId: caller.user.id,
        data: { name: token.name, scopes: token.scopes, origin: 'self' },
      }),
    )

    return c.json({ token: publicToken(token), secret }, 201)
  })

  /**
   * Which credential is asking.
   *
   * A session answers `null` — a browser holds everything its role grants. A token answers with its
   * id and the scopes it was minted for, which is what a tool needs to say "I can read, and not
   * write" instead of discovering it one 403 at a time.
   */
  routes.get('/self', async (c) => {
    const caller = await requireUser(c, runtime)
    if (caller instanceof Response) return caller
    return c.json({
      credential: caller.tokenId ? { id: caller.tokenId, scopes: caller.scopes ?? [] } : null,
    })
  })

  /** Revoke one of my own. A token id that is not mine finds nothing — 404, not a refusal. */
  routes.delete('/:id', async (c) => {
    const caller = await requireUser(c, runtime)
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    const revoked = await revokeToken(caller.db, id, caller.user.id)
    if (revoked === 0) return c.json({ error: 'no such token' }, 404)

    await caller.db.run(
      ...audit({
        actorId: caller.user.id,
        action: 'token.revoke',
        targetType: 'user',
        targetId: caller.user.id,
        data: { token: id },
      }),
    )
    return c.json({ revoked })
  })

  /* ---- The device flow: a tool asks, a person approves, the secret goes to the tool ---------- */

  /**
   * A tool asks for a code. No session: this is the half that happens before anybody is known.
   *
   * The tool names itself and the scopes it wants, and those are what the approval screen shows. It
   * cannot approve anything — only a signed-in person can, and only for themselves (R10).
   */
  routes.post('/device', async (c) => {
    const db = runtime.database(c.env)
    if (!db) return c.json({ error: 'not configured' }, 503)

    const body = (await c.req.json().catch(() => null)) as TokenInput | null
    const asked = readMint(body)
    if (!asked.ok) return c.json({ error: asked.error }, 422)

    // A code is cheap, a table nobody prunes is not: at most this many per address an hour.
    const ipHash = await sha256(`${runtime.clientIp(c.req.raw)}:${salt(c.env)}`)
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const recent = await db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM device_codes WHERE ip_hash = ?1 AND created_at >= ?2',
      [ipHash, hourAgo],
    )
    if ((recent?.n ?? 0) >= CODES_PER_HOUR) return c.json({ error: 'too many codes' }, 429)

    const deviceCode = `${randomToken(32)}`
    const userCode = shortCode()
    const expiresAt = new Date(Date.now() + DEVICE_MINUTES * 60_000).toISOString()

    await db.run(
      `INSERT INTO device_codes (id, code_hash, user_code, name, scopes, expires_at, ip_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      [
        `dev_${randomToken(12)}`,
        await sha256(deviceCode),
        userCode,
        asked.name,
        JSON.stringify(asked.scopes),
        expiresAt,
        ipHash,
      ],
    )

    // Lazy housekeeping, on the one route that writes codes: the table is a queue, not an archive.
    await db.run('DELETE FROM device_codes WHERE expires_at < ?1', [new Date(Date.now() - 86_400_000).toISOString()])

    return c.json({
      device_code: deviceCode,
      user_code: readableCode(userCode),
      // The app's own approval screen; the person is already signed in there (R10).
      verification_uri: `${publicUrl(c.env, c.req.raw)}/app?approve=${userCode}`,
      expires_in: DEVICE_MINUTES * 60,
      interval: 2,
    })
  })

  /** What the approval screen shows before anybody presses anything. */
  routes.get('/device/:code', async (c) => {
    const caller = await requireUser(c, runtime)
    if (caller instanceof Response) return caller

    const code = normalizeCode(c.req.param('code'))
    const row = await caller.db.get<DeviceRow>('SELECT * FROM device_codes WHERE user_code = ?1', [code])
    if (!row) return c.json({ error: 'no such code' }, 404)
    if (row.used_at) return c.json({ error: 'that code has already been used' }, 410)
    if (row.expires_at <= new Date().toISOString()) return c.json({ error: 'that code has expired' }, 410)

    const refused = (await refusedFor(caller.db, caller.user.id, parseScopes(row.scopes))).refused
    return c.json({
      name: row.name,
      scopes: parseScopes(row.scopes),
      approved: Boolean(row.approved_at),
      expiresAt: row.expires_at,
      // What the consent screen says about the credential's own life: the default, because the code
      // carries no duration of its own. Named here so the screen never hard-codes a number.
      expiresInDays: DEFAULT_DAYS,
      // Which of them this person could not grant, so the screen says so before the press.
      refused,
    })
  })

  /**
   * A person approves — the consent (R10).
   *
   * The scopes may be narrowed here and never widened: a tool's request is the ceiling, and the
   * person's role is the other one. Approving twice is refused; an expired code is gone.
   */
  routes.post('/device/approve', async (c) => {
    const caller = await requireUser(c, runtime)
    if (caller instanceof Response) return caller

    const body = (await c.req.json().catch(() => null)) as { user_code?: unknown; scopes?: unknown } | null
    const code = normalizeCode(typeof body?.user_code === 'string' ? body.user_code : undefined)
    if (!code) return c.json({ error: 'which code?' }, 422)

    const row = await caller.db.get<DeviceRow>('SELECT * FROM device_codes WHERE user_code = ?1', [code])
    if (!row) return c.json({ error: 'no such code' }, 404)
    if (row.used_at) return c.json({ error: 'that code has already been used' }, 410)
    if (row.expires_at <= new Date().toISOString()) return c.json({ error: 'that code has expired' }, 410)
    if (row.approved_at) return c.json({ error: 'that code has already been approved' }, 409)

    const requested = parseScopes(row.scopes)
    const approved: Scope[] = Array.isArray(body?.scopes)
      ? [...new Set(body.scopes.filter((scope): scope is Scope => isScope(scope)))]
      : requested
    if (approved.length === 0) return c.json({ error: 'choose at least one scope' }, 422)
    if (approved.some((scope) => !requested.includes(scope))) {
      return c.json({ error: 'the tool did not ask for that' }, 422)
    }

    const { role, refused } = await refusedFor(caller.db, caller.user.id, approved)
    if (refused.length) return refusal(c, role, refused)

    await caller.db.run(
      'UPDATE device_codes SET user_id = ?1, scopes = ?2, approved_at = ?3 WHERE id = ?4 AND approved_at IS NULL',
      [caller.user.id, JSON.stringify(approved), new Date().toISOString(), row.id],
    )

    await caller.db.run(
      ...audit({
        actorId: caller.user.id,
        action: 'token.approve',
        targetType: 'user',
        targetId: caller.user.id,
        data: { tool: row.name, scopes: approved },
      }),
    )

    return c.json({ approved: true, name: row.name, scopes: approved })
  })

  /**
   * The tool exchanges its code for the secret — once.
   *
   * Not yet approved is `428 authorization_pending` (the tool waits); spent or expired is `410`
   * (the tool prints a new code). The secret never touches the database in the clear, and it is
   * answered here and nowhere else.
   */
  routes.post('/device/token', async (c) => {
    const db = runtime.database(c.env)
    if (!db) return c.json({ error: 'not configured' }, 503)

    const body = (await c.req.json().catch(() => null)) as { device_code?: unknown } | null
    const secret = typeof body?.device_code === 'string' ? body.device_code : ''
    if (!secret) return c.json({ error: 'which code?' }, 422)

    const row = await db.get<DeviceRow>('SELECT * FROM device_codes WHERE code_hash = ?1', [await sha256(secret)])
    if (!row || row.used_at) return c.json({ error: 'expired' }, 410)
    if (row.expires_at <= new Date().toISOString()) return c.json({ error: 'expired' }, 410)
    if (!row.approved_at || !row.user_id) return c.json({ error: 'authorization_pending' }, 428)

    // Spent before it is minted: two exchanges racing must not make two credentials.
    const spent = await db.run(
      'UPDATE device_codes SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL',
      [new Date().toISOString(), row.id],
    )
    if (spent.changes === 0) return c.json({ error: 'expired' }, 410)

    const { secret: token, token: record } = await mintToken(db, {
      userId: row.user_id,
      name: row.name,
      scopes: parseScopes(row.scopes),
      expiresInDays: DEFAULT_DAYS,
      origin: 'device',
      mintedBy: row.user_id,
    })

    await db.run(
      ...audit({
        actorId: row.user_id,
        action: 'token.create',
        targetType: 'user',
        targetId: row.user_id,
        data: { name: record.name, scopes: record.scopes, origin: 'device' },
      }),
    )

    return c.json({ secret: token, token: publicToken(record) })
  })

  return routes
}

interface DeviceRow {
  id: string
  code_hash: string
  user_code: string
  user_id: string | null
  name: string
  scopes: string
  approved_at: string | null
  used_at: string | null
  expires_at: string
  created_at: string
}

/**
 * An administrator, for somebody else (R5, R9).
 *
 * The same scopes and the same refusals, checked against the *owner's* role rather than the
 * administrator's: an administrator may not hand a Viewer a writing token, which would be the
 * escalation the whole design refuses. The list is the owner's — an administrator sees which
 * credentials exist in order to revoke one, and never a value.
 */
export function tokenAdminRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  const person = async (db: Database, id: string) =>
    db.get<{ id: string; name: string }>('SELECT id, name FROM users WHERE id = ?1', [id])

  routes.get('/users/:id/tokens', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller
    const id = c.req.param('id')
    if (!(await person(caller.db, id))) return c.json({ error: 'no such person' }, 404)
    return c.json({ tokens: (await tokensOf(caller.db, id)).map(publicToken) })
  })

  routes.post('/users/:id/tokens', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller
    const id = c.req.param('id')
    if (!(await person(caller.db, id))) return c.json({ error: 'no such person' }, 404)

    const body = (await c.req.json().catch(() => null)) as TokenInput | null
    const asked = readMint(body)
    if (!asked.ok) return c.json({ error: asked.error }, 422)

    // The owner's limit, not the administrator's: minting for somebody else cannot reach further
    // than they could reach themselves.
    const { role, refused } = await refusedFor(caller.db, id, asked.scopes)
    if (refused.length) return refusal(c, role, refused)

    const { secret, token } = await mintToken(caller.db, {
      userId: id,
      name: asked.name,
      scopes: asked.scopes,
      expiresInDays: asked.days ?? DEFAULT_DAYS,
      origin: 'admin',
      mintedBy: caller.user.id,
    })

    await caller.db.run(
      ...audit({
        actorId: caller.user.id,
        action: 'token.create',
        targetType: 'user',
        targetId: id,
        data: { name: token.name, scopes: token.scopes, origin: 'admin' },
      }),
    )

    return c.json({ token: publicToken(token), secret }, 201)
  })

  routes.delete('/users/:id/tokens/:tokenId', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller
    const id = c.req.param('id')
    if (!(await person(caller.db, id))) return c.json({ error: 'no such person' }, 404)

    const revoked = await revokeToken(caller.db, c.req.param('tokenId'), id)
    if (revoked === 0) return c.json({ error: 'no such token' }, 404)

    await caller.db.run(
      ...audit({
        actorId: caller.user.id,
        action: 'token.revoke',
        targetType: 'user',
        targetId: id,
        data: { token: c.req.param('tokenId') },
      }),
    )
    return c.json({ revoked })
  })

  return routes
}

/** `statement`, narrowed to what `db.run` takes. The audit shape is the trail's, not this file's. */
function audit(event: Parameters<typeof statement>[0]): [string, unknown[]] {
  const { sql, params } = statement(event)
  return [sql, params ?? []]
}
