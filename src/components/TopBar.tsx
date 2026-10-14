import { Archive, Check, Columns3, LayoutDashboard, LayoutGrid, Pencil, Plus, RotateCcw, Settings, Shapes, SlidersHorizontal, Target, X } from 'lucide-react'
import { GlobalSearch } from './GlobalSearch'
import { BoardPicker } from './BoardPicker'
import { cn } from '@/lib/utils'
import type { Board } from '@/domain/types'

interface Props {
  boards: Board[]
  boardId: string
  editMode: boolean
  showObjectives: boolean
  showDashboard: boolean
  showArchive: boolean
  showBoards: boolean
  showFilters: boolean
  /** Number of active filter categories (for the button badge). */
  activeFilterCount: number
  onSelectBoard: (id: string) => void
  onToggleObjectives: () => void
  onToggleDashboard: () => void
  onToggleArchive: () => void
  onToggleBoards: () => void
  /** The logo: leave the board section for the board workspace. */
  onGoToBoards: () => void
  onToggleFilters: () => void
  onEditBoard: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onOpenTypes: () => void
  onOpenBoardSettings: () => void
  onAddCard: () => void
  onReset: () => void
}

export function TopBar(props: Props) {
  const { boards, boardId, editMode, showObjectives, showDashboard, showArchive, showBoards, showFilters, activeFilterCount, onSelectBoard, onToggleObjectives, onToggleDashboard, onToggleArchive, onToggleBoards, onGoToBoards, onToggleFilters, onEditBoard, onSaveEdit, onCancelEdit, onOpenTypes, onOpenBoardSettings, onAddCard, onReset } = props

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
        <span className="text-sm font-semibold tracking-tight text-slate-900">Flowline</span>
      </button>

      {/* Everything below acts on the open board. The workspace is outside that section, so
          it shows the organisation's controls only. */}
      {!showBoards && (
        <>
          {/* The board's own controls never shrink, so the only thing that gives when the
              bar is tight is the focus chip — which is why focusing no longer wraps the
              bar and shoves the whole screen down. */}
          <div className="flex min-w-0 shrink-0 items-center gap-x-3">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              Board
              <BoardPicker boards={boards} boardId={boardId} onSelect={onSelectBoard} />
            </div>

            <div className="h-5 w-px bg-slate-200" />

          <button
            onClick={onToggleBoards}
            disabled={editMode}
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-40"
            title="Boards — browse every board in the organisation"
          >
            <Columns3 size={12} /> Boards
          </button>

          <button
            onClick={onToggleObjectives}
            disabled={editMode}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition disabled:pointer-events-none disabled:opacity-40',
              showObjectives ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
            )}
            title="Objectives & Key Results — how work maps to priorities"
          >
            <Target size={12} /> Objectives
          </button>

          <button
            onClick={onToggleDashboard}
            disabled={editMode}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition disabled:pointer-events-none disabled:opacity-40',
              showDashboard ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
            )}
            title="Dashboard — a summary view of this board's initiatives"
          >
            <LayoutDashboard size={12} /> Dashboard
          </button>

          <button
            onClick={onToggleArchive}
            disabled={editMode}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition disabled:pointer-events-none disabled:opacity-40',
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
              'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition disabled:pointer-events-none disabled:opacity-40',
              showFilters ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
            )}
            title="Filters — narrow the cards shown on this board"
          >
            <SlidersHorizontal size={12} /> Filters
            {activeFilterCount > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-indigo-500 px-1 text-[9px] font-bold text-white">
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
              className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-40"
            >
              <Plus size={13} /> Card
            </button>
          </>
        )}

        <GlobalSearch />

        {!showBoards && !editMode && (
          <button
            onClick={onOpenBoardSettings}
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] font-medium text-slate-600 hover:text-slate-900"
            title="Board settings — title, flight level, card types, WIP"
          >
            <Settings size={13} /> Settings
          </button>
        )}

        {!editMode && (
        <button
          onClick={onOpenTypes}
          className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] font-medium text-slate-600 hover:text-slate-900"
          title="Manage issue types"
        >
          <Shapes size={13} /> Types
        </button>
        )}

        {!showBoards &&
          (editMode ? (
            <>
              <button
                onClick={onSaveEdit}
                className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-emerald-500"
                title="Save layout changes"
              >
                <Check size={13} /> Save
              </button>
              <button
                onClick={onCancelEdit}
                className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
                title="Discard layout changes"
              >
                <X size={13} /> Cancel
              </button>
            </>
          ) : (
          <button
            onClick={onEditBoard}
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] font-medium text-slate-600 hover:text-slate-900"
            title="Edit board design (split/add/rename lanes)"
          >
            <Pencil size={13} /> Edit board
          </button>
          ))}

        <button
          onClick={onReset}
          className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] font-medium text-slate-500 hover:text-slate-900"
          title="Reset the demo data"
        >
          <RotateCcw size={13} /> Reset
        </button>
      </div>
    </header>
  )
}
