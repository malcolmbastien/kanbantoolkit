import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Ban,
  CalendarClock,
  Check,
  ChevronRight,
  Flag,
  FolderInput,
  Minus,
  MoreHorizontal,
  Ruler,
  ShieldCheck,
  Tag,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { cardTypes, isInitiativeItem } from '@/domain/board'
import { PRIORITY_META, PRIORITY_ORDER, type Priority } from './PriorityBadge'
import { lanePath, leafLanes } from '@/domain/lanes'
import { initialsOf } from '@/domain/users'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

interface Props {
  /** The cards this menu acts on — a selection group, or just the one. */
  itemIds: string[]
  /** The right-clicked card, for 'Open'. */
  anchorId: string
  x: number
  y: number
  onClose: () => void
}

type Panel = 'move' | 'priority' | 'assignee' | 'type' | 'size' | 'start' | 'end' | 'block'

const ITEM = 'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta text-slate-700 transition hover:bg-slate-100'
const FIELD = 'min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-meta outline-none focus:ring-2 focus:ring-indigo-400'
const FLYOUT = 'fixed z-50 max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-2xl'

/**
 * The card context menu. Opens at the pointer (or from the card's ⋯ button) and
 * acts on the whole selection group when the card is part of one. Sub-actions
 * fly out to the side, and flip left near the viewport edge.
 */
export function CardMenu({ itemIds, anchorId, x, y, onClose }: Props) {
  const items = useStore((s) => s.items)
  const setItemFields = useStore((s) => s.setItemFields)
  const moveCardRank = useStore((s) => s.moveCardRank)
  const boardId = useStore((s) => s.boardId)
  const lanes = useStore((s) => s.lanes)
  const users = useStore((s) => s.users)
  const issueTypes = useStore((s) => s.issueTypes)
  const openItem = useStore((s) => s.openItem)
  const moveCardsToLane = useStore((s) => s.moveCardsToLane)
  const setItemsType = useStore((s) => s.setItemsType)
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
  const lanesLeaf = leafLanes(lanes, boardId, 'cards')
  const anyBlocked = targets.some((t) => t.blocked)
  const allBlocked = count > 0 && targets.every((t) => t.blocked)

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

  const run = (fn: () => void) => {
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
          <button key={l.id} className={cn(ITEM, 'pl-2.5')} onClick={() => run(() => moveCardsToLane(itemIds, l.id))}>
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

        {single && (
          <button className={ITEM} onClick={() => run(() => openItem(anchorId))}>
            <span className="shrink-0 text-slate-600">
              <FolderInput size={13} />
            </span>
            <span className="flex-1">Open</span>
          </button>
        )}

        {/* Rank, for the selected card only: order within a lane is how a board expresses
            priority, and a menu item is the keyboard-reachable half of it. */}
        {single && (
          <>
            <button className={ITEM} onClick={() => run(() => moveCardRank(only!.id, boardId, -1))}>
              <span className="shrink-0 text-slate-600">
                <ArrowUp size={13} />
              </span>
              <span className="flex-1">Move up</span>
            </button>
            <button className={ITEM} onClick={() => run(() => moveCardRank(only!.id, boardId, 1))}>
              <span className="shrink-0 text-slate-600">
                <ArrowDown size={13} />
              </span>
              <span className="flex-1">Move down</span>
            </button>
          </>
        )}
        {header('move', <FolderInput size={13} />, 'Move to lane')}
        {header('priority', <Flag size={13} />, 'Priority', single && only?.priority ? PRIORITY_META[only.priority].label : '')}
        {header('assignee', <UserPlus size={13} />, 'Assignees')}
        {/* An initiative is not retyped: the type is what makes it one, and the
            initiatives workflow reads it. */}
        {!selectionHasInitiative && header('type', <Tag size={13} />, 'Type')}
        {header('size', <Ruler size={13} />, 'Size', single ? String(only?.size ?? '') : '')}
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
