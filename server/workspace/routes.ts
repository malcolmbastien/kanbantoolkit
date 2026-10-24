/**
 * The workspace, over HTTP.
 *
 * A read, and only a read: it proves the schema and the shape before anything writes through it.
 * It answers a signed-in member of this instance and nobody else — not an anonymous request, and
 * not an account that exists without a membership.
 */

import { Hono } from 'hono'
import type { Runtime } from '../runtime'
import { requireWorkspace } from '../access'
import { WORKSPACE_ID } from '../auth/session'
import { itemBelongsElsewhere, readItem, readItemsByIds, readWorkspace } from './read'
import { REQUIRED_SCHEMA, WORKSPACE_SCHEMA } from './schema'
import { schemaVersion } from '../migrate'
import { acquire, heldByOther, heldLocks, lockOf, release, renew } from './locks'
import { parseItem, parseWorkspace } from './validate'
import { alreadyApplied, writeItem, writeWorkspace } from './write'
import { statement } from '../audit'

/** Which tab is asking. Two tabs of one person are two sessions, and the lease says so. */
function tabOf(c: { req: { header: (name: string) => string | undefined } }): string {
  const tab = c.req.header('x-flowline-tab')
  return tab && tab.length <= 100 ? tab : 'tab'
}

export function workspaceRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  routes.get('/', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'board.read')
    if (allowed instanceof Response) return allowed

    // The one read that would otherwise hand back a shape nobody migrated for.
    if ((await schemaVersion(allowed.db)) < REQUIRED_SCHEMA) {
      return c.json({ error: 'this instance has not finished migrating' }, 503)
    }

    const workspace = await readWorkspace(allowed.db, allowed.workspaceId)
    // Whose workspace this is, answered by the session rather than by a pointer the browser keeps;
    // and which shape it is, so a client that cannot read it can say so instead of half-rendering.
    return c.json({ ...workspace, schema: WORKSPACE_SCHEMA, meUserId: allowed.user.id })
  })

  /**
   * Take a workspace from the browser that has been working in one.
   *
   * One transaction, replacing rather than merging: R3 says the account's workspace shall be the one
   * the person was working in, not two half-workspaces beside each other. The import is the only
   * place a whole workspace arrives at once, and it is deliberately not offered to a workspace that
   * already has a board — `GET /api/workspace` is how the client decides, and this refuses the same
   * case rather than trusting it.
   */
  routes.post('/import', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'workspace.import')
    if (allowed instanceof Response) return allowed

    const existing = await readWorkspace(allowed.db, allowed.workspaceId)
    if (existing.boards.length) return c.json({ error: 'this workspace already has boards' }, 409)

    const workspace = parseWorkspace(await c.req.json().catch(() => null))
    if (!workspace) return c.json({ error: 'not a workspace' }, 400)

    await writeWorkspace(
      allowed.db,
      workspace,
      allowed.workspaceId,
      statement({
        actorId: allowed.user.id,
        action: 'workspace.import',
        targetType: 'workspace',
        data: { boards: workspace.boards.length, items: workspace.items.length },
      }),
    )
    return c.json({ imported: { boards: workspace.boards.length, items: workspace.items.length } })
  })

  /**
   * Take a card's pen. One statement settles the race; whoever loses is told who won.
   */
  routes.post('/items/:id/lock', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'item.write')
    if (allowed instanceof Response) return allowed

    // A lease is a lock on an id, not on a row: the pen is taken on edit intent, which happens
    // before the first change ever reaches the server. Requiring the card to exist would mean a
    // card could not be edited for the first time by anybody.
    const id = c.req.param('id')
    // An id that belongs to another workspace is not a card waiting for its first edit: it is
    // somebody else's, and taking a pen on it would be a write into a workspace this request is
    // not about.
    if (await itemBelongsElsewhere(allowed.db, id, allowed.workspaceId)) return c.json({ error: 'no such item' }, 404)
    const sessionId = tabOf(c)
    const lock = await acquire(allowed.db, id, { userId: allowed.user.id, sessionId, name: allowed.user.name })
    if (lock.sessionId !== sessionId) return c.json({ error: 'someone else holds this card', holder: lock }, 423)
    return c.json({ lock })
  })

  /** Keep it while somebody is there. Renewal never creates a lease. */
  routes.post('/items/:id/heartbeat', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'item.write')
    if (allowed instanceof Response) return allowed

    const id = c.req.param('id')
    if (await itemBelongsElsewhere(allowed.db, id, allowed.workspaceId)) return c.json({ error: 'no such item' }, 404)
    const lock = await renew(allowed.db, id, tabOf(c))
    if (lock) return c.json({ lock })

    // Lapsed, or taken over: either way this session no longer holds it, and saying so is the point.
    return c.json({ error: 'this lease has lapsed', holder: (await lockOf(allowed.db, id)) ?? null }, 409)
  })

  /** Let go. Idempotent, because the tab that closes may already have lost it. */
  routes.delete('/items/:id/lock', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'item.write')
    if (allowed instanceof Response) return allowed

    await release(allowed.db, c.req.param('id'), tabOf(c))
    return c.body(null, 204)
  })

  /**
   * What has changed since a cursor, as cards.
   *
   * One page at a time, so a client that has been away catches up over a few calls rather than in
   * one statement with two hundred values in it. The cursor is the change id, which is monotonic:
   * a client that has read up to 40 asks for everything after 40 and cannot be served something it
   * has already seen.
   */
  routes.get('/changes', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'board.read')
    if (allowed instanceof Response) return allowed

    const asked = Number(c.req.query('since') ?? '0')
    const since = Number.isInteger(asked) && asked > 0 ? asked : 0

    const rows = await allowed.db.all<{ id: number; item_id: string; rev: number }>(
      // The feed is the workspace's: a change names an item, and an item belongs to one workspace.
      `SELECT id, item_id, rev FROM changes
        WHERE id > ?2 AND item_id IN (SELECT id FROM items WHERE workspace_id = ?1)
        ORDER BY id LIMIT 50`,
      [allowed.workspaceId, since],
    )
    // The leases ride the same poll as the changes: one request, one cursor, one picture of what is
    // going on in this workspace.
    const locks = await heldLocks(allowed.db)
    if (!rows.length) return c.json({ changes: [], cursor: since, locks })

    // A card written twice in one page is one card that changed, at its latest revision. The feed
    // says *what* changed, not every step it took to get there — a client catching up wants the
    // state, and a client that is live already has the steps.
    const latest = new Map<string, { id: number; item_id: string; rev: number }>()
    for (const row of rows) latest.set(row.item_id, row)
    const picked = [...latest.values()].sort((left, right) => left.id - right.id)

    const items = new Map(
      (await readItemsByIds(allowed.db, picked.map((row) => row.item_id), allowed.workspaceId)).map((item) => [item.id, item]),
    )

    return c.json({
      changes: picked.map((row) => ({ id: row.id, rev: row.rev, item: items.get(row.item_id) ?? null })),
      cursor: rows[rows.length - 1].id,
      locks,
    })
  })

  /**
   * One item, with the revision it was based on.
   *
   * The server owns the revision: it is handed the one the change was based on, checks that it is
   * still the stored one, and keeps that plus one. A change based on a revision the workspace has
   * moved past is refused with the version that is there now — never applied, and never dropped
   * without saying so (409). The client keeps whatever this answers with, which is why it is never
   * asked to merge by hand.
   */
  routes.patch('/items/:id', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'item.write')
    if (allowed instanceof Response) return allowed

    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) as { item?: unknown; baseRev?: unknown; key?: unknown } | null

    const item = parseItem(body?.item)
    if (!item || item.id !== id) return c.json({ error: 'not an item this endpoint can write' }, 400)

    const baseRev = body?.baseRev
    if (typeof baseRev !== 'number' || !Number.isInteger(baseRev) || baseRev < 0) {
      return c.json({ error: 'the revision it was based on is required' }, 400)
    }

    // A retry after a lost response carries the key of the change it is retrying. Answering with
    // what is stored — rather than applying it again — is what makes a queue safe to flush twice.
    const key = typeof body?.key === 'string' && body.key ? body.key.slice(0, 100) : undefined
    if (key && (await alreadyApplied(allowed.db, key))) {
      return c.json({ item: (await readItem(allowed.db, id, allowed.workspaceId)) ?? null, applied: true })
    }

    // A conflict is a disagreement about a version, so it only exists when there is one: an item the
    // server has never seen is a creation, whatever revision the browser believes it based it on.
    // That is what lets a workspace that lived only in a browser arrive one card at a time.
    // Content is the lease's business; arrangement is not, and never comes through here.
    const held = await heldByOther(allowed.db, id, tabOf(c))
    if (held) return c.json({ error: 'someone else is editing this card', holder: held }, 423)

    const current = await readItem(allowed.db, id, allowed.workspaceId)
    // "No such item here" and "such an item, in another workspace" are different answers, and only
    // the first is a creation. The second is a refusal that says nothing about where it lives.
    if (!current && (await itemBelongsElsewhere(allowed.db, id, allowed.workspaceId))) {
      return c.json({ error: 'no such item' }, 404)
    }
    if (current && (current.rev ?? 0) !== baseRev) return c.json({ error: 'moved past', item: current }, 409)

    const stored = { ...item, rev: baseRev + 1 }
    await writeItem(allowed.db, stored, allowed.workspaceId, key)
    // The change is announced only after it landed: a nudge for a write that failed would make a
    // second device read the feed for nothing.
    await runtime.live?.publish(c.env, WORKSPACE_ID, stored.rev ?? 0)
    return c.json({ item: stored })
  })

  return routes
}
