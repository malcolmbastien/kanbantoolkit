import { Archive, ChartNoAxesGantt, Check, Kanban, LayoutDashboard, LayoutGrid, Pencil, Plus, RotateCcw, Settings, SlidersHorizontal, X } from 'lucide-react'
import { GlobalSearch } from './GlobalSearch'
import { BoardPicker } from './BoardPicker'
import { cn } from '@/lib/utils'
import type { Board } from '@/domain/types'

interface Props {
  boards: Board[]
  boardId: string
  editMode: boolean
  showDashboard: boolean
  showTimeline: boolean
  showArchive: boolean
  showBoards: boolean
  showFilters: boolean
  /** Number of active filter categories (for the button badge). */
  activeFilterCount: number
  onSelectBoard: (id: string) => void
  onShowBoard: () => void
  onShowDashboard: () => void
  onShowTimeline: () => void
  onShowArchive: () => void
  /** The logo: leave the board section for the board workspace. */
  onGoToBoards: () => void
  onToggleFilters: () => void
  onEditBoard: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onOpenBoardSettings: () => void
  onAddCard: () => void
  onAddInitiative: () => void
  onReset: () => void
}

export function TopBar(props: Props) {
  const { boards, boardId, editMode, showDashboard, showTimeline, showArchive, showBoards, showFilters, activeFilterCount, onSelectBoard, onShowBoard, onShowDashboard, onShowTimeline, onShowArchive, onGoToBoards, onToggleFilters, onEditBoard, onSaveEdit, onCancelEdit, onOpenBoardSettings, onAddCard, onAddInitiative, onReset } = props

  // The Board tab is the board itself, so it is lit when no view sits over it — and not while
  // the organisation workspace is open, because that is not a board either.
  const boardActive = !showDashboard && !showTimeline && !showArchive && !showBoards

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-3 py-2 text-slate-700 shadow-sm">
      <button
        onClick={onGoToBoards}
        className={cn(
          'flex items-center gap-2 rounded-md px-1.5 py-1 transition',
          showBoards ? 'bg-slate-100 ring-1 ring-indigo-300' : 'hover:bg-slate-100',
        )}
        title="Boards — browse and manage every board"
      >
        <span className="grid h-6 w-6 place-items-center rounded bg-indigo-500 text-white shadow-sm">
          <LayoutGrid size={14} />
        </span>
        <span className="text-title font-semibold tracking-tight text-slate-900">Flowline</span>
      </button>

      {/* Everything below acts on the open board. The workspace is outside that section, so
          it shows the organisation's controls only. */}
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

          <button
            onClick={onToggleFilters}
            disabled={editMode}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 text-meta font-medium transition disabled:pointer-events-none disabled:opacity-40',
              showFilters ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
            )}
            title="Filters — narrow the cards shown on this board"
          >
            <SlidersHorizontal size={12} /> Filters
            {activeFilterCount > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-indigo-500 px-1 text-micro font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          </div>

        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {!showBoards && (
          <>
            <button
              onClick={onAddCard}
            disabled={editMode}
              className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-meta font-medium text-white hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-40"
            >
              <Plus size={13} /> Card
            </button>
            <button
              onClick={onAddInitiative}
              disabled={editMode}
              title="New initiative — an outcome this board owns, in its initiatives workflow"
              className="flex items-center gap-1 rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-meta font-medium text-indigo-700 hover:bg-indigo-50 disabled:pointer-events-none disabled:opacity-40"
            >
              <Plus size={13} /> Initiative
            </button>
          </>
        )}

        <GlobalSearch />

        {!showBoards && !editMode && (
          <button
            onClick={onOpenBoardSettings}
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-meta font-medium text-slate-600 hover:text-slate-900"
            title="Board settings — title, flight level, card types, WIP"
          >
            <Settings size={13} /> Settings
          </button>
        )}


        {!showBoards &&
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

        <button
          onClick={onReset}
          className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-meta font-medium text-slate-600 hover:text-slate-900"
          title="Reset the demo data"
        >
          <RotateCcw size={13} /> Reset
        </button>
      </div>
    </header>
  )
}
