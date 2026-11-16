import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Archive, ChartNoAxesGantt, Check, ChevronDown, Kanban, Keyboard, LayoutDashboard, LayoutGrid, MoreHorizontal, Pencil, Plus, Search, Settings, TrendingUp, X } from 'lucide-react'
import { GlobalSearch } from './GlobalSearch'
import { InboxBell } from './InboxBell'
import { AccountMenu } from './AccountMenu'
import { SyncNotice } from './SyncNotice'
import { ImportNotice } from './ImportNotice'
import { BoardPicker } from './BoardPicker'
import { cn } from '@/lib/utils'
import { useMay } from '@/lib/permissions'
import { openShortcuts } from '@/lib/shortcutDialog'
import { canAddInitiative, canDesignBoard, isAggregating, isPortfolio } from '@/domain/board'
import { isBoardSurface } from '@/store'
import type { Board } from '@/domain/types'

interface Props {
  boards: Board[]
  boardId: string
  editMode: boolean
  showDashboard: boolean
  showTimeline: boolean
  showArchive: boolean
  /** The board's own search view. */
  showSearch: boolean
  /** Flow metrics are the board's own view — derived from its cards' history. */
  showMetrics: boolean
  showBoards: boolean
  /** The workspace's own administration: copies and storage. */
  showAdmin: boolean
  onSelectBoard: (id: string) => void
  onShowBoard: () => void
  onShowDashboard: () => void
  onShowTimeline: () => void
  onShowArchive: () => void
  onShowSearch: () => void
  onShowMetrics: () => void
  /** The logo: leave the board section for the board workspace. */
  onGoToBoards: () => void
  onEditBoard: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onOpenBoardSettings: () => void
  /** The cards workflows a new card can be made in, in board order. */
  cardFlows: Array<{ id: string; name: string }>
  /** Make a card in the named flow, or the first one when no flow is named. */
  onAddCard: (flowId?: string) => void
  onAddInitiative: () => void
}

/**
 * A control's word.
 *
 * The bar is one row at every width, so a control gives up its **word** before it gives up its
 * **place** — but only once the row has no room for it. The word is always in the accessible name,
 * and `data-bar-words` is what draws it once the bar has measured that it fits. See `index.css`.
 */
function BarLabel({ children }: { children: ReactNode }) {
  return (
    <span data-bar-label className="sr-only">
      {children}
    </span>
  )
}

type BarWords = 'none' | 'views' | 'all'

/**
 * How much of the bar's words the row has room for.
 *
 * The question is not "how wide is the window" but "do the words still fit beside the controls
 * that never give way" — and the answer depends on the board's name, the account menu, edit mode
 * and the notices, not only on the viewport. A `ResizeObserver` asks it against the real row and
 * re-asks whenever anything changes width, so words come back the moment a resize makes them fit
 * and are given up only when they genuinely do not. `views` turns the navigation's words on while
 * the actions stay icons; `all` turns on every word. The measurement applies the same CSS the
 * bar draws with (`data-force-words`), so it cannot promise room the row does not have.
 */
function useBarWords(barRef: RefObject<HTMLElement | null>, navRef: RefObject<HTMLElement | null>): BarWords {
  const [words, setWords] = useState<BarWords>('none')
  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const fits = (mode: Exclude<BarWords, 'none'>) => {
      bar.dataset.forceWords = mode
      const nav = navRef.current
      const navFits = !nav || nav.offsetParent === null || nav.scrollWidth <= nav.clientWidth + 1
      const barFits = bar.scrollWidth <= bar.clientWidth + 1
      delete bar.dataset.forceWords
      return navFits && barFits
    }
    const measure = () => setWords(fits('all') ? 'all' : fits('views') ? 'views' : 'none')
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    if (navRef.current) observer.observe(navRef.current)
    // The actions are what the navigation shares the row with: a new button, a different role, an
    // account menu signing in — each changes the room left for words without resizing the bar.
    const actions = bar.querySelector('[data-bar-actions]')
    if (actions) observer.observe(actions)
    return () => observer.disconnect()
  }, [barRef, navRef])
  return words
}

export function TopBar(props: Props) {
  // A Viewer reads and comments; the controls that write are not offered, because the server would
  // refuse them and a button that answers 403 is a lie about what the product does.
  const may = useMay()
  const mayWrite = may('item.write')
  const mayDesign = may('board.design')
  const maySettings = may('board.settings')
  const { boards, boardId, editMode, showDashboard, showTimeline, showArchive, showSearch, showMetrics, showBoards, showAdmin, onSelectBoard, onShowBoard, onShowDashboard, onShowTimeline, onShowArchive, onShowSearch, onShowMetrics, onGoToBoards, onEditBoard, onSaveEdit, onCancelEdit, onOpenBoardSettings, cardFlows, onAddCard, onAddInitiative } = props

  // The flow the main button adds to. Choosing a flow from the arrow both remembers it for the
  // next press and makes the card now, so a second flow is one gesture, not a setting to hunt for.
  const [targetFlowId, setTargetFlowId] = useState<string | null>(null)
  const [flowMenuOpen, setFlowMenuOpen] = useState(false)
  const flowMenuRef = useRef<HTMLDivElement>(null)
  // The bar's secondary actions are a menu of their own on a tight window, so the views keep their
  // room. They are the same actions with the same rules, not a reduced set.
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const targetFlow = cardFlows.find((flow) => flow.id === targetFlowId) ?? cardFlows[0]

  useEffect(() => {
    // A flow belongs to one board; moving boards starts the choice again.
    setTargetFlowId(null)
    setFlowMenuOpen(false)
  }, [boardId])

  useEffect(() => {
    if (!flowMenuOpen && !moreOpen) return
    const onDown = (event: MouseEvent) => {
      if (flowMenuRef.current && !flowMenuRef.current.contains(event.target as Node)) setFlowMenuOpen(false)
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [flowMenuOpen, moreOpen])

  useEffect(() => {
    // A menu belongs to one board's controls; moving boards closes it.
    setMoreOpen(false)
  }, [boardId])

  const addCardTo = (flowId: string) => {
    setTargetFlowId(flowId)
    setFlowMenuOpen(false)
    onAddCard(flowId)
  }

  // The Board tab is the board itself, so it is lit when no view sits over it — and not while
  // the organisation workspace is open, because that is not a board either. One definition of
  // "the board is the surface", shared with the panels that read it.
  const boardActive = isBoardSurface({ showDashboard, showTimeline, showArchive, showBoards, showMetrics, showSearch, showAdmin })
  // A card belongs to a board that renders a cards workflow. A coordination board — a programme or
  // a portfolio — shows bands or objective-grouped flows and no cards workflow at all, so a card
  // made here would be one nobody could see on the board that made it. An initiative is different:
  // a team or programme board makes its own, while a portfolio *connects* ones that already exist,
  // so it has no Initiative button either. Flow is the same rule as cards: it reads a cards flow's
  // history, so a board with no cards flow has none.
  const board = boards.find((b) => b.id === boardId)
  const portfolio = isPortfolio(board)
  const makesCards = !isAggregating(board)
  // Edit board is a team's and a programme's act: a portfolio's shape is its objectives, made in the
  // strategy map, so there is no lane tree there for it to open. A mode already open is finished or
  // cancelled wherever the reader is — it can only have been started on another board.
  const mayDesignThisBoard = mayDesign && canDesignBoard(board)
  const inEditMode = editMode && mayDesign
  const words = useBarWords(barRef, navRef)

  // When the views scroll, the view that is lit is the one to show: on a very narrow bar the
  // active tab can otherwise sit beyond the right edge, and the reader sees no current place.
  useEffect(() => {
    navRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [boardActive, showDashboard, showTimeline, showArchive, showSearch, showMetrics])

  const viewButton = 'flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-meta font-medium transition disabled:pointer-events-none disabled:opacity-40'

  return (
    // One row, always. The bar never wraps into a second line: the words are shown only while the
    // measured row has room for them (`useBarWords`), the views scroll when even icons cannot fit,
    // and height is never the thing that gives.
    <header
      ref={barRef}
      data-top-bar
      data-bar-words={words}
      className="flex flex-nowrap items-center gap-2 border-b border-slate-300 bg-slate-100 px-3 py-2 text-slate-700 shadow-sm"
    >
      <button
        onClick={onGoToBoards}
        aria-label="Kanban Toolkit"
        className={cn(
          'flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 transition',
          showBoards ? 'bg-white ring-1 ring-indigo-300' : 'hover:bg-white',
        )}
        title="Workspace home"
      >
        <span className="grid h-6 w-6 place-items-center rounded bg-indigo-500 text-white shadow-sm">
          <LayoutGrid size={14} />
        </span>
        <span className="hidden text-title font-semibold tracking-tight text-slate-900 lg:inline">Kanban Toolkit</span>
      </button>

      {/* The navigation is always here: where you can go does not depend on where you are.
          What does depend on it is further right — a control that acts on the board shows only
          when the board is the surface, because a view that *reports* on work (dashboard,
          timeline, flow, archive, objectives) is not the place to make it. */}
      {!showBoards && (
        <nav
          ref={navRef}
          aria-label="Board navigation"
          data-board-nav
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex shrink-0 items-center gap-1.5 text-meta font-medium text-slate-600">
            <BoardPicker boards={boards} boardId={boardId} onSelect={onSelectBoard} disabled={editMode} />
          </div>

          {!portfolio && <div className="h-5 w-px shrink-0 bg-slate-200" />}

          {!portfolio && (
            <button
              onClick={onShowBoard}
              aria-pressed={boardActive}
              disabled={editMode}
              className={cn(
                viewButton,
                boardActive ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
              )}
              title="Board"
            >
              <Kanban size={12} /> <BarLabel>Board</BarLabel>
            </button>
          )}

          {!portfolio && (
            <>
              <button
                onClick={onShowDashboard}
                aria-pressed={showDashboard}
                disabled={editMode}
                className={cn(
                  viewButton,
                  showDashboard ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
                )}
                title="Dashboard — this board's initiatives at a glance"
              >
                <LayoutDashboard size={12} /> <BarLabel>Dashboard</BarLabel>
              </button>

              <button
                onClick={onShowTimeline}
                aria-pressed={showTimeline}
                disabled={editMode}
                className={cn(
                  viewButton,
                  showTimeline ? 'border-teal-300 bg-teal-50 text-teal-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
                )}
                title="Timeline — this board's initiatives over time"
              >
                <ChartNoAxesGantt size={12} /> <BarLabel>Timeline</BarLabel>
              </button>
            </>
          )}

          {/* Flow reads a cards flow's own history. A programme or portfolio board aggregates other
              boards and has no cards flow, so it has no delivery flow of its own to report. */}
          {makesCards && (
            <button
              onClick={onShowMetrics}
              aria-pressed={showMetrics}
              disabled={editMode}
              className={cn(
                viewButton,
                showMetrics ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
              )}
              title="Flow — delivery metrics from each card's history"
            >
              <TrendingUp size={12} /> <BarLabel>Flow</BarLabel>
            </button>
          )}

          {!portfolio && (
            <button
              onClick={onShowArchive}
              aria-pressed={showArchive}
              disabled={editMode}
              className={cn(
                viewButton,
                showArchive ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
              )}
              title="Archive — filed-away items, still searchable"
            >
              <Archive size={12} /> <BarLabel>Archive</BarLabel>
            </button>
          )}

          {/* Search reads the board's own live work, whatever kind of board it is: a programme and
              a portfolio read initiatives too, and both need the review table. */}
          <button
            onClick={onShowSearch}
            aria-pressed={showSearch}
            disabled={editMode}
            className={cn(
              viewButton,
              showSearch ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
            )}
            title="Search — this board's live work"
          >
            <Search size={12} /> <BarLabel>Search</BarLabel>
          </button>
        </nav>
      )}

      <div data-bar-actions className="flex shrink-0 items-center gap-1.5">
        {/* Making work is the board's business, so these show on the board and nowhere else. */}
        {boardActive && (
          <>
            {makesCards && mayWrite && (
              <div
                ref={flowMenuRef}
                className="relative flex items-stretch"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setFlowMenuOpen(false)
                }}
              >
                <button
                  onClick={() => onAddCard(targetFlow?.id)}
                  disabled={editMode}
                  title={targetFlow ? `Add a card to ${targetFlow.name}` : 'Add a card'}
                  className={cn(
                    'flex shrink-0 items-center gap-1 bg-indigo-600 px-2.5 py-1 text-meta font-medium text-white hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-40',
                    cardFlows.length > 1 ? 'rounded-l-md' : 'rounded-md',
                  )}
                >
                  <Plus size={13} /> <BarLabel>Card</BarLabel>
                </button>
                {cardFlows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setFlowMenuOpen((open) => !open)}
                    disabled={editMode}
                    aria-haspopup="menu"
                    aria-expanded={flowMenuOpen}
                    aria-label="Choose a workflow for the new card"
                    title="Choose a workflow for the new card"
                    className="flex shrink-0 items-center rounded-r-md border-l border-indigo-400/60 bg-indigo-600 px-1.5 text-white transition hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <ChevronDown size={13} className={cn('transition', flowMenuOpen && 'rotate-180')} />
                  </button>
                )}
                {flowMenuOpen && (
                  <div
                    role="menu"
                    aria-label="Add a card to"
                    className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-slate-200 bg-white py-1 text-slate-800 shadow-xl"
                  >
                    <p className="px-2.5 py-1 text-micro font-semibold uppercase tracking-wide text-slate-500">
                      Add a card to
                    </p>
                    {cardFlows.map((flow) => (
                      <button
                        key={flow.id}
                        type="button"
                        role="menuitem"
                        onClick={() => addCardTo(flow.id)}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta transition hover:bg-slate-100"
                      >
                        <span className="min-w-0 flex-1 truncate">{flow.name}</span>
                        {flow.id === targetFlow?.id && <Check size={12} className="shrink-0 text-indigo-600" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {mayWrite && canAddInitiative(board) && (
              <button
                onClick={onAddInitiative}
                disabled={editMode}
                title="Initiative — a new initiative on this board"
                className="flex shrink-0 items-center gap-1 rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-meta font-medium text-indigo-700 hover:bg-indigo-50 disabled:pointer-events-none disabled:opacity-40"
              >
                <Plus size={13} /> <BarLabel>Initiative</BarLabel>
              </button>
            )}
          </>
        )}

        <InboxBell />

        <GlobalSearch />

        {/* The keyboard's page, for anyone who would rather click than learn a key. It sits with
            the search because that is where a person looks for "how do I…" in this app. Below `lg`
            these three step into one menu, so the views keep their room rather than the bar
            scrolling them out of sight. Same actions, same permissions. */}
        <button
          type="button"
          onClick={openShortcuts}
          data-shortcuts-trigger
          aria-label="Keyboard shortcuts"
          aria-keyshortcuts="?"
          title="Keyboard shortcuts (?)"
          className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 lg:flex"
        >
          <Keyboard size={14} />
        </button>

        {boardActive && !editMode && maySettings && (
          <button
            onClick={onOpenBoardSettings}
            className="hidden shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-meta font-medium text-slate-600 hover:text-slate-900 lg:flex"
            title={isPortfolio(board) ? 'Settings — title, board type, linked boards' : 'Settings — title, card types, tags, WIP'}
          >
            <Settings size={13} /> <BarLabel>Settings</BarLabel>
          </button>
        )}

        <div
          ref={moreRef}
          className="relative lg:hidden"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMoreOpen(false)
          }}
        >
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            title="More actions"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            <MoreHorizontal size={15} />
          </button>
          {moreOpen && (
            <div
              role="menu"
              aria-label="More actions"
              className="absolute right-0 top-full z-50 mt-1 w-52 rounded-md border border-slate-200 bg-white py-1 text-slate-800 shadow-xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false)
                  openShortcuts()
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta transition hover:bg-slate-100"
              >
                <Keyboard size={13} className="shrink-0 text-slate-500" /> Keyboard shortcuts
              </button>
              {boardActive && !editMode && maySettings && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false)
                    onOpenBoardSettings()
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta transition hover:bg-slate-100"
                >
                  <Settings size={13} className="shrink-0 text-slate-500" /> Board settings
                </button>
              )}
              {boardActive && mayDesignThisBoard && !inEditMode && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false)
                    onEditBoard()
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta transition hover:bg-slate-100"
                >
                  <Pencil size={13} className="shrink-0 text-slate-500" /> Edit board
                </button>
              )}
            </div>
          )}
        </div>

        {boardActive && (inEditMode || mayDesignThisBoard) &&
          (inEditMode ? (
            <>
              <button
                onClick={onSaveEdit}
                className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-meta font-semibold text-white hover:bg-emerald-500"
                title="Save the layout"
              >
                <Check size={13} /> <BarLabel>Save</BarLabel>
              </button>
              <button
                onClick={onCancelEdit}
                className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-meta font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
                title="Discard the changes"
              >
                <X size={13} /> <BarLabel>Cancel</BarLabel>
              </button>
            </>
          ) : (
            <button
              onClick={onEditBoard}
              className="hidden shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-meta font-medium text-slate-600 hover:text-slate-900 lg:flex"
              title="Edit board — split, add and rename lanes"
            >
              <Pencil size={13} /> <BarLabel>Edit board</BarLabel>
            </button>
          ))}

        {/* The one moment a workspace can move to the server, and a change that did not land. */}
        <ImportNotice />
        <SyncNotice />

        {/* Who you are, when the instance offers a way to be someone. */}
        <AccountMenu />
      </div>
    </header>
  )
}
