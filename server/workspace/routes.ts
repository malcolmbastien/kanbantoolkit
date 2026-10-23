/**
 * The workspace, over HTTP.
 *
 * A read, and only a read: it proves the schema and the shape before anything writes through it.
 * It answers a signed-in member of this instance and nobody else — not an anonymous request, and
 * not an account that exists without a membership.
 */

import { Hono } from 'hono'
import type { Runtime } from '../runtime'
import { guard } from './guard'
import { readItem, readItemsByIds, readWorkspace } from './read'
import { parseItem, parseWorkspace } from './validate'
import { alreadyApplied, writeItem, writeWorkspace } from './write'

export function workspaceRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  routes.get('/', async (c) => {
    const allowed = await guard(c, runtime)
    if (allowed instanceof Response) return allowed

    const workspace = await readWorkspace(allowed.db)
    // Whose workspace this is, answered by the session rather than by a pointer the browser keeps.
    return c.json({ ...workspace, meUserId: allowed.user.id })
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
    const allowed = await guard(c, runtime)
    if (allowed instanceof Response) return allowed

    const existing = await readWorkspace(allowed.db)
    if (existing.boards.length) return c.json({ error: 'this workspace already has boards' }, 409)

    const workspace = parseWorkspace(await c.req.json().catch(() => null))
    if (!workspace) return c.json({ error: 'not a workspace' }, 400)

    await writeWorkspace(allowed.db, workspace)
    return c.json({ imported: { boards: workspace.boards.length, items: workspace.items.length } })
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
    const allowed = await guard(c, runtime)
    if (allowed instanceof Response) return allowed

    const asked = Number(c.req.query('since') ?? '0')
    const since = Number.isInteger(asked) && asked > 0 ? asked : 0

    const rows = await allowed.db.all<{ id: number; item_id: string; rev: number }>(
      'SELECT id, item_id, rev FROM changes WHERE id > ?1 ORDER BY id LIMIT 50',
      [since],
    )
    if (!rows.length) return c.json({ changes: [], cursor: since })

    // A card written twice in one page is one card that changed, at its latest revision. The feed
    // says *what* changed, not every step it took to get there — a client catching up wants the
    // state, and a client that is live already has the steps.
    const latest = new Map<string, { id: number; item_id: string; rev: number }>()
    for (const row of rows) latest.set(row.item_id, row)
    const picked = [...latest.values()].sort((left, right) => left.id - right.id)

    const items = new Map(
      (await readItemsByIds(allowed.db, picked.map((row) => row.item_id))).map((item) => [item.id, item]),
    )

    return c.json({
      changes: picked.map((row) => ({ id: row.id, rev: row.rev, item: items.get(row.item_id) ?? null })),
      cursor: rows[rows.length - 1].id,
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
    const allowed = await guard(c, runtime)
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
      return c.json({ item: (await readItem(allowed.db, id)) ?? null, applied: true })
    }

    // A conflict is a disagreement about a version, so it only exists when there is one: an item the
    // server has never seen is a creation, whatever revision the browser believes it based it on.
    // That is what lets a workspace that lived only in a browser arrive one card at a time.
    const current = await readItem(allowed.db, id)
    if (current && (current.rev ?? 0) !== baseRev) return c.json({ error: 'moved past', item: current }, 409)

    const stored = { ...item, rev: baseRev + 1 }
    await writeItem(allowed.db, stored, key)
    return c.json({ item: stored })
  })

  return routes
}
