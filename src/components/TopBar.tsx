import { useState } from 'react'
import { Archive, Check, LayoutDashboard, LayoutGrid, Pencil, Plus, RotateCcw, Settings, Shapes, SlidersHorizontal, Target, Trash2, X } from 'lucide-react'
import { GlobalSearch } from './GlobalSearch'
import { InlineEdit } from './InlineEdit'
import { BandBadge } from './BandBadge'
import { BoardPicker } from './BoardPicker'
import { cn } from '@/lib/utils'
import type { Board, BoardBand } from '@/domain/types'

interface Props {
  boards: Board[]
  boardId: string
  boardBand: BoardBand
  editMode: boolean
  showObjectives: boolean
  showDashboard: boolean
  showArchive: boolean
  showFilters: boolean
  /** Number of active filter categories (for the button badge). */
  activeFilterCount: number
  onSelectBoard: (id: string) => void
  onSetBoardBand: (band: BoardBand) => void
  onToggleObjectives: () => void
  onToggleDashboard: () => void
  onToggleArchive: () => void
  onToggleFilters: () => void
  onEditBoard: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onOpenTypes: () => void
  onOpenBoardSettings: () => void
  onAddCard: () => void
  onNewBoard: (name: string) => void
  onDeleteBoard: () => void
  onReset: () => void
}

export function TopBar(props: Props) {
  const { boards, boardId, boardBand, editMode, showObjectives, showDashboard, showArchive, showFilters, activeFilterCount, onSelectBoard, onSetBoardBand, onToggleObjectives, onToggleDashboard, onToggleArchive, onToggleFilters, onEditBoard, onSaveEdit, onCancelEdit, onOpenTypes, onOpenBoardSettings, onAddCard, onNewBoard, onDeleteBoard, onReset } = props
  const [namingBoard, setNamingBoard] = useState(false)

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-950/50 bg-slate-900 px-3 py-2 text-slate-200 shadow-md">
      <div className="flex items-center gap-2">
        <div className="grid h-6 w-6 place-items-center rounded bg-indigo-500 text-white shadow-sm">
          <LayoutGrid size={14} />
        </div>
        <span className="text-sm font-semibold tracking-tight text-white">Flowline</span>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
        Board
        <BoardPicker boards={boards} boardId={boardId} onSelect={onSelectBoard} />
      </div>

      <div className="h-5 w-px bg-slate-700" />

      <BandBadge band={boardBand} onChange={onSetBoardBand} />

      <button
        onClick={onToggleObjectives}
        className={cn(
          'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition',
          showObjectives ? 'border-indigo-400/50 bg-indigo-500/30 text-white' : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white',
        )}
        title="Objectives & Key Results — how work maps to priorities"
      >
        <Target size={12} /> Objectives
      </button>

      {boardBand === 'portfolio' && (
        <button
          onClick={onToggleDashboard}
          className={cn(
            'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition',
            showDashboard ? 'border-violet-400/50 bg-violet-500/30 text-white' : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white',
          )}
          title="Portfolio dashboard — a summary view of this board's initiatives"
        >
          <LayoutDashboard size={12} /> Dashboard
        </button>
      )}

      <button
        onClick={onToggleArchive}
        className={cn(
          'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition',
          showArchive ? 'border-amber-400/50 bg-amber-500/30 text-white' : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white',
        )}
        title="Archive — filed-away items (still searchable, still in links)"
      >
        <Archive size={12} /> Archive
      </button>

      <button
        onClick={onToggleFilters}
        className={cn(
          'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition',
          showFilters ? 'border-indigo-400/50 bg-indigo-500/30 text-white' : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white',
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

      <div className="ml-auto flex items-center gap-2">
        {editMode && (
          <>
            {namingBoard ? (
              <InlineEdit
                autoEdit
                value=""
                placeholder="New board name"
                ariaLabel="New board name"
                onSave={onNewBoard}
                onDone={() => setNamingBoard(false)}
                inputClassName="w-40 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[12px] text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-400"
              />
            ) : (
              <button
                onClick={() => setNamingBoard(true)}
                className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[12px] font-medium text-slate-300 hover:text-white"
                title="Create a new board"
              >
                <Plus size={13} /> Board
              </button>
            )}
            <button
              onClick={onDeleteBoard}
              className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[12px] font-medium text-slate-400 hover:text-rose-300"
              title="Delete this board"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
        <button
          onClick={onAddCard}
          className="flex items-center gap-1 rounded-md bg-indigo-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-indigo-400"
        >
          <Plus size={13} /> Card
        </button>

        <GlobalSearch />

        <button
          onClick={onOpenBoardSettings}
          className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[12px] font-medium text-slate-300 hover:text-white"
          title="Board settings — title, type, card types, WIP"
        >
          <Settings size={13} /> Settings
        </button>

        <button
          onClick={onOpenTypes}
          className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[12px] font-medium text-slate-300 hover:text-white"
          title="Manage issue types"
        >
          <Shapes size={13} /> Types
        </button>

        {editMode ? (
          <>
            <button
              onClick={onSaveEdit}
              className="flex items-center gap-1 rounded-md bg-emerald-500 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-emerald-400"
              title="Save layout changes"
            >
              <Check size={13} /> Save
            </button>
            <button
              onClick={onCancelEdit}
              className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[12px] font-medium text-slate-300 hover:text-white"
              title="Discard layout changes"
            >
              <X size={13} /> Cancel
            </button>
          </>
        ) : (
          <button
            onClick={onEditBoard}
            className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[12px] font-medium text-slate-300 hover:text-white"
            title="Edit board design (split/add/rename lanes)"
          >
            <Pencil size={13} /> Edit board
          </button>
        )}

        <button
          onClick={onReset}
          className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[12px] font-medium text-slate-400 hover:text-white"
          title="Reset the demo data"
        >
          <RotateCcw size={13} /> Reset
        </button>
      </div>
    </header>
  )
}
