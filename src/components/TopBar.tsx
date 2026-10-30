import { Archive, ChartNoAxesGantt, Check, Kanban, LayoutDashboard, LayoutGrid, Pencil, Plus, Settings, TrendingUp, X } from 'lucide-react'
import { GlobalSearch } from './GlobalSearch'
import { AccountMenu } from './AccountMenu'
import { SyncNotice } from './SyncNotice'
import { ImportNotice } from './ImportNotice'
import { BoardPicker } from './BoardPicker'
import { cn } from '@/lib/utils'
import { useMay } from '@/lib/permissions'
import { isAggregating } from '@/domain/board'
import { isBoardSurface } from '@/store'
import type { Board } from '@/domain/types'

interface Props {
  boards: Board[]
  boardId: string
  editMode: boolean
  showDashboard: boolean
  showTimeline: boolean
  showArchive: boolean
  /** The objectives view sits over the board too, so the Board tab must not light up behind it. */
  showObjectives: boolean
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
  onShowMetrics: () => void
  /** The logo: leave the board section for the board workspace. */
  onGoToBoards: () => void
  onEditBoard: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onOpenBoardSettings: () => void
  onAddCard: () => void
  onAddInitiative: () => void
}

export function TopBar(props: Props) {
  // A Viewer reads and comments; the controls that write are not offered, because the server would
  // refuse them and a button that answers 403 is a lie about what the product does.
  const may = useMay()
  const mayWrite = may('item.write')
  const mayDesign = may('board.design')
  const maySettings = may('board.settings')

  const { boards, boardId, editMode, showDashboard, showTimeline, showArchive, showObjectives, showMetrics, showBoards, showAdmin, onSelectBoard, onShowBoard, onShowDashboard, onShowTimeline, onShowArchive, onShowMetrics, onGoToBoards, onEditBoard, onSaveEdit, onCancelEdit, onOpenBoardSettings, onAddCard, onAddInitiative } = props

  // The Board tab is the board itself, so it is lit when no view sits over it — and not while
  // the organisation workspace is open, because that is not a board either. One definition of
  // "the board is the surface", shared with the panels that read it.
  const boardActive = isBoardSurface({ showDashboard, showTimeline, showArchive, showObjectives, showBoards, showMetrics, showAdmin })
  // A card belongs to a board that renders a cards workflow. A coordination board — a programme or
  // a portfolio — shows bands or objective-grouped flows and no cards workflow at all, so a card
  // made here would be one nobody could see on the board that made it. An initiative still can be:
  // on a portfolio it arrives in the map, with its coverage gap, until an objective carries it.
  // Flow is the same rule: it reads a cards flow's history, so a board with no cards flow has none.
  const makesCards = !isAggregating(boards.find((b) => b.id === boardId))

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-300 bg-slate-100 px-3 py-2 text-slate-700 shadow-sm">
      <button
        onClick={onGoToBoards}
        className={cn(
          'flex items-center gap-2 rounded-md px-1.5 py-1 transition',
          showBoards ? 'bg-white ring-1 ring-indigo-300' : 'hover:bg-white',
        )}
        title="Workspace Home — every board in the organisation"
      >
        <span className="grid h-6 w-6 place-items-center rounded bg-indigo-500 text-white shadow-sm">
          <LayoutGrid size={14} />
        </span>
        <span className="text-title font-semibold tracking-tight text-slate-900">Kanban Toolkit</span>
      </button>

      {/* The navigation is always here: where you can go does not depend on where you are.
          What does depend on it is further right — a control that acts on the board shows only
          when the board is the surface, because a view that *reports* on work (dashboard,
          timeline, flow, archive, objectives) is not the place to make it. */}
      {!showBoards && (
        <>
          {/* The board's own controls never shrink, so the only thing that gives when the
              bar is tight is the focus chip — which is why focusing no longer wraps the
              bar and shoves the whole screen down. */}
          <div className="flex min-w-0 shrink-0 items-center gap-x-3">
            <div className="flex items-center gap-1.5 text-meta font-medium text-slate-600">
              Board
              <BoardPicker boards={boards} boardId={boardId} onSelect={onSelectBoard} />
            </div>

            <div className="h-5 w-px bg-slate-200" />


          <button
            onClick={onShowBoard}
            disabled={editMode}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 text-meta font-medium transition disabled:pointer-events-none disabled:opacity-40',
              boardActive ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
            )}
            title="Board — the board itself"
          >
            <Kanban size={12} /> Board
          </button>

          <button
            onClick={onShowDashboard}
            disabled={editMode}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 text-meta font-medium transition disabled:pointer-events-none disabled:opacity-40',
              showDashboard ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
            )}
            title="Dashboard — a summary view of this board's initiatives"
          >
            <LayoutDashboard size={12} /> Dashboard
          </button>

          <button
            onClick={onShowTimeline}
            disabled={editMode}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 text-meta font-medium transition disabled:pointer-events-none disabled:opacity-40',
              showTimeline ? 'border-teal-300 bg-teal-50 text-teal-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
            )}
            title="Timeline — this board's initiatives laid out over time"
          >
            <ChartNoAxesGantt size={12} /> Timeline
          </button>

          {/* Flow reads a cards flow's own history. A programme or portfolio board aggregates other
              boards and has no cards flow, so it has no delivery flow of its own to report. */}
          {makesCards && (
            <button
              onClick={onShowMetrics}
              disabled={editMode}
              className={cn(
                'flex items-center gap-1 rounded-md border px-2 py-1 text-meta font-medium transition disabled:pointer-events-none disabled:opacity-40',
                showMetrics ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
              )}
              title="Flow — this board's delivery metrics, read from each card's own history"
            >
              <TrendingUp size={12} /> Flow
            </button>
          )}

          <button
            onClick={onShowArchive}
            disabled={editMode}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 text-meta font-medium transition disabled:pointer-events-none disabled:opacity-40',
              showArchive ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
            )}
            title="Archive — filed-away items (still searchable, still in links)"
          >
            <Archive size={12} /> Archive
          </button>


          </div>

        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* Making work is the board's business, so these show on the board and nowhere else. */}
        {boardActive && (
          <>
            {makesCards && mayWrite && (
              <button
                onClick={onAddCard}
                disabled={editMode}
                className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-meta font-medium text-white hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-40"
              >
                <Plus size={13} /> Card
              </button>
            )}
            {mayWrite && (
            <button
              onClick={onAddInitiative}
              disabled={editMode}
              title="New initiative — an outcome this board owns, in its initiatives workflow"
              className="flex items-center gap-1 rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-meta font-medium text-indigo-700 hover:bg-indigo-50 disabled:pointer-events-none disabled:opacity-40"
            >
              <Plus size={13} /> Initiative
            </button>
            )}
          </>
        )}

        <GlobalSearch />

        {boardActive && !editMode && maySettings && (
          <button
            onClick={onOpenBoardSettings}
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-meta font-medium text-slate-600 hover:text-slate-900"
            title="Board settings — title, flight level, card types, WIP"
          >
            <Settings size={13} /> Settings
          </button>
        )}


        {boardActive && mayDesign &&
          (editMode ? (
            <>
              <button
                onClick={onSaveEdit}
                className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-meta font-semibold text-white hover:bg-emerald-500"
                title="Save layout changes"
              >
                <Check size={13} /> Save
              </button>
              <button
                onClick={onCancelEdit}
                className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-meta font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
                title="Discard layout changes"
              >
                <X size={13} /> Cancel
              </button>
            </>
          ) : (
          <button
            onClick={onEditBoard}
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-meta font-medium text-slate-600 hover:text-slate-900"
            title="Edit board design (split/add/rename lanes)"
          >
            <Pencil size={13} /> Edit board
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
