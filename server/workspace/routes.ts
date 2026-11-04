/**
 * The workspace, over HTTP.
 *
 * A read, and only a read: it proves the schema and the shape before anything writes through it.
 * It answers a signed-in member of this instance and nobody else — not an anonymous request, and
 * not an account that exists without a membership.
 */

import { Hono } from 'hono'
import type { Runtime } from '../runtime'
import { refusalFor, requireWorkspace } from '../access'
import type { Item, ItemLogEntry } from '../../src/domain/types'
import { WORKSPACE_ID } from '../auth/session'
import { itemBelongsElsewhere, readGraph, readItem, readItemsByIds, readVocabularyRev, readWorkspace } from './read'
import { REQUIRED_SCHEMA, WORKSPACE_SCHEMA } from './schema'
import { schemaVersion } from '../migrate'
import { acquire, heldByOther, heldLocks, lockOf, release, renew } from './locks'
import { parseHistory, parseItem, parseWorkspace } from './validate'
import { alreadyApplied, appendHistory, writeItem, writeWorkspace } from './write'
import { statement } from '../audit'
import { deleteWorkspace, lastAdministratorRefusal, workspaceNameOf } from './account'
import { findBandChange, readBoardBands, readDesign, readStructureRev, writeDesign } from './structure'
import { readItemLog, readMovements, readNotes } from './history'
import { writeVocabularyDocument } from './vocabulary'
import { emitItemChange, graphWithItem } from '../events'

/** Which tab is asking. Two tabs of one person are two sessions, and the lease says so. */
function tabOf(c: { req: { header: (name: string) => string | undefined } }): string {
  const tab = c.req.header('x-kanbantoolkit-tab')
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

    // The document carries cards, not what happened to them: the drawer and the flow view ask for
    // history where they read it, so opening a board does not cost every move ever recorded.
    const workspace = await readWorkspace(allowed.db, allowed.workspaceId, { history: false })
    // Whose workspace this is, answered by the session rather than by a pointer the browser keeps;
    // and which shape it is, so a client that cannot read it can say so instead of half-rendering.
    // The design's revision travels with it: the next write has to say which design it began from.
    const structureRev = await readStructureRev(allowed.db, allowed.workspaceId)
    // Two documents, two revisions: the design is where things sit, the vocabulary is what they are.
    const vocabularyRev = await readVocabularyRev(allowed.db, allowed.workspaceId)
    return c.json({ ...workspace, schema: WORKSPACE_SCHEMA, meUserId: allowed.user.id, structureRev, vocabularyRev })
  })

  /**
   * End this workspace — and only this one.
   *
   * The workspace is the tenant: its administrator may close it, its members may not (`workspace.delete`
   * is in the matrix), and nothing here can reach another workspace, another person's account, or the
   * instance. The people stay users of the service with no workspace to open, which is exactly what
   * the interface has to be able to say.
   */
  routes.delete('/', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'workspace.delete')
    if (allowed instanceof Response) return allowed

    const body = (await c.req.json().catch(() => null)) as { confirm?: unknown } | null
    const name = await workspaceNameOf(allowed.db, allowed.workspaceId)
    const typed = typeof body?.confirm === 'string' ? body.confirm.trim() : ''
    // Checked here as well as in the interface: a confirmation only the client enforces is a
    // suggestion, and the interface is not the only way to call a route.
    if (typed.toLowerCase() !== name.toLowerCase()) {
      return c.json({ error: 'type the workspace’s name to confirm' }, 400)
    }

    // The accounts go with the workspace, so this has one refusal of its own: the deployment must
    // keep somebody who can administer it.
    const refusal = await lastAdministratorRefusal(allowed.db, allowed.workspaceId)
    if (refusal) return c.json({ error: refusal }, 409)

    await deleteWorkspace(
      allowed.db,
      allowed.workspaceId,
      statement({
        actorId: allowed.user.id,
        action: 'workspace.delete',
        targetType: 'workspace',
        targetId: allowed.workspaceId,
        // The name of the workspace, and of the person ending it: their account is deleted in the
        // same transaction, so `actor_id` will be nulled and this is what keeps the sentence whole.
        data: { name, by: allowed.user.name },
      }),
    )

    return c.body(null, 204)
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
    return c.json({
      imported: { boards: workspace.boards.length, items: workspace.items.length },
      structureRev: await readStructureRev(allowed.db, allowed.workspaceId),
      // An import replaces the words, so their revision starts again where an empty workspace's
      // does: the copy's browser knows which one its first vocabulary write is based on.
      vocabularyRev: await readVocabularyRev(allowed.db, allowed.workspaceId),
    })
  })

  /**
   * Write the board design — boards, lanes and where every card sits — as one document.
   *
   * The tree is why this is a route of its own rather than three: a placement is a position in a
   * lane, and a lane is a column of a board, so a half-written design is a board nobody can read.
   * The sender says which revision it began from; a design that has moved past it is refused with
   * the revision that is there, which is the same answer the item write gives to a stale card.
   *
   * `board.design` is the door: designing a board is an editor's work, and a Viewer is refused here
   * as they are refused the Edit button.
   */
  routes.put('/structure', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'board.design')
    if (allowed instanceof Response) return allowed

    const body = (await c.req.json().catch(() => null)) as { rev?: unknown; design?: unknown } | null
    const rev = body?.rev
    if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 0) {
      return c.json({ error: 'the revision the design was based on is required' }, 400)
    }

    const design = readDesign(body?.design)
    if (!design) return c.json({ error: 'not a board design' }, 400)

    const current = await readStructureRev(allowed.db, allowed.workspaceId)
    if (rev !== current) {
      return c.json({ error: 'this board has been designed since you read it', rev: current }, 409)
    }

    // The band is chosen when a board is made and is not a design change. A write that tries to
    // move an existing board between types is refused whole, before anything is written, with a
    // stable code so the client can say what happened rather than retry the same design.
    const bandChange = findBandChange(design.boards, await readBoardBands(allowed.db, allowed.workspaceId))
    if (bandChange) {
      return c.json(
        {
          error: "a board's type is fixed when it is created",
          code: 'band_fixed',
          ...bandChange,
        },
        409,
      )
    }

    const written = await writeDesign(allowed.db, allowed.workspaceId, design, current)
    return c.json({
      rev: current + 1,
      boards: written.boards.length,
      lanes: written.lanes.length,
      placements: written.placed,
      // Placements whose card the server has not met yet: they arrive behind their item, and the
      // client sends the design again once its queue has drained.
      skipped: written.skipped,
    })
  })

  /**
   * Write the workspace's words — its types, templates, objectives and key results — as one document.
   *
   * Beside the design write, and deliberately not inside it: a board's layout and the workspace's
   * vocabulary are different documents with different editors, so a shared revision would refuse
   * one for the other's change. The rules are the design's: the whole document, the revision it
   * began from, 409 with the revision that is there, and a write that lands whole or not at all.
   *
   * Permission is per list, because the roles differ: an editor may write objectives and may not
   * touch templates, so a document is checked list by list against what it actually changed. A list
   * the caller may not edit is refused with its name rather than dropped — the app must never
   * answer "saved" to a change it did not make.
   */
  routes.put('/vocabulary', async (c) => {
    // Any member may read the vocabulary, so this door is membership; what a person may *change* is
    // decided per list below, against the role.
    const allowed = await requireWorkspace(c, runtime, 'board.read')
    if (allowed instanceof Response) return allowed
    if ((await schemaVersion(allowed.db)) < REQUIRED_SCHEMA) {
      return c.json({ error: 'this instance has not finished migrating' }, 503)
    }

    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const result = await writeVocabularyDocument({
      db: allowed.db,
      workspaceId: allowed.workspaceId,
      role: allowed.workspaceRole,
      body,
    })
    if (!result.ok) {
      return c.json(
        { error: result.failure.message, ...(result.failure.details ?? {}) },
        result.failure.status,
      )
    }
    return c.json(result.value)
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
   * One card's history, a page at a time.
   *
   * The workspace document carries cards, not what happened to them. The drawer asks for the first
   * page when it opens the Activity tab and follows `nextCursor` for the rest; `total` lets it say
   * how much there is before every page has arrived. A card from another workspace is a 404, not an
   * empty log.
   */
  routes.get('/items/:id/log', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'board.read')
    if (allowed instanceof Response) return allowed

    const page = await readItemLog(allowed.db, c.req.param('id'), allowed.workspaceId, {
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit'),
    })
    if (!page) return c.json({ error: 'no such item' }, 404)
    return c.json(page)
  })

  /**
   * Append to one card's history, without taking a revision.
   *
   * The log entry a move leaves is a fact about the card, but the move itself is arrangement: it
   * changes the placement, not the card's version. A revision that changed on every drag would make
   * a card somebody is editing impossible to rearrange. This is the door for exactly that — the
   * entries are written as they are, ids making a retry a no-op, and the revision stays where it is.
   */
  routes.post('/items/:id/log', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'item.write')
    if (allowed instanceof Response) return allowed

    const id = c.req.param('id')
    // "No such item here" and "such an item, in another workspace" are different answers.
    const before = await readItem(allowed.db, id, allowed.workspaceId)
    if (!before) {
      return c.json({ error: 'no such item' }, 404)
    }
    const body = (await c.req.json().catch(() => null)) as { entries?: unknown } | null
    const entries = parseHistory(body?.entries)
    if (!entries) return c.json({ error: '`entries` must be history entries' }, 400)

    await appendHistory(allowed.db, id, entries, allowed.workspaceId)

    // A move is arrangement, so it appends history rather than rewriting the card — but it is still
    // a change somebody watches. The post-write reading emits `item.moved`/`item.noted` for the
    // entries that actually arrived (an append is idempotent, so a replay emits nothing).
    const after = await readItem(allowed.db, id, allowed.workspaceId)
    if (after) await emitItemChange(allowed.db, allowed.workspaceId, before, after, undefined, allowed.user.id)
    return c.json({ appended: entries.length })
  })

  /**
   * The moves of one board's cards, for the flow reading.
   *
   * Only `moved` entries, only the stages they landed in: the chart is rebuilt from stages, and
   * the time window it draws is the view's own choice. An unknown board is a 404 rather than an
   * empty chart, because "no moves recorded" and "no such board" are different readings.
   */
  routes.get('/movements', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'board.read')
    if (allowed instanceof Response) return allowed

    const boardId = c.req.query('boardId') ?? ''
    const board = await allowed.db.get<{ id: string }>(
      'SELECT id FROM boards WHERE id = ?1 AND workspace_id = ?2',
      [boardId, allowed.workspaceId],
    )
    if (!board) return c.json({ error: 'no such board' }, 404)

    const answer = await readMovements(allowed.db, boardId, allowed.workspaceId, {
      since: c.req.query('since'),
      limit: c.req.query('limit'),
    })
    return c.json(answer)
  })

  /**
   * The notes a search or a mention reading needs, without the history around them.
   *
   * `q` is a case-insensitive substring of the note; `mention=me` asks for the notes that name the
   * caller. Both are bounded, newest first, and both are scoped by the workspace.
   */
  routes.get('/notes', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'board.read')
    if (allowed instanceof Response) return allowed

    const notes = await readNotes(allowed.db, allowed.workspaceId, {
      q: c.req.query('q'),
      mentionOf: c.req.query('mention') === 'me' ? allowed.user.id : undefined,
      limit: c.req.query('limit'),
    })
    return c.json({ notes })
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

    // The leases ride the same poll as the changes: one request, one cursor, one picture of what is
    // going on in this workspace.
    const locks = await heldLocks(allowed.db)

    // A cursor older than what survives retention is answered explicitly: the client must reload
    // the workspace, because the changes between its cursor and the oldest row are gone.
    const oldest = await allowed.db.get<{ id: number | null }>(
      'SELECT MIN(id) AS id FROM changes WHERE workspace_id = ?1',
      [allowed.workspaceId],
    )
    if (since > 0 && oldest?.id !== null && oldest?.id !== undefined && since < oldest.id) {
      return c.json({ expired: true, changes: [], cursor: 0, locks })
    }

    const rows = await allowed.db.all<{ id: number; item_id: string; rev: number }>(
      // scoped by workspace_id: the change names its own workspace, so the feed is one indexed read.
      `SELECT id, item_id, rev FROM changes
        WHERE workspace_id = ?1 AND id > ?2
        ORDER BY id LIMIT 50`,
      [allowed.workspaceId, since],
    )
    if (!rows.length) return c.json({ changes: [], cursor: since, locks })

    // A card written twice in one page is one card that changed, at its latest revision. The feed
    // says *what* changed, not every step it took to get there — a client catching up wants the
    // state, and a client that is live already has the steps.
    const latest = new Map<string, { id: number; item_id: string; rev: number }>()
    for (const row of rows) latest.set(row.item_id, row)
    const picked = [...latest.values()].sort((left, right) => left.id - right.id)

    // A change names the card that moved, not its whole history; the client keeps what it has
    // read and asks for the rest where it is shown.
    const items = new Map(
      (await readItemsByIds(allowed.db, picked.map((row) => row.item_id), allowed.workspaceId, { history: false })).map(
        (item) => [item.id, item],
      ),
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
    // The door is `item.comment` — the least a change to a card can need — and the change itself
    // decides whether that is enough: a Viewer may append a note and nothing else (below).
    const allowed = await requireWorkspace(c, runtime, 'item.comment')
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

    // Which act the change is. A note is `item.comment` — the door — and anything else is
    // `item.write`, which both the role and the credential have to allow. Judged after the revision,
    // so a Viewer whose base is stale is told to catch up rather than refused.
    if (!commentOnly(current, item, allowed.user.id)) {
      const refused = refusalFor(allowed, 'item.write')
      if (refused) return c.json(refused, 403)
    }

    // The state the change is based on, for the health comparison a write can move. Only the graph
    // is read — settings, templates and the rest of the workspace cannot change a health reading —
    // and the after graph is derived from it after the write, because a card's own fields are the
    // only thing this endpoint moves.
    const beforeGraph = await readGraph(allowed.db, allowed.workspaceId)

    const stored = { ...item, rev: baseRev + 1 }
    await writeItem(allowed.db, stored, allowed.workspaceId, key)
    // The change is announced only after it landed: a nudge for a write that failed would make a
    // second device read the feed for nothing.
    await runtime.live?.publish(c.env, WORKSPACE_ID, stored.rev ?? 0)
    // Webhooks are a post-write reading, never part of the write. `emitItemChange` catches its own
    // failures, so a receiver being down cannot turn a saved card into an error.
    await emitItemChange(allowed.db, allowed.workspaceId, current, stored, beforeGraph, allowed.user.id, {
      graph: graphWithItem(beforeGraph, stored),
      issueTypes: beforeGraph.issueTypes,
    })
    return c.json({ item: stored })
  })

  return routes
}

/**
 * Whether a change is a comment and nothing more — the one write a Viewer may make.
 *
 * Every field but the log must be exactly what is stored, the stored log must be an unchanged
 * prefix of the incoming one, and each entry appended must be a note attributed to the caller or
 * to nobody. Anything else — a title, a tag, a checklist, a log entry that rewrites history or
 * claims another author — is refused by the same door an editor walks through.
 *
 * Comparing by value rather than by JSON, because the two sides are built by different code (the
 * store writes, the reader reads) and key order is not a fact about a card.
 */
function commentOnly(stored: Item | undefined, incoming: Item, byId: string): boolean {
  // An item the server has never seen would be a creation, and creating is `item.write`.
  if (!stored) return false

  const keys = new Set([...Object.keys(stored), ...Object.keys(incoming)])
  keys.delete('log')
  keys.delete('rev')
  for (const key of keys) {
    const field = key as keyof Item
    if (!same(stored[field], incoming[field])) return false
  }

  // A client no longer holds the whole history, so the incoming log is not a prefix of the stored
  // one: it is whatever this browser knows. An entry the server already has must be unchanged — a
  // write may append, never rewrite — and every entry that is new must be a note by this person.
  const known = new Map((stored.log ?? []).map((entry) => [entry.id, entry]))
  const added: ItemLogEntry[] = []
  for (const entry of incoming.log ?? []) {
    const existing = known.get(entry.id)
    if (existing) {
      if (!same(existing, entry)) return false
      continue
    }
    added.push(entry)
  }
  if (!added.length) return false
  return added.every((entry) => entry.kind === 'noted' && (!entry.by || entry.by === byId))
}

/** Deep equality, ignoring key order: an array by position, an object by its own keys. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const one = a as Record<string, unknown>
  const two = b as Record<string, unknown>
  const keys = Object.keys(one)
  if (keys.length !== Object.keys(two).length) return false
  return keys.every((key) => key in two && same(one[key], two[key]))
}
