/**
 * The persisted-state migrations, apart from the store's actions.
 *
 * This is a history, not a feature: each block repairs one shape an older build wrote, in order,
 * idempotently. Keeping it in its own module makes a new migration a small local change instead of
 * an edit in the middle of the store.
 */

import { BUILT_IN_TEMPLATES } from '@/domain/seed'
import { NONE_TYPE, initiativeTypeId } from '@/domain/board'
import { defaultColumns, effectiveStage } from '@/domain/lanes'
import { normalizeObjectiveStatus } from '@/domain/objectives'
import { withInitiatives } from '@/domain/template'
import { isBoardDetail } from '@/domain/boardDetail'
import { pruneFavourites, pruneVisits, type BoardVisit } from '@/domain/boardShortcuts'
import { uid as makeUid } from '@/lib/utils'
import type { Store } from '../store'
import type {
  Board,
  BoardBand,
  BoardFlow,
  BoardTemplate,
  Edge,
  FlowKind,
  IssueType,
  Item,
  KeyResult,
  Lane,
  Objective,
  Period,
  Placement,
  TemplateFlow,
  User,
} from '@/domain/types'

const uid = makeUid

/**
 * The current persisted workspace shape — every schema change bumps it with a migrate.
 *
 * 36 is the flow model: a lane names its flow (`flowId`) and the board's flows are a list of their
 * own. The block that upgrades an older state also covers the two-tree shape v24 introduced, so a
 * file from either era lands in one cards flow and one initiatives flow per board.
 *
 * 37 is the same for templates: a template describes a set of cards flows, so an older one gains a
 * flow named "Cards" and every lane names it.
 *
 * 38 is the objective's period: a period is a record with a window (`periods`), an objective names
 * one (`periodId`) instead of carrying a label, and the objective's `score` is gone.
 *
 * 39 is history read on demand: the same `Item.log`, now a cache of what this browser has read
 * rather than the whole log, merged by id. The migration puts what is stored in `(at, id)` order
 * with one copy per entry, which is the order a page read is merged into.
 *
 * 40 is the home's two shortcuts: the boards this browser keeps (`favouriteBoardIds`) and the ones
 * it opened lately (`recentBoards`). Old state has neither, and ids that are not boards are pruned.
 *
 * 41 is the watch list and the demo's inbox cursor. Old state watches nothing and has read nothing,
 * so both backfill to empty rather than to a guess.
 *
 * 42 is when each watch began. Old state has watches with no start; they take zero, which is the
 * same "show the history" answer a server watch written before the rule gets.
 *
 * 43 is the board detail dial. Old state has no choices, so every board opens on Full — the card
 * this build has always drawn.
 *
 * 44 is a template's initiative kinds, and its flow order: the initiatives flow is fixed at the top,
 * above every cards flow, so an older template is reordered and keeps its cells.
 */
export const PERSIST_VERSION = 44
/**
 * The oldest shape this build can migrate. Below it there is no migration, only a guess — and a
 * guess is not what a person's workspace gets.
 */
export const MIN_MIGRATABLE_VERSION = 9

export function migrateState(persisted: unknown): Partial<Store> {
  const p = (persisted ?? {}) as Record<string, unknown>
  // v16: `Board.level` became `Board.band`, and `teamBoardIds` became the
  // depth-agnostic `linkedBoardIds`. v17: the band values were renamed to the
  // board-type vocabulary (team / program / portfolio). An old 'portfolio' level
  // (an aggregating board) becomes a *program*, while a v16 'strategic' band
  // becomes the new *portfolio*.
  if (Array.isArray(p.boards)) {
    p.boards = (p.boards as (Record<string, unknown> & { level?: string; teamBoardIds?: string[] })[]).map((b) => {
      const { level, teamBoardIds, ...rest } = b
      const existing = typeof rest.band === 'string' ? rest.band : undefined
      const raw = existing ?? (level === 'portfolio' || level === 'project' ? 'program' : 'team')
      const band: BoardBand =
        raw === 'coordination' || raw === 'program' ? 'program' : raw === 'strategic' || raw === 'portfolio' ? 'portfolio' : 'team'
      return { ...rest, band, ...(teamBoardIds ? { linkedBoardIds: teamBoardIds } : {}) }
    })
  }
  // v27: card types belong to the workspace, not to a board. Every board offers all of them,
  // so the per-board subset is gone — a board either has a type, which is to say everyone does,
  // or the type does not exist. Same for a template: it designs a flow, not a shortlist.
  const withoutCardTypeIds = (rows: unknown) =>
    (Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []).map((row) => {
      const next = { ...row }
      delete next.cardTypeIds
      return next
    })
  if (Array.isArray(p.boards)) p.boards = withoutCardTypeIds(p.boards)
  if (Array.isArray(p.boardTemplates)) p.boardTemplates = withoutCardTypeIds(p.boardTemplates)
  // v9 → v10: item-to-item dependencies became first-class `links`; `edges`
  // now holds only hierarchy (decomposition) and objective (attribution).
  // v11: links no longer carry an approval status.
  if (!Array.isArray(p.links)) {
    type LegacyEdge = {
      id: string
      kind: 'decomposition' | 'dependency' | 'attribution'
      from: string
      to: string
      dep?: { status?: string; reason?: string }
    }
    const edges = Array.isArray(p.edges) ? (p.edges as LegacyEdge[]) : []
    p.links = edges
      .filter((e) => e.kind === 'dependency' && e.dep?.status !== 'rejected')
      .map((e) => ({ id: e.id, from: e.from, to: e.to, reason: e.dep?.reason }))
    p.edges = edges.filter((e) => e.kind !== 'dependency').map(({ id, kind, from, to }) => ({ id, kind, from, to }))
  } else {
    // Drop links that were rejected (they were never real dependencies) and
    // strip the now-removed status field.
    p.links = (p.links as { id: string; from: string; to: string; status?: string; reason?: string }[])
      .filter((l) => l.status !== 'rejected')
      .map((l) => ({ id: l.id, from: l.from, to: l.to, ...(l.reason ? { reason: l.reason } : {}) }))
  }
  // v12: OKR attribution is reserved for initiatives — cards map to initiatives
  // through the hierarchy. Drop any attribution edges pointing at a non-initiative.
  if (Array.isArray(p.edges) && Array.isArray(p.items) && Array.isArray(p.issueTypes)) {
    const initId = (p.issueTypes as { id: string; name: string }[]).find((t) => t.name === 'Initiative')?.id
    if (initId) {
      const typeOf = new Map((p.items as { id: string; typeId: string }[]).map((i) => [i.id, i.typeId]))
      p.edges = (p.edges as { kind: string; to: string }[]).filter((e) => e.kind !== 'attribution' || typeOf.get(e.to) === initId)
    }
  }
  // v13: a single targetDate became a target start / end pair. Old data keeps its
  // date as the end date.
  if (Array.isArray(p.items)) {
    p.items = (p.items as (Item & { targetDate?: string })[]).map((i) => {
      if (!('targetDate' in i)) return i
      const { targetDate, ...rest } = i
      return { ...rest, ...(targetDate ? { targetEndDate: targetDate } : {}) }
    })
  }
  // v14: a single assignee became a list of assignees.
  if (Array.isArray(p.items)) {
    p.items = (p.items as (Item & { assignee?: string })[]).map((i) => {
      if (!('assignee' in i)) return i
      const { assignee, ...rest } = i
      return { ...rest, ...(assignee ? { assignees: [assignee] } : {}) }
    })
  }
  // v15: assignees became user ids backed by a `users` directory. Build users from
  // the old name strings and map each item's assignees to the new ids.
  if (Array.isArray(p.items)) {
    const users: User[] = Array.isArray(p.users) ? (p.users as User[]) : []
    const byName = new Map(users.map((u) => [u.name.toLowerCase(), u.id]))
    const resolve = (value: string): string => {
      if (users.some((u) => u.id === value)) return value // already an id
      const key = value.trim().toLowerCase()
      const existing = byName.get(key)
      if (existing) return existing
      const id = `u-${key.replace(/[^a-z0-9]+/g, '-')}`
      users.push({ id, name: value.trim() })
      byName.set(key, id)
      return id
    }
    p.items = (p.items as (Item & { assignees?: string[] })[]).map((i) =>
      Array.isArray(i.assignees) ? { ...i, assignees: i.assignees.map(resolve) } : i,
    )
    p.users = users
  }
  // v18 used to drop attribution edges whose target was not a "strategic" initiative — one placed
  // on a portfolio board. The rule is now "any root initiative, wherever it sits", so that filter
  // is gone: an attribution to an initiative is valid wherever the initiative lives. The v12 rule
  // above still refuses attributions to cards, which is a fact about the model, not about a board.
  // v19: `Board.derived` (the "rollup board" flag) is gone — a parent's status already
  // rolls up from the work beneath it, with no per-board mode. Drop the stale flag.
  if (Array.isArray(p.boards)) {
    p.boards = (p.boards as (Board & { derived?: boolean })[]).map(({ derived: _derived, ...rest }) => rest)
  }
  // v20: boards gained `archived` / `archivedAt`. Both are optional, so nothing needs
  // backfilling — an absent flag simply means "not archived". Normalise instead: a board
  // that is not archived should carry neither key.
  if (Array.isArray(p.boards)) {
    p.boards = (p.boards as Board[]).map((b) => {
      if (b.archived) return b
      const { archived: _a, archivedAt: _at, ...rest } = b
      return rest
    })
  }
  // v21: board templates became a persisted collection. Older state simply has none.
  if (!Array.isArray(p.boardTemplates)) p.boardTemplates = []
  // v22: templates the product ships with. A built-in belongs to the app, not to a user's
  // data, so add any the stored state is missing — otherwise it would take a Reset to
  // appear for anyone who already had state.
  {
    const stored = p.boardTemplates as BoardTemplate[]
    const have = new Set(stored.map((t) => t.id))
    p.boardTemplates = [...stored, ...BUILT_IN_TEMPLATES.filter((t) => !have.has(t.id))]
  }
  // v23: and keep a built-in in step when its definition changes — the same ownership
  // rule, applied to updates rather than additions. Templates the user made are untouched.
  if (Array.isArray(p.boardTemplates)) {
    const builtIn = new Map(BUILT_IN_TEMPLATES.map((t) => [t.id, t]))
    p.boardTemplates = (p.boardTemplates as BoardTemplate[]).map((t) => builtIn.get(t.id) ?? t)
  }
  // v37: a template became a set of cards flows. A template stored before had one flat tree, so it
  // gets one flow named "Cards" and every lane names it; a template that already carries flows is
  // left alone, and a lane that is missing its flow joins the first one rather than becoming
  // unreachable. Idempotent, like the rest of this chain.
  if (Array.isArray(p.boardTemplates)) {
    p.boardTemplates = (p.boardTemplates as BoardTemplate[]).map((template) => {
      const flows: TemplateFlow[] =
        Array.isArray(template.flows) && template.flows.length > 0
          ? template.flows
          : [{ key: 'f0', kind: 'cards', name: 'Cards', order: 0 }]
      const first = flows[0].key
      return { ...template, flows, lanes: (template.lanes ?? []).map((lane) => (lane.flowKey ? lane : { ...lane, flowKey: first })) }
    })
  }
  // A template describes a team's flows or a program's initiatives. A portfolio's shape is its
  // objectives and the four typed columns, so a template stored for one is withdrawn rather than
  // offered as something that could not be applied.
  if (Array.isArray(p.boardTemplates)) {
    p.boardTemplates = (p.boardTemplates as BoardTemplate[]).filter((template) => template.band !== 'portfolio')
  }
  // Every template carries the initiatives flow now: both a team's board and a program's have one.
  // A template that already names one is untouched, so this is idempotent.
  if (Array.isArray(p.boardTemplates)) {
    p.boardTemplates = (p.boardTemplates as BoardTemplate[]).map((template) => withInitiatives(template))
  }
  // v24 → v36: a tree's identity used to be a two-value string on every lane, so a board had
  // exactly one tree per kind. A flow is now a record and a lane names it. This block gives every
  // board the flows its lanes imply — one cards flow named "Cards", one initiatives flow named
  // "Initiatives" — and, for state older than v24 where every lane was the one shared tree, adds
  // the initiatives tree those boards should always have had: the four typed sections, one cell
  // each, with every initiative's placement moved into the section its stage names. Idempotent:
  // a workspace that already carries flows is left exactly as it is.
  if (
    Array.isArray(p.lanes) &&
    (p.lanes as unknown[]).length > 0 &&
    (!Array.isArray(p.flows) || (p.flows as unknown[]).length === 0)
  ) {
    type LegacyLane = Lane & { workflow?: FlowKind }
    const stored = p.lanes as LegacyLane[]
    const flows: BoardFlow[] = []
    const flowIdOfBoardKind = new Map<string, string>()
    const flowOf = (boardId: string, kind: FlowKind): string => {
      const key = `${boardId}:${kind}`
      const known = flowIdOfBoardKind.get(key)
      if (known) return known
      const id = uid()
      flowIdOfBoardKind.set(key, id)
      flows.push({ id, boardId, kind, name: kind === 'cards' ? 'Cards' : 'Initiatives', order: 0 })
      return id
    }
    const lanes: Lane[] = stored.map((lane) => {
      const { workflow: legacy, ...rest } = lane
      return { ...rest, flowId: flowOf(lane.boardId, legacy ?? 'cards') }
    })

    // A board with no initiatives tree at all predates v24: give it the standard one.
    for (const board of (p.boards as Board[]) ?? []) {
      if (flowIdOfBoardKind.has(`${board.id}:initiatives`)) continue
      const flowId = flowOf(board.id, 'initiatives')
      const root: Lane = { id: uid(), boardId: board.id, parentId: null, order: 0, name: '', orientation: 'columns', flowId }
      lanes.push(root, ...defaultColumns(board.id, root.id, flowId, uid))
    }
    p.lanes = lanes
    p.flows = flows

    const initiativeType = initiativeTypeId((p.issueTypes as IssueType[]) ?? [])
    if (initiativeType && Array.isArray(p.placements)) {
      const kindOfFlow = new Map(flows.map((f) => [f.id, f.kind] as const))
      const byId = new Map(lanes.map((l) => [l.id, l]))
      const itemById = new Map(((p.items as Item[]) ?? []).map((i) => [i.id, i]))
      p.placements = (p.placements as Placement[]).map((pl) => {
        if (itemById.get(pl.itemId)?.typeId !== initiativeType) return pl
        const lane = byId.get(pl.laneId)
        if (!lane || kindOfFlow.get(lane.flowId) === 'initiatives') return pl
        const stage = effectiveStage(lanes, pl.laneId)
        const section = lanes.find(
          (l) => l.boardId === pl.boardId && kindOfFlow.get(l.flowId) === 'initiatives' && l.parentId !== null && l.stage === stage,
        )
        return section ? { ...pl, laneId: section.id } : pl
      })
    }
  }
  // v25: sub-tasks became a system type rather than a user choice — a decomposition child
  // is a Sub-task, and the panel no longer offers a type when adding one. Add it for
  // states that predate it, the way built-in templates arrive.
  if (Array.isArray(p.issueTypes) && !(p.issueTypes as IssueType[]).some((t) => t.name === 'Sub-task')) {
    p.issueTypes = [...(p.issueTypes as IssueType[]), { id: 't-subtask', name: 'Sub-task', color: '#94a3b8' }]
  }
  // The Feature Flow template offers Epic and Story, so the Epic type has to exist for
  // states that predate it.
  if (Array.isArray(p.issueTypes) && !(p.issueTypes as IssueType[]).some((t) => t.name === 'Epic')) {
    p.issueTypes = [...(p.issueTypes as IssueType[]), { id: 't-epic', name: 'Epic', color: '#8b5cf6' }]
  }
  // None is a built-in card type, always available. State from before it existed gains it here,
  // the way the built-in templates and the reserved types arrive.
  if (Array.isArray(p.issueTypes) && !(p.issueTypes as IssueType[]).some((t) => t.name === 'None')) {
    p.issueTypes = [...(p.issueTypes as IssueType[]), NONE_TYPE]
  }
  // v28: named filter sets became persisted data — the deliberate exception to filters
  // being view state. Older state simply has none.
  if (!Array.isArray(p.savedFilters)) p.savedFilters = []
  // v41: watching and the inbox. Older state watches nothing and has read nothing; both are
  // optional in the model, and a missing list is an empty one.
  if (!Array.isArray(p.watchedItemIds)) p.watchedItemIds = []
  else p.watchedItemIds = (p.watchedItemIds as unknown[]).filter((id): id is string => typeof id === 'string')
  // v43: how much of a card each board draws. Old state has no choice; every board opens Full.
  if (!p.boardDetail || typeof p.boardDetail !== 'object' || Array.isArray(p.boardDetail)) {
    p.boardDetail = {}
  } else {
    p.boardDetail = Object.fromEntries(
      Object.entries(p.boardDetail as Record<string, unknown>).filter(([, detail]) => isBoardDetail(detail)),
    )
  }
  if (!p.watchStartedAt || typeof p.watchStartedAt !== 'object' || Array.isArray(p.watchStartedAt)) {
    // A watch written before this migration has no start. It takes now, which is the same one-time
    // choice the server's migration makes: the history that was already in the feed stops being
    // news, and the next change is.
    const started = Date.now()
    p.watchStartedAt = Object.fromEntries(
      ((p.watchedItemIds as string[] | undefined) ?? []).map((id) => [id, started]),
    )
  } else {
    p.watchStartedAt = Object.fromEntries(
      Object.entries(p.watchStartedAt as Record<string, unknown>).filter(
        ([, at]) => typeof at === 'number' && Number.isFinite(at),
      ),
    )
  }
  if (typeof p.inboxReadAt !== 'number' || !Number.isFinite(p.inboxReadAt)) p.inboxReadAt = 0
  // v31: an initiative serves one objective, not several — attribution is a choice, not a set.
  // State from before the rule keeps the first objective each initiative was mapped to; the rest
  // were choices the model no longer offers, and keeping them would make the map, the OKR view and
  // the panel disagree with the rule they now keep. (v12 dropped attributions that pointed at
  // non-initiatives for the same reason: an edge the model would refuse is not an edge.)
  if (Array.isArray(p.edges)) {
    const mapped = new Set<string>()
    p.edges = (p.edges as Edge[]).filter((e) => {
      if (e.kind !== 'attribution') return true
      if (mapped.has(e.to)) return false
      mapped.add(e.to)
      return true
    })
  }
  // v33: a key result is a statement, not a measurement — its `progress`, `target` and `current`
  // fields are gone, because a number entered by hand cannot be connected to the work. The title
  // stays: it is what the objective means, and the numbers in it are the ones a person wrote.
  if (Array.isArray(p.keyResults)) {
    p.keyResults = (p.keyResults as (KeyResult & { target?: string; current?: string; progress?: number })[]).map((k) => {
      const { target: _t, current: _c, progress: _p, ...rest } = k
      return rest
    })
  }
  // v35: an item records who created it. State written before the field has the answer in its own
  // log — the 'created' entry carries `by` whenever the person was known — so the field is filled
  // from there rather than left blank for ever. An item whose log says nothing stays without one:
  // a name invented for it would be a guess dressed as a fact.
  if (Array.isArray(p.items)) {
    p.items = (p.items as (Item & { createdById?: string })[]).map((i) => {
      if (i.createdById) return i
      const by = (i.log ?? []).find((entry) => entry.kind === 'created')?.by
      return by ? { ...i, createdById: by } : i
    })
  }
  // v34: the board stopped counting points — a card has no estimate, and progress is the number
  // of issues done over the number below. State written before that loses the field, so a number
  // the model no longer has cannot come back through a reload, an import or a backup.
  if (Array.isArray(p.items)) {
    p.items = (p.items as (Item & { size?: number })[]).map((i) => {
      if (!('size' in i)) return i
      const { size: _gone, ...rest } = i
      return rest
    })
  }
  // v29: a board carries its own description. Backfill with the empty string.
  if (Array.isArray(p.boards)) {
    p.boards = (p.boards as unknown[]).map((b) => {
      const board = b as Record<string, unknown>
      return typeof board.description === 'string' ? board : { ...board, description: '' }
    })
  }
  // v38: a period is a record with a window of its own, and an objective names one. The label an
  // objective used to carry ("FY26 Q4") becomes the first period of that name — with no dates,
  // because nobody has told us its window and a date invented here would be a commitment on the
  // wrong day. The objective's score goes with the change: completeness is read from the work
  // below, and a number typed at the end of a period was a second answer to the same question.
  type LegacyObjective = Omit<Objective, 'periodId' | 'status'> & {
    periodId?: string
    period?: string
    score?: number
    status: Objective['status'] | 'reviewed' | 'scored'
  }
  if (Array.isArray(p.objectives)) {
    const periods: Period[] = Array.isArray(p.periods) ? (p.periods as Period[]) : []
    const idOfName = (name: string): string => {
      const label = name.trim() || 'Unnamed period'
      const known = periods.find((period) => period.name.trim().toLowerCase() === label.toLowerCase())
      if (known) return known.id
      const id = uid()
      periods.push({ id, name: label })
      return id
    }
    const orderAt = new Map<string, number>()
    p.objectives = (p.objectives as LegacyObjective[]).map((objective) => {
      const { period, score: _score, ...rest } = objective
      const periodId = objective.periodId ?? idOfName(period ?? '')
      // Ordering arrived after periods did: give every existing objective a place in its period,
      // in the order the list already read. A number that is already there is kept.
      const current = orderAt.get(periodId) ?? 0
      const order = typeof objective.order === 'number' ? objective.order : current
      orderAt.set(periodId, Math.max(current, order + 1))
      return {
        ...rest,
        periodId,
        status: normalizeObjectiveStatus(objective.status),
        order,
      }
    })
    p.periods = periods
  } else if (!Array.isArray(p.periods)) {
    p.periods = []
  }
  // v39: a card's history is now read in pages and merged by entry id, so the copy this browser
  // keeps is canonical: one entry per id, in `(at, id)` order. Older state was written whole and
  // could carry an order that a merge would not reproduce; normalising it here means a page read
  // and a stored log agree. Nothing is dropped that has a distinct id, and an item with no log is
  // left without one.
  if (Array.isArray(p.items)) {
    p.items = (p.items as Item[]).map((item) => {
      const log = item.log
      if (!log?.length) return item
      const byId = new Map(log.map((entry) => [entry.id, entry]))
      const canonical = [...byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
      return { ...item, log: canonical }
    })
  }
  // v40: the home's two shortcuts are this browser's. State written before them simply has none;
  // an id that is not a board here (deleted, or a board from a workspace this browser no longer
  // holds) is dropped rather than kept for a render to filter. Idempotent, like the rest of this
  // chain, so it also runs over an imported or adopted workspace.
  const boardIds = new Set(
    Array.isArray(p.boards)
      ? (p.boards as { id?: unknown }[])
          .map((board) => board?.id)
          .filter((id): id is string => typeof id === 'string')
      : [],
  )
  p.favouriteBoardIds = pruneFavourites(
    Array.isArray(p.favouriteBoardIds) ? (p.favouriteBoardIds as string[]) : [],
    boardIds,
  )
  p.recentBoards = pruneVisits(
    Array.isArray(p.recentBoards) ? (p.recentBoards as BoardVisit[]) : [],
    boardIds,
  )
  return p as Partial<Store>
}

/**
 * Persisted-state migration. The board model has been reshaped several times, so any
 * state older than v5 is reseeded with the current demo design.
 */
export function migratePersisted(persisted: unknown, version: number): Partial<Store> {
  // A workspace below the migration floor is never replaced by the demo: the boot check moves it
  // aside before the store is created, so reaching here is a bug — and the honest answer to a bug
  // is to refuse, not to seed over someone's work.
  if (version < MIN_MIGRATABLE_VERSION) {
    throw new Error(
      `Cannot migrate a workspace written at version ${version}; this build migrates ${MIN_MIGRATABLE_VERSION} and later.`,
    )
  }
  // v30 added meUserId (whose browser this is): optional, so an old file reads undefined
  // with nothing to backfill — migrateState passes it through untouched.
  return migrateState(persisted)
}

