import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  Ban,
  CalendarClock,
  Check,
  ChevronRight,
  Copy,
  Flag,
  FolderInput,
  Minus,
  MoreHorizontal,
  Ruler,
  Shapes,
  ShieldCheck,
  Tag,
  Trash2,
  UserPlus,
  CornerDownRight,
  Unlink,
} from 'lucide-react'
import { boardInitiativeTypes, cardTypes, initiativeTypeById, isAggregating, isInitiativeItem, placementOn } from '@/domain/board'
import { decompositionParent } from '@/domain/derive'
import { PRIORITY_META, PRIORITY_ORDER, type Priority } from './PriorityBadge'
import { lanePath, leafLanes } from '@/domain/lanes'
import { initialsOf } from '@/domain/users'
import { cn } from '@/lib/utils'
import { heldByOther, usePresence } from '@/lib/presence'
import { useStore } from '@/store'

interface Props {
  /** The cards this menu acts on — a selection group, or just the one. */
  itemIds: string[]
  /** The right-clicked card, for 'Open'. */
  x: number
  y: number
  onClose: () => void
}

type Panel = 'move' | 'priority' | 'assignee' | 'type' | 'kind' | 'size' | 'start' | 'end' | 'block'

const ITEM = 'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta text-slate-700 transition hover:bg-slate-100'
const FIELD = 'min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-meta outline-none focus:ring-2 focus:ring-indigo-400'
const FLYOUT = 'fixed z-50 max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-2xl'

/**
 * The card context menu. Opens at the pointer (or from the card's ⋯ button) and
 * acts on the whole selection group when the card is part of one. Sub-actions
 * fly out to the side, and flip left near the viewport edge.
 */
export function CardMenu({ itemIds, x, y, onClose }: Props) {
  const items = useStore((s) => s.items)
  const placements = useStore((s) => s.placements)
  const setItemFields = useStore((s) => s.setItemFields)
  const boardId = useStore((s) => s.boardId)
  const duplicateCard = useStore((s) => s.duplicateCard)
  const boards = useStore((s) => s.boards)
  // An aggregating board shows bands, not a cards workflow: there is no card to connect to.
  const aggregating = isAggregating(boards.find((b) => b.id === boardId))
  const lanes = useStore((s) => s.lanes)
  const users = useStore((s) => s.users)
  const issueTypes = useStore((s) => s.issueTypes)
  const moveCardsToLane = useStore((s) => s.moveCardsToLane)
  const setParent = useStore((s) => s.setParent)
  const startParentPick = useStore((s) => s.startParentPick)
  const startChildPick = useStore((s) => s.startChildPick)
  const edges = useStore((s) => s.edges)
  const setItemsType = useStore((s) => s.setItemsType)
  const setItemsKind = useStore((s) => s.setItemsKind)
  const addItemsAssignee = useStore((s) => s.addItemsAssignee)
  const removeItemsAssignee = useStore((s) => s.removeItemsAssignee)
  const setItemsSize = useStore((s) => s.setItemsSize)
  const setItemsTargetStart = useStore((s) => s.setItemsTargetStart)
  const setItemsTargetEnd = useStore((s) => s.setItemsTargetEnd)
  const blockItems = useStore((s) => s.blockItems)
  const unblockItems = useStore((s) => s.unblockItems)
  const archiveItems = useStore((s) => s.archiveItems)
  const askConfirm = useStore((s) => s.askConfirm)

  const [open, setOpen] = useState<Panel | null>(null)
  const [subPos, setSubPos] = useState<{ top: number; left: number } | null>(null)
  const [draft, setDraft] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)

  const targets = items.filter((i) => itemIds.includes(i.id))
  const count = targets.length
  const single = count === 1
  const only = targets[0]
  const types = cardTypes(issueTypes)
  // The Initiative type is reserved: an initiative is never retyped, so the menu does not
  // offer it — not even as a mixed selection where it would apply to some of the group.
  const selectionHasInitiative = itemIds.some((id) => isInitiativeItem(items.find((i) => i.id === id), issueTypes))
  // A kind is only ever an initiative's, so the menu offers it only when the whole selection is
  // initiatives — the mirror of hiding Type whenever any of it is one. Nothing here would apply
  // to "some of the group".
  const selectionAllInitiatives = itemIds.length > 0 && itemIds.every((id) => isInitiativeItem(items.find((i) => i.id === id), issueTypes))
  // The kinds of the board the menu is on, and the one this initiative actually wears — which may
  // be a kind defined on another board, and is still shown so the menu does not lie about it.
  const kinds = boardInitiativeTypes(boards.find((b) => b.id === boardId))
  const kind = initiativeTypeById(boards, only?.initiativeTypeId)
  const kindElsewhere = kind && !kinds.some((k) => k.id === kind.id)
  const lanesLeaf = leafLanes(lanes, boardId, 'cards')
  const anyBlocked = targets.some((t) => t.blocked)
  const allBlocked = count > 0 && targets.every((t) => t.blocked)
  // Duplicating is offered for a card that is in a cell of the board in front of us: the copy
  // lands in that cell, so a card with no cell here — read inside another board's band, or on a
  // surface that has no board behind it — has nowhere for a copy to go.
  const cell = single && only ? placementOn(placements, only.id, boardId) : undefined

  // Escape closes the flyout first, then the menu; a click outside closes both.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (open) setOpen(null)
      else onClose()
    }
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest('[data-card-menu]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, onClose])

  // Focus the first action, then the flyout's field when one opens.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('button')?.focus()
  }, [])
  useEffect(() => {
    if (open) document.querySelector<HTMLElement>('[data-card-flyout] input, [data-card-flyout] textarea')?.focus()
  }, [open])

  // A content change on a card somebody else holds is refused here as well as on the server: a
  // menu that offers an action the server will refuse is a menu that lies.
  const locks = usePresence((state) => state.locks)
  const held = itemIds.map((id) => heldByOther(locks, id)).find(Boolean)

  const run = (fn: () => void) => {
    if (held) return
    fn()
    onClose()
  }

  /** Arrangement is not the lease's business: a card someone is editing can still be moved. */
  const runMove = (fn: () => void) => {
    fn()
    onClose()
  }

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setOpen(null), 160)
  }

  /** Fly the submenu out beside its header, flipping left near the edge. */
  const openSub = (key: Panel, el: HTMLElement, initial = '') => {
    cancelClose()
    const r = el.getBoundingClientRect()
    const width = 240
    const flip = r.right + width + 8 > window.innerWidth
    setOpen(key)
    setDraft(initial)
    setSubPos({ top: Math.min(r.top - 4, window.innerHeight - 260), left: flip ? r.left - width - 4 : r.right + 4 })
  }

  const onArrow = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const nodes = [...(menuRef.current?.querySelectorAll<HTMLElement>('button') ?? [])]
    const i = nodes.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, nodes.length - 1) : Math.max(i - 1, 0)
    nodes[next]?.focus()
  }

  const header = (key: Panel, icon: React.ReactNode, label: string, initial = '') => (
    <button
      className={cn(ITEM, open === key && 'bg-slate-100')}
      aria-haspopup="menu"
      aria-expanded={open === key}
      onMouseEnter={(e) => openSub(key, e.currentTarget, initial)}
      onMouseLeave={scheduleClose}
      onFocus={(e) => openSub(key, e.currentTarget, initial)}
      onClick={(e) => (open === key ? setOpen(null) : openSub(key, e.currentTarget, initial))}
    >
      <span className="shrink-0 text-slate-600">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight size={12} className="shrink-0 text-slate-300" />
    </button>
  )

  const assigneeAllHave = (userId: string) => count > 0 && targets.every((t) => (t.assignees ?? []).includes(userId))

  const flyout = () => {
    if (!open || !subPos) return null
    const wrap = (children: React.ReactNode, width = 'w-60') => (
      <div
        data-card-menu
        data-card-flyout
        role="menu"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        style={{ top: subPos.top, left: subPos.left }}
        className={cn(FLYOUT, width)}
      >
        {children}
      </div>
    )

    if (open === 'move') {
      return wrap(
        lanesLeaf.map((l) => (
          <button key={l.id} className={cn(ITEM, 'pl-2.5')} onClick={() => runMove(() => moveCardsToLane(itemIds, l.id))}>
            {lanePath(lanes, l.id).join(' / ')}
          </button>
        )),
      )
    }

    if (open === 'priority') {
      const set = (p: Priority | undefined) => itemIds.forEach((id) => setItemFields(id, { priority: p }))
      return wrap(
        <>
          <button className={cn(ITEM, 'pl-2.5')} onClick={() => run(() => set(undefined))}>
            <Minus size={13} className="shrink-0 text-slate-400" />
            <span className="flex-1">None</span>
            {!only?.priority && <Check size={12} className="shrink-0 text-indigo-600" />}
          </button>
          {PRIORITY_ORDER.map((p) => {
            const { label, icon: Icon, dot } = PRIORITY_META[p]
            return (
              <button key={p} className={cn(ITEM, 'pl-2.5')} onClick={() => run(() => set(p))}>
                <Icon size={13} className={cn('shrink-0', dot)} />
                <span className="flex-1">{label}</span>
                {only?.priority === p && <Check size={12} className="shrink-0 text-indigo-600" />}
              </button>
            )
          })}
        </>,
      )
    }

    if (open === 'type') {
      return wrap(
        types.map((t) => (
          <button key={t.id} className={cn(ITEM, 'pl-2.5')} onClick={() => run(() => setItemsType(itemIds, t.id))}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
            <span className="flex-1">{t.name}</span>
          </button>
        )),
      )
    }

    if (open === 'kind') {
      const set = (id: string | undefined) => setItemsKind(itemIds, id)
      const mark = (id: string | undefined) => single && only?.initiativeTypeId === id
      return wrap(
        <>
          <button className={cn(ITEM, 'pl-2.5')} onClick={() => run(() => set(undefined))}>
            <Minus size={13} className="shrink-0 text-slate-400" />
            <span className="flex-1">None</span>
            {mark(undefined) && <Check size={12} className="shrink-0 text-indigo-600" />}
          </button>
          {kinds.map((k) => (
            <button key={k.id} className={cn(ITEM, 'pl-2.5')} onClick={() => run(() => set(k.id))}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: k.color }} />
              <span className="flex-1">{k.name}</span>
              {mark(k.id) && <Check size={12} className="shrink-0 text-indigo-600" />}
            </button>
          ))}
          {kindElsewhere && (
            <button className={cn(ITEM, 'pl-2.5')} onClick={() => run(() => set(kind.id))}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: kind.color }} />
              <span className="flex-1">{kind.name}</span>
              <span className="shrink-0 text-micro text-slate-500">another board</span>
              {mark(kind.id) && <Check size={12} className="shrink-0 text-indigo-600" />}
            </button>
          )}
        </>,
      )
    }

    if (open === 'assignee') {
      return wrap(
        <>
          {users.map((u) => (
            <label key={u.id} className={cn(ITEM, 'cursor-pointer pl-2.5')}>
              <input
                type="checkbox"
                checked={assigneeAllHave(u.id)}
                onChange={(e) => (e.target.checked ? addItemsAssignee(itemIds, u.name) : removeItemsAssignee(itemIds, u.id))}
              />
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-slate-700 text-micro font-bold text-white">
                {initialsOf(u.name)}
              </span>
              <span className="flex-1">{u.name}</span>
            </label>
          ))}
          <div className="flex items-center gap-1 px-2.5 py-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) run(() => addItemsAssignee(itemIds, draft))
              }}
              placeholder="new person…"
              className={FIELD}
            />
            <button
              disabled={!draft.trim()}
              onClick={() => run(() => addItemsAssignee(itemIds, draft))}
              className="rounded bg-slate-800 px-2 py-1 text-meta font-medium text-white disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </>,
      )
    }

    if (open === 'size') {
      const apply = () => setItemsSize(itemIds, draft.trim() === '' ? undefined : Math.max(0, Number(draft) || 0))
      return wrap(
        <div className="flex items-center gap-1 px-2.5 py-1.5">
          <input
            type="number"
            min={0}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run(apply)
            }}
            placeholder="points"
            className={FIELD}
          />
          <button onClick={() => run(apply)} className="rounded bg-slate-800 px-2 py-1 text-meta font-medium text-white">
            Set
          </button>
        </div>,
        'w-48',
      )
    }

    if (open === 'start' || open === 'end') {
      const apply = (date: string | undefined) =>
        open === 'start' ? setItemsTargetStart(itemIds, date) : setItemsTargetEnd(itemIds, date)
      return wrap(
        <div className="flex items-center gap-1 px-2.5 py-1.5">
          <input type="date" value={draft} onChange={(e) => setDraft(e.target.value)} className={FIELD} />
          <button onClick={() => run(() => apply(draft || undefined))} className="rounded bg-slate-800 px-2 py-1 text-meta font-medium text-white">
            Set
          </button>
          <button
            onClick={() => run(() => apply(undefined))}
            className="rounded px-1.5 py-1 text-meta font-medium text-slate-600 hover:bg-slate-200"
          >
            Clear
          </button>
        </div>,
        'w-64',
      )
    }

    // block
    return wrap(
      <div className="flex items-center gap-1 px-2.5 py-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run(() => blockItems(itemIds, draft))
          }}
          placeholder="Reason (optional)…"
          className={FIELD}
        />
        <button
          onClick={() => run(() => blockItems(itemIds, draft))}
          className="rounded bg-rose-600 px-2 py-1 text-meta font-medium text-white hover:bg-rose-700"
        >
          Block
        </button>
      </div>,
    )
  }

  return (
    <>
      <div
        ref={menuRef}
        data-card-menu
        role="menu"
        aria-label="Card actions"
        onKeyDown={onArrow}
        style={{ top: Math.min(y, window.innerHeight - 340), left: Math.min(x, window.innerWidth - 264) }}
        className="fixed z-50 max-h-[70vh] w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-2xl"
      >
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-micro font-bold uppercase tracking-wide text-slate-600">
          <MoreHorizontal size={12} />
          {single ? (only?.title ?? 'Card') : `${count} cards`}
        </div>

        {held && (
          <p className="mx-2.5 mb-1 rounded-md bg-amber-50 px-2 py-1 text-meta text-amber-900">
            {held.holderName} is editing {single ? 'this card' : 'one of these cards'}. Everything
            except moving it is theirs until they are done.
          </p>
        )}

        {/* Lineage, for one card: point at the initiative it rolls up to, rather than hunting
            for it in a list of every item by name. */}
        {single && (
          <button className={ITEM} onClick={() => run(() => startParentPick(only!.id))}>
            <span className="shrink-0 text-slate-600">
              <CornerDownRight size={13} />
            </span>
            <span className="flex-1">Set parent…</span>
          </button>
        )}
        {/* The same edge, named from the initiative: you are looking at an outcome and want to
            pull work under it, which is when the connection is actually in your head. Not on an
            aggregating board, which renders no cards workflow — there would be nothing to pick. */}
        {single && only && isInitiativeItem(only, issueTypes) && !aggregating && (
          <button className={ITEM} onClick={() => run(() => startChildPick(only.id))}>
            <span className="shrink-0 text-slate-600">
              <CornerDownRight size={13} className="-scale-x-100" />
            </span>
            <span className="flex-1">Connect a card…</span>
          </button>
        )}
        {single && only && decompositionParent(only.id, edges) && (
          <button className={ITEM} onClick={() => run(() => setParent(only.id, null))}>
            <span className="shrink-0 text-slate-600">
              <Unlink size={13} />
            </span>
            <span className="flex-1">Remove parent</span>
          </button>
        )}
        {/* An initiative does not live in a lane — it lives in a cell of a section, and moves
            between them. Offering a card's lanes for one would be offering the wrong tree. */}
        {!selectionHasInitiative && header('move', <FolderInput size={13} />, 'Move to lane')}
        {header('priority', <Flag size={13} />, 'Priority', single && only?.priority ? PRIORITY_META[only.priority].label : '')}
        {header('assignee', <UserPlus size={13} />, 'Assignees')}
        {/* An initiative is not retyped: the type is what makes it one, and the
            initiatives workflow reads it. */}
        {!selectionHasInitiative && header('type', <Tag size={13} />, 'Type')}
        {selectionAllInitiatives && header('kind', <Shapes size={13} />, 'Kind')}
        {/* An initiative has no estimate of its own: its size is the sum of the sizes of the
            items below it, so there is nothing here to set. */}
        {!selectionHasInitiative && header('size', <Ruler size={13} />, 'Size', single ? String(only?.size ?? '') : '')}
        {header('start', <CalendarClock size={13} />, 'Target start', single ? only?.targetStartDate ?? '' : '')}
        {header('end', <CalendarClock size={13} />, 'Target end', single ? only?.targetEndDate ?? '' : '')}
        {!allBlocked && header('block', <Ban size={13} />, 'Block…')}
        {anyBlocked && (
          <button className={ITEM} onClick={() => run(() => unblockItems(itemIds))}>
            <span className="shrink-0 text-slate-600">
              <ShieldCheck size={13} />
            </span>
            <span className="flex-1">Unblock</span>
          </button>
        )}

        <div className="my-1 border-t border-slate-100" />

        {/* The "copy me" template: a new card with this one's shape and none of its
            commitments. Absent for an initiative, which is defined by its type and reads in a
            section derived from the work below — a copy of it would have no cell it could
            read in. (The menu does not open at all while the board is being designed: a
            locked card opens nothing, and the store refuses a copy then regardless.) */}
        {single && only && !isInitiativeItem(only, issueTypes) && (
          cell ? (
            <button className={ITEM} onClick={() => run(() => duplicateCard(only.id))}>
              <span className="shrink-0 text-slate-600">
                <Copy size={13} />
              </span>
              <span className="flex-1">Duplicate</span>
            </button>
          ) : (
            // A copy lands in the original's cell, and this card is not in one here. Shown
            // rather than hidden, so the missing affordance explains itself.
            <span title="A copy lands in the original's cell — this card is not in a cell on this board">
              <button disabled className={cn(ITEM, 'cursor-not-allowed opacity-50')}>
                <span className="shrink-0 text-slate-400">
                  <Copy size={13} />
                </span>
                <span className="flex-1">Duplicate</span>
                <span className="text-micro text-slate-500">not in a cell here</span>
              </button>
            </span>
          )
        )}

        <button className={ITEM} onClick={() => run(() => archiveItems(itemIds))}>
          <span className="shrink-0 text-slate-600">
            <Archive size={13} />
          </span>
          <span className="flex-1">Archive</span>
        </button>
        <button
          className={cn(ITEM, 'text-rose-600 hover:bg-rose-50')}
          onClick={() =>
            run(() =>
              askConfirm({
                title: `Delete ${count} card${count === 1 ? '' : 's'}?`,
                body: "This can't be undone.",
                confirmLabel: `Delete ${count}`,
                danger: true,
                onConfirm: () => useStore.getState().deleteItems(itemIds),
              }),
            )
          }
        >
          <span className="shrink-0">
            <Trash2 size={13} />
          </span>
          <span className="flex-1">Delete</span>
        </button>
      </div>
      {flyout()}
    </>
  )
}
