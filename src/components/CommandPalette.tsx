import { useEffect, useMemo, useRef, useState } from 'react'
import { Command, LayoutGrid, Search } from 'lucide-react'
import { isInitiativeItem } from '@/domain/board'
import { KIND_LABEL, rankEntries, type PaletteEntry, type PaletteKind } from '@/domain/palette'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

interface Props {
  onNewCard: () => void
  onNewInitiative: () => void
  /** False on a board that renders no cards workflow — the same rule the toolbar's button keeps. */
  makesCards: boolean
}

/**
 * The command palette: ⌘K (or Ctrl-K) from anywhere, type a few letters, press Enter.
 *
 * One list, ranked — boards to switch to, cards to open, and the app's own verbs — because a
 * palette is only worth having if it is the fastest way to the thing you already know the name of.
 * The matcher is a subsequence match (`src/domain/palette.ts`), so "nsf" finds "New signup flow"
 * and nothing is guessed at.
 *
 * An empty palette is not blank: it leads with the cards opened lately, then the boards, then the
 * actions. That list is view state — it is about this session, not about the work.
 */
export function CommandPalette({ onNewCard, onNewInitiative, makesCards }: Props) {
  const items = useStore((s) => s.items)
  const boards = useStore((s) => s.boards)
  const placements = useStore((s) => s.placements)
  const issueTypes = useStore((s) => s.issueTypes)
  const recentItemIds = useStore((s) => s.recentItemIds)
  const selectBoard = useStore((s) => s.selectBoard)
  const openItem = useStore((s) => s.openItem)
  const setBoard = useStore((s) => s.setBoard)
  const setDashboard = useStore((s) => s.setDashboard)
  const setTimeline = useStore((s) => s.setTimeline)
  const setMetrics = useStore((s) => s.setMetrics)
  const setArchive = useStore((s) => s.setArchive)
  const setMyWork = useStore((s) => s.setMyWork)
  const setObjectives = useStore((s) => s.setObjectives)
  const setBoards = useStore((s) => s.setBoards)
  const toggleFilters = useStore((s) => s.toggleFilters)
  const toggleLegend = useStore((s) => s.toggleLegend)
  const toggleBoardSettings = useStore((s) => s.toggleBoardSettings)
  const beginEdit = useStore((s) => s.beginEdit)
  const editMode = useStore((s) => s.editMode)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // ⌘K / Ctrl-K from anywhere, and again to close. The palette is a layer, not a view: it never
  // changes what is behind it until something is chosen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
        setQuery('')
        setActive(0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const boardName = (id: string) => boards.find((b) => b.id === id)?.name

  const boardEntry = (id: string): PaletteEntry => {
    const board = boards.find((b) => b.id === id)
    return {
      id: `board:${id}`,
      kind: 'board',
      label: board?.name ?? 'Board',
      hint: `${board?.band ?? 'team'} board`,
      keywords: board?.description,
    }
  }

  const itemEntry = (id: string, kind: PaletteKind = 'item'): PaletteEntry => {
    const item = items.find((i) => i.id === id)
    return {
      id: `item:${id}`,
      kind,
      label: item?.title ?? 'Card',
      hint: boardName(placements.find((p) => p.itemId === id)?.boardId ?? ''),
      keywords: isInitiativeItem(item, issueTypes) ? 'initiative' : 'card',
    }
  }

  /** The app's own verbs, each one the same call the button makes. */
  const actions: (PaletteEntry & { run: () => void })[] = useMemo(
    () => [
      ...(makesCards
        ? [{ id: 'action:new-card', kind: 'action' as PaletteKind, label: 'New card', hint: 'Add a card to this board', keywords: 'create add task story bug', run: onNewCard }]
        : []),
      { id: 'action:new-initiative', kind: 'action', label: 'New initiative', hint: 'Add an initiative to this board', keywords: 'create outcome', run: onNewInitiative },
      ...(editMode
        ? []
        : [{ id: 'action:edit', kind: 'action' as PaletteKind, label: 'Edit board design', hint: 'Split, add, rename and delete lanes', keywords: 'lanes columns rows wip', run: beginEdit }]),
      { id: 'action:filters', kind: 'action', label: 'Filters', hint: 'Narrow the cards shown on this board', keywords: 'find narrow', run: toggleFilters },
      { id: 'action:legend', kind: 'action', label: 'Legend', hint: 'What this board means and how to read it', keywords: 'help explain colours', run: toggleLegend },
      { id: 'action:settings', kind: 'action', label: 'Board settings', hint: 'Band, WIP enforcement, default drop cell', keywords: 'configure', run: toggleBoardSettings },
      { id: 'action:board', kind: 'action', label: 'Go to the board', hint: 'Leave whatever view is open', keywords: 'back home', run: setBoard },
      { id: 'action:dashboard', kind: 'action', label: 'Dashboard', hint: "This board's initiatives", keywords: 'summary overview', run: () => setDashboard(true) },
      { id: 'action:timeline', kind: 'action', label: 'Timeline', hint: "This board's initiatives over time", keywords: 'dates gantt', run: () => setTimeline(true) },
      { id: 'action:flow', kind: 'action', label: 'Flow metrics', hint: 'Lead time, cycle time, throughput', keywords: 'metrics cfd report', run: () => setMetrics(true) },
      { id: 'action:archive', kind: 'action', label: 'Archive', hint: 'Filed-away items', keywords: 'done filed old', run: () => setArchive(true) },
      { id: 'action:mywork', kind: 'action', label: 'My work', hint: 'Everything assigned to one person', keywords: 'mine assigned', run: () => setMyWork(true) },
      { id: 'action:objectives', kind: 'action', label: 'Objectives & KRs', hint: 'Where objectives and their coverage live', keywords: 'okr goals', run: () => setObjectives(true) },
      { id: 'action:boards', kind: 'action', label: 'All boards', hint: 'The board workspace', keywords: 'workspace switch', run: () => setBoards(true) },
    ],
    [beginEdit, editMode, makesCards, onNewCard, onNewInitiative, setArchive, setBoard, setBoards, setDashboard, setMetrics, setMyWork, setObjectives, setTimeline, toggleBoardSettings, toggleFilters, toggleLegend],
  )

  const liveBoards = boards.filter((b) => !b.archived)

  const entries: PaletteEntry[] = useMemo(() => {
    if (query.trim() === '') {
      // Empty: the cards opened lately, then the boards, then the verbs.
      return [
        ...recentItemIds.filter((id) => items.some((i) => i.id === id)).slice(0, 5).map((id) => itemEntry(id, 'recent')),
        ...liveBoards.map((b) => boardEntry(b.id)),
        ...actions,
      ]
    }
    // Typing: everything, ranked together — the best match first, whatever kind it is.
    return [
      ...liveBoards.map((b) => boardEntry(b.id)),
      ...items.filter((i) => !i.archived).map((i) => itemEntry(i.id)),
      ...actions,
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, recentItemIds, items, boards, actions])

  const ranked = useMemo(() => rankEntries(entries, query), [entries, query])
  const flat = query.trim() === '' ? ranked : ranked.slice(0, 24)

  useEffect(() => setActive(0), [query, open])

  const choose = (entry: PaletteEntry) => {
    const action = actions.find((a) => a.id === entry.id)
    if (action) action.run()
    else if (entry.kind === 'board') selectBoard(entry.id.replace('board:', ''))
    else openItem(entry.id.replace('item:', ''))
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(0, flat.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (flat[active]) choose(flat[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  // Keep the active row in view when the list is longer than the panel.
  useEffect(() => {
    listRef.current?.querySelectorAll('button')[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  return (
// Below the dialogs (z-60): a confirm or a reason is a blocking question, and the palette
    // must not cover the thing that is asking it.
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center bg-slate-900/40 px-4 pt-[12vh]"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5">
          <Search size={14} className="shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a board, a card, or an action…"
            className="min-w-0 flex-1 bg-transparent text-body text-slate-800 placeholder:text-slate-500 outline-none"
            aria-label="Command palette query"
          />
          <span className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-micro font-semibold text-slate-500">esc</span>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {flat.length === 0 && <div className="px-4 py-3 text-meta text-slate-600">Nothing matches that.</div>}
          {flat.map((entry, i) => {
            const Icon = entry.kind === 'action' ? Command : LayoutGrid
            return (
              <button
                key={entry.id}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(entry)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left transition',
                  i === active ? 'bg-indigo-50' : 'hover:bg-slate-50',
                )}
              >
                <Icon size={12} className={cn('shrink-0', entry.kind === 'action' ? 'text-slate-400' : 'text-indigo-500')} />
                <span className="min-w-0 flex-1 truncate text-meta font-medium text-slate-800">{entry.label}</span>
                {entry.hint && <span className="shrink-0 max-w-[45%] truncate text-micro text-slate-600">{entry.hint}</span>}
                <span className="shrink-0 rounded bg-slate-100 px-1 text-micro font-semibold uppercase tracking-wide text-slate-600">
                  {KIND_LABEL[entry.kind]}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-micro text-slate-600">
          <span>↑↓ to move</span>
          <span>↵ to choose</span>
          <span className="ml-auto flex items-center gap-1">
            <Command size={10} /> K to toggle
          </span>
        </div>
      </div>
    </div>
  )
}
