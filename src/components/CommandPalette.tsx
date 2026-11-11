import { useEffect, useMemo, useRef, useState } from 'react'
import { Command, LayoutGrid, Search } from 'lucide-react'
import { canDesignBoard, isInitiativeItem, isPortfolio } from '@/domain/board'
import { cardsFlows } from '@/domain/flows'
import { effectiveStage, leafLanes } from '@/domain/lanes'
import { KIND_LABEL, rankEntries, type PaletteEntry, type PaletteKind } from '@/domain/palette'
import { openShortcuts } from '@/lib/shortcutDialog'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { useDialogFocus } from '@/lib/useDialogFocus'
import { useMay } from '@/lib/permissions'
import { announce } from '@/lib/announce'
import { toggleWatch } from '@/lib/watch'

interface Props {
  onNewCard: () => void
  onNewInitiative: () => void
  /** The workspace home, through the same door the toolbar uses (with its unsaved-design check). */
  onGoToBoards: () => void
  /** False on a board that renders no cards workflow — the same rule the toolbar's button keeps. */
  makesCards: boolean
  /** False on a portfolio, which connects the initiatives that exist rather than making new ones. */
  addsInitiatives: boolean
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
export function CommandPalette({ onNewCard, onNewInitiative, onGoToBoards, makesCards, addsInitiatives }: Props) {
  const items = useStore((s) => s.items)
  const boards = useStore((s) => s.boards)
  const boardId = useStore((s) => s.boardId)
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
  const toggleFilters = useStore((s) => s.toggleFilters)
  const toggleBoardSettings = useStore((s) => s.toggleBoardSettings)
  const beginEdit = useStore((s) => s.beginEdit)
  const editMode = useStore((s) => s.editMode)
  // The card a verb acts on: the open drawer, or the card whose menu opened the palette. Never the
  // multi-select group — a palette is one action on one thing, not a second bulk bar.
  const selectedItemId = useStore((s) => s.selectedItemId)
  const cardMenu = useStore((s) => s.cardMenu)
  const meUserId = useStore((s) => s.meUserId)
  const watchedItemIds = useStore((s) => s.watchedItemIds)
  const flows = useStore((s) => s.flows)
  const lanes = useStore((s) => s.lanes)
  const addAssignee = useStore((s) => s.addAssignee)
  const moveCard = useStore((s) => s.moveCard)
  const blockItem = useStore((s) => s.blockItem)
  const setDueDate = useStore((s) => s.setDueDate)
  // The palette lists verbs, and a verb a role may not use is a 403 with a search box in front
  // of it. A Viewer keeps the reading half: every view, every board, every card.
  const may = useMay()
  const canWrite = may('item.write')
  const canDesign = may('board.design')
  const canSettings = may('board.settings')

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  /**
   * A verb that needs a word before it can run. The palette's own box becomes the input rather than
   * opening a second dialog on top of it: one place to type, one thing to read.
   */
  const [prompt, setPrompt] = useState<{
    kind: 'text' | 'date'
    label: string
    placeholder: string
    value: string
    run: (value: string) => void
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

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

  // A palette is a dialog with a search box in it: the caret belongs in the box, Tab stays inside,
  // and Escape gives the caret back to whatever was being read.
  /** Close the layer and forget a half-asked question with it. */
  const close = () => {
    setOpen(false)
    setQuery('')
    setPrompt(null)
  }

  useDialogFocus(dialogRef, close, open, 'input')

  useEffect(() => {
    if (!open) setPrompt(null)
  }, [open])

  const boardName = (id: string) => boards.find((b) => b.id === id)?.name
  const targetId = selectedItemId ?? cardMenu?.itemId ?? null
  const target = targetId ? items.find((item) => item.id === targetId && !item.archived) : undefined
  const targetPlacement = target ? placements.find((placement) => placement.itemId === target.id) : undefined
  const targetBoard = targetPlacement ? boards.find((board) => board.id === targetPlacement.boardId) : undefined
  const targetIsInitiative = target ? isInitiativeItem(target, issueTypes) : false
  // The cell a card would land in: the first Done leaf of the first cards flow on the board it is
  // actually placed on. An initiative's section is derived from its work, so "move to Done" is not
  // a verb it has.
  const doneLane =
    target && targetBoard && !targetIsInitiative
      ? cardsFlows(flows, targetBoard.id)
          .flatMap((flow) => leafLanes(lanes, flow.id))
          .find((lane) => lane.stage === 'done')
      : undefined
  const targetIsDone = Boolean(
    target && targetPlacement && effectiveStage(lanes, targetPlacement.laneId) === 'done',
  )
  const watching = Boolean(target && watchedItemIds.includes(target.id))
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

  /**
   * The verbs on the card in hand.
   *
   * Each one is the same call the drawer or the menu makes, so the rules are the board's: a move
   * goes through `moveCard` (and therefore a `block` lane refuses it and a `justify` lane asks for
   * its reason), blocking records a reason, assigning uses the people directory, and a due date is
   * a day. A verb that would be refused is not offered at all.
   */
  const itemActions: (PaletteEntry & { run: () => void; keepOpen?: boolean })[] = useMemo(() => {
    if (!target) return []
    const title = target.title
    const ask = (next: NonNullable<typeof prompt>) => {
      setPrompt(next)
      setQuery(next.value)
      setActive(0)
    }
    return [
      ...(canWrite && meUserId && !(target.assignees ?? []).includes(meUserId)
        ? [{
            id: 'action:assign-me',
            kind: 'action' as PaletteKind,
            label: 'Assign to me',
            hint: title,
            keywords: 'assign owner take myself',
            run: () => {
              addAssignee(target.id, meUserId)
              announce(`${title} is assigned to you.`)
            },
          }]
        : []),
      ...(canWrite && doneLane && !targetIsDone
        ? [{
            id: 'action:move-done',
            kind: 'action' as PaletteKind,
            label: 'Move to Done',
            hint: `${title} → ${doneLane.name}`,
            keywords: 'finish complete column lane',
            run: () => {
              // The board's own rule answers: `block` refuses with its sentence, `justify` opens the
              // reason dialog. The palette does not add a second wording.
              moveCard(target.id, targetBoard!.id, doneLane.id)
            },
          }]
        : []),
      ...(canWrite && !target.blocked
        ? [{
            id: 'action:block',
            kind: 'action' as PaletteKind,
            label: 'Block…',
            hint: title,
            keywords: 'stopped reason waiting',
            keepOpen: true,
            run: () =>
              ask({
                kind: 'text',
                label: `Why is ${title} blocked?`,
                placeholder: 'Reason (optional)…',
                value: '',
                run: (reason) => {
                  blockItem(target.id, reason)
                  announce(`${title} is blocked${reason.trim() ? `: ${reason.trim()}` : ''}.`)
                },
              }),
          }]
        : []),
      ...(canWrite
        ? [{
            id: 'action:due',
            kind: 'action' as PaletteKind,
            label: 'Set due date…',
            hint: target.dueDate ? `${title} — ${target.dueDate}` : title,
            keywords: 'promise deadline date when',
            keepOpen: true,
            run: () =>
              ask({
                kind: 'date',
                label: `Due date for ${title}`,
                placeholder: '',
                value: target.dueDate ?? '',
                run: (value) => {
                  setDueDate(target.id, value || undefined)
                  announce(value ? `${title} is due ${value}.` : `${title} has no due date.`)
                },
              }),
          }]
        : []),
      {
        id: 'action:watch',
        kind: 'action',
        label: watching ? 'Unwatch this card' : 'Watch this card',
        hint: title,
        keywords: 'bell follow inbox notify',
        run: () => {
          void toggleWatch(target.id)
          announce(watching ? `${title} is no longer watched.` : `${title} is watched.`)
        },
      },
      {
        id: 'action:open-panel',
        kind: 'action',
        label: 'Open this card',
        hint: title,
        keywords: 'drawer details panel',
        run: () => openItem(target.id),
      },
    ]
  }, [addAssignee, blockItem, canWrite, doneLane, meUserId, moveCard, openItem, setDueDate, target, targetBoard, targetIsDone, watching])

  /** The app's own verbs, each one the same call the button makes. */
  const actions: (PaletteEntry & { run: () => void; keepOpen?: boolean })[] = useMemo(
    () => [
      ...itemActions,
      ...(makesCards && canWrite
        ? [{ id: 'action:new-card', kind: 'action' as PaletteKind, label: 'New card', hint: "In this board's default cell", keywords: 'create add task story bug', run: onNewCard }]
        : []),
      ...(addsInitiatives && canWrite
        ? [{ id: 'action:new-initiative', kind: 'action' as PaletteKind, label: 'New initiative', hint: 'On this board', keywords: 'create outcome', run: onNewInitiative }]
        : []),
      ...(editMode || !canDesign || !canDesignBoard(boards.find((b) => b.id === boardId))
        ? []
        : [{ id: 'action:edit', kind: 'action' as PaletteKind, label: 'Edit board design', hint: 'Lanes, splits and flows', keywords: 'lanes columns rows wip', run: beginEdit }]),
      { id: 'action:filters', kind: 'action', label: 'Filters', hint: 'Narrow the cards here, across every flow', keywords: 'find narrow', run: toggleFilters },
      { id: 'action:shortcuts', kind: 'action', label: 'Keyboard shortcuts', hint: 'Every key in the app', keywords: 'keys help ? reference', run: openShortcuts },
      ...(canSettings
        ? [{
            id: 'action:settings',
            kind: 'action' as PaletteKind,
            label: 'Board settings',
            // A portfolio's settings are its title, band and links: there is no WIP or landing cell there.
            hint: isPortfolio(boards.find((b) => b.id === boardId))
              ? 'Title, board type and linked boards'
              : 'Band, WIP enforcement',
            keywords: 'configure',
            run: toggleBoardSettings,
          }]
        : []),
      { id: 'action:board', kind: 'action', label: 'Go to the board', hint: 'Leave whatever view is open', keywords: 'back home', run: setBoard },
      { id: 'action:dashboard', kind: 'action', label: 'Dashboard', hint: "This board's initiatives", keywords: 'summary overview', run: () => setDashboard(true) },
      { id: 'action:timeline', kind: 'action', label: 'Timeline', hint: "This board's initiatives over time", keywords: 'dates gantt', run: () => setTimeline(true) },
      ...(makesCards
        ? [{ id: 'action:flow', kind: 'action' as PaletteKind, label: 'Flow metrics', hint: 'Lead time, cycle time, throughput', keywords: 'metrics cfd report', run: () => setMetrics(true) }]
        : []),
      { id: 'action:archive', kind: 'action', label: 'Archive', hint: 'Filed-away items', keywords: 'done filed old', run: () => setArchive(true) },
      { id: 'action:mywork', kind: 'action', label: 'My work', hint: 'Everything assigned to you', keywords: 'mine assigned', run: () => setMyWork(true) },
      { id: 'action:boards', kind: 'action', label: 'All boards', hint: 'The board workspace', keywords: 'workspace switch', run: onGoToBoards },
    ],
    [addsInitiatives, beginEdit, boardId, boards, canDesign, canSettings, canWrite, editMode, itemActions, makesCards, onGoToBoards, onNewCard, onNewInitiative, setArchive, setBoard, setDashboard, setMetrics, setMyWork, setTimeline, toggleBoardSettings, toggleFilters],
  )

  // An open board design closes the board switcher. The palette follows the same rule: the
  // current board's cards are still reachable, but another board is not.
  const liveBoards = boards.filter((b) => !b.archived && !editMode)

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
    if (action) {
      action.run()
      // A verb that asks a question keeps the layer open: the box is now the answer, and closing
      // it would leave the question unanswered.
      if (!action.keepOpen) close()
      return
    }
    if (entry.kind === 'board') selectBoard(entry.id.replace('board:', ''))
    else openItem(entry.id.replace('item:', ''))
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (prompt) {
      if (e.key === 'Enter') {
        e.preventDefault()
        prompt.run(query)
        close()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        // Back to the list rather than out of the palette: a cancelled question is not a closed
        // palette.
        setPrompt(null)
        setQuery('')
        setActive(0)
      }
      return
    }
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
      close()
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
      onMouseDown={close}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5">
          <Search size={14} className="shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            type={prompt?.kind === 'date' ? 'date' : 'text'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={prompt?.placeholder ?? 'Jump to a board, a card, or an action…'}
            className="min-w-0 flex-1 bg-transparent text-body text-slate-800 placeholder:text-slate-500 outline-none"
            aria-label={prompt?.label ?? 'Command palette query'}
          />
          <span className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-micro font-semibold text-slate-500">esc</span>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {prompt ? (
            <div className="px-4 py-3">
              <p className="text-meta font-medium text-slate-800">{prompt.label}</p>
              <p className="mt-0.5 text-micro text-slate-600">
                {prompt.kind === 'date'
                  ? 'Choose a day and press Enter. Leave it empty to clear it.'
                  : 'Type a reason, or leave it empty, and press Enter.'}
              </p>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-micro text-slate-600">
          {prompt ? (
            <>
              <span>↵ to run</span>
              <span>esc to go back</span>
            </>
          ) : (
            <>
              <span>↑↓ to move</span>
              <span>↵ to choose</span>
            </>
          )}
          <span className="ml-auto flex items-center gap-1">
            <Command size={10} /> K to toggle
          </span>
        </div>
      </div>
    </div>
  )
}
