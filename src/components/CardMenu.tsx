import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  Ban,
  CalendarClock,
  ChevronRight,
  FolderInput,
  MoreHorizontal,
  Ruler,
  ShieldCheck,
  Tag,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { boardCardTypes } from '@/domain/board'
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

type Panel = 'move' | 'assignee' | 'type' | 'size' | 'start' | 'end' | 'block'

const ITEM = 'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-slate-700 transition hover:bg-slate-100'
const FIELD = 'min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[12px] outline-none focus:ring-2 focus:ring-indigo-400'

/**
 * The card context menu. Opens at the pointer (or from the card's ⋯ button) and
 * acts on the whole selection group when the card is part of one. Sub-actions
 * that need a value expand inline.
 */
export function CardMenu({ itemIds, anchorId, x, y, onClose }: Props) {
  const items = useStore((s) => s.items)
  const boards = useStore((s) => s.boards)
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

  const [panel, setPanel] = useState<Panel | null>(null)
  const [draft, setDraft] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  const targets = items.filter((i) => itemIds.includes(i.id))
  const count = targets.length
  const single = count === 1
  const only = targets[0]
  const board = boards.find((b) => b.id === boardId)
  const types = boardCardTypes(board, issueTypes)
  const lanesLeaf = leafLanes(lanes, boardId)
  const anyBlocked = targets.some((t) => t.blocked)
  const allBlocked = count > 0 && targets.every((t) => t.blocked)

  // Escape closes; a click outside closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  // Focus the first action, then the panel's field when one opens.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('button')?.focus()
  }, [])
  useEffect(() => {
    if (panel) menuRef.current?.querySelector<HTMLElement>('input, textarea')?.focus()
  }, [panel])

  const run = (fn: () => void) => {
    fn()
    onClose()
  }
  const expand = (next: Panel, initial = '') => {
    setPanel((p) => (p === next ? null : next))
    setDraft(initial)
  }

  const onArrow = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const nodes = [...(menuRef.current?.querySelectorAll<HTMLElement>('button') ?? [])]
    const i = nodes.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, nodes.length - 1) : Math.max(i - 1, 0)
    nodes[next]?.focus()
  }

  const header = (icon: React.ReactNode, label: string, open: boolean, onClick: () => void) => (
    <button className={cn(ITEM, open && 'bg-slate-100')} onClick={onClick}>
      <span className="shrink-0 text-slate-400">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight size={12} className={cn('shrink-0 text-slate-300 transition', open && 'rotate-90')} />
    </button>
  )

  const assigneeAllHave = (userId: string) => count > 0 && targets.every((t) => (t.assignees ?? []).includes(userId))

  return (
    <div
      ref={menuRef}
      data-card-menu
      role="menu"
      aria-label="Card actions"
      onKeyDown={onArrow}
      style={{ top: Math.min(y, window.innerHeight - 340), left: Math.min(x, window.innerWidth - 264) }}
      className="fixed z-50 max-h-[70vh] w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-2xl"
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        <MoreHorizontal size={12} />
        {single ? (only?.title ?? 'Card') : `${count} cards`}
      </div>

      {single && (
        <button className={ITEM} onClick={() => run(() => openItem(anchorId))}>
          <span className="shrink-0 text-slate-400">
            <FolderInput size={13} />
          </span>
          <span className="flex-1">Open</span>
        </button>
      )}

      {header(<FolderInput size={13} />, 'Move to lane', panel === 'move', () => expand('move'))}
      {panel === 'move' && (
        <div className="max-h-56 overflow-y-auto border-y border-slate-100 bg-slate-50 py-1">
          {lanesLeaf.map((l) => (
            <button key={l.id} className={cn(ITEM, 'pl-7')} onClick={() => run(() => moveCardsToLane(itemIds, l.id))}>
              {lanePath(lanes, l.id).join(' / ')}
            </button>
          ))}
        </div>
      )}

      {header(<UserPlus size={13} />, 'Assignees', panel === 'assignee', () => expand('assignee'))}
      {panel === 'assignee' && (
        <div className="border-y border-slate-100 bg-slate-50 py-1">
          {users.map((u) => (
            <label key={u.id} className={cn(ITEM, 'cursor-pointer pl-7')}>
              <input
                type="checkbox"
                checked={assigneeAllHave(u.id)}
                onChange={(e) => (e.target.checked ? addItemsAssignee(itemIds, u.name) : removeItemsAssignee(itemIds, u.id))}
              />
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-slate-700 text-[8px] font-bold text-white">
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
              className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {header(<Tag size={13} />, 'Type', panel === 'type', () => expand('type'))}
      {panel === 'type' && (
        <div className="border-y border-slate-100 bg-slate-50 py-1">
          {types.map((t) => (
            <button key={t.id} className={cn(ITEM, 'pl-7')} onClick={() => run(() => setItemsType(itemIds, t.id))}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
              <span className="flex-1">{t.name}</span>
            </button>
          ))}
        </div>
      )}

      {header(<Ruler size={13} />, 'Size', panel === 'size', () => expand('size', single ? String(only?.size ?? '') : ''))}
      {panel === 'size' && (
        <div className="flex items-center gap-1 border-y border-slate-100 bg-slate-50 px-2.5 py-1.5">
          <input
            type="number"
            min={0}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run(() => setItemsSize(itemIds, draft.trim() === '' ? undefined : Math.max(0, Number(draft) || 0)))
            }}
            placeholder="points"
            className={FIELD}
          />
          <button
            onClick={() => run(() => setItemsSize(itemIds, draft.trim() === '' ? undefined : Math.max(0, Number(draft) || 0)))}
            className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white"
          >
            Set
          </button>
        </div>
      )}

      {(['start', 'end'] as const).map((which) => {
        const label = which === 'start' ? 'Target start' : 'Target end'
        const value = single ? (which === 'start' ? only?.targetStartDate : only?.targetEndDate) ?? '' : ''
        const apply = (date: string | undefined) =>
          which === 'start' ? setItemsTargetStart(itemIds, date) : setItemsTargetEnd(itemIds, date)
        return (
          <div key={which}>
            {header(<CalendarClock size={13} />, label, panel === which, () => expand(which, value))}
            {panel === which && (
              <div className="flex items-center gap-1 border-y border-slate-100 bg-slate-50 px-2.5 py-1.5">
                <input
                  type="date"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className={FIELD}
                />
                <button
                  onClick={() => run(() => apply(draft || undefined))}
                  className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white"
                >
                  Set
                </button>
                <button
                  onClick={() => run(() => apply(undefined))}
                  className="rounded px-1.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-200"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        )
      })}

      {!allBlocked && header(<Ban size={13} />, 'Block…', panel === 'block', () => expand('block'))}
      {panel === 'block' && (
        <div className="flex items-center gap-1 border-y border-slate-100 bg-slate-50 px-2.5 py-1.5">
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
            className="rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-700"
          >
            Block
          </button>
        </div>
      )}
      {anyBlocked && (
        <button className={ITEM} onClick={() => run(() => unblockItems(itemIds))}>
          <span className="shrink-0 text-slate-400">
            <ShieldCheck size={13} />
          </span>
          <span className="flex-1">Unblock</span>
        </button>
      )}

      <div className="my-1 border-t border-slate-100" />

      <button className={ITEM} onClick={() => run(() => archiveItems(itemIds))}>
        <span className="shrink-0 text-slate-400">
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
  )
}
