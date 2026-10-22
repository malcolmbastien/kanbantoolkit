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
import { readItem, readWorkspace } from './read'
import { parseItem } from './validate'
import { writeItem } from './write'

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
    const body = (await c.req.json().catch(() => null)) as { item?: unknown; baseRev?: unknown } | null

    const item = parseItem(body?.item)
    if (!item || item.id !== id) return c.json({ error: 'not an item this endpoint can write' }, 400)

    const baseRev = body?.baseRev
    if (typeof baseRev !== 'number' || !Number.isInteger(baseRev) || baseRev < 0) {
      return c.json({ error: 'the revision it was based on is required' }, 400)
    }

    // A conflict is a disagreement about a version, so it only exists when there is one: an item the
    // server has never seen is a creation, whatever revision the browser believes it based it on.
    // That is what lets a workspace that lived only in a browser arrive one card at a time.
    const current = await readItem(allowed.db, id)
    if (current && (current.rev ?? 0) !== baseRev) return c.json({ error: 'moved past', item: current }, 409)

    const stored = { ...item, rev: baseRev + 1 }
    await writeItem(allowed.db, stored)
    return c.json({ item: stored })
  })

  return routes
}
