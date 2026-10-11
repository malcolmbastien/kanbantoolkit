import { Check, LayoutGrid, Pencil, Plus, RotateCcw, Search, Shapes, Target, Trash2, X } from 'lucide-react'
import { LevelBadge } from './LevelBadge'
import { cn } from '@/lib/utils'
import type { Board, BoardLevel } from '@/domain/types'

interface Props {
  boards: Board[]
  boardId: string
  boardLevel: BoardLevel
  search: string
  editMode: boolean
  showObjectives: boolean
  onSelectBoard: (id: string) => void
  onSetBoardLevel: (level: BoardLevel) => void
  onToggleObjectives: () => void
  onSearch: (q: string) => void
  onEditBoard: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onOpenTypes: () => void
  onAddCard: () => void
  onNewBoard: () => void
  onDeleteBoard: () => void
  onReset: () => void
}

const SELECT_CLS =
  'rounded-md border border-slate-700 bg-slate-800 px-1.5 py-1 text-[12px] font-medium text-slate-100 outline-none focus:ring-2 focus:ring-indigo-400'
const OPT = 'bg-slate-800 text-slate-100'

export function TopBar(props: Props) {
  const { boards, boardId, boardLevel, search, editMode, showObjectives, onSelectBoard, onSetBoardLevel, onToggleObjectives, onSearch, onEditBoard, onSaveEdit, onCancelEdit, onOpenTypes, onAddCard, onNewBoard, onDeleteBoard, onReset } = props

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-950/50 bg-slate-900 px-3 py-2 text-slate-200 shadow-md">
      <div className="flex items-center gap-2">
        <div className="grid h-6 w-6 place-items-center rounded bg-indigo-500 text-white shadow-sm">
          <LayoutGrid size={14} />
        </div>
        <span className="text-sm font-semibold tracking-tight text-white">Flowline</span>
      </div>

      <div className="h-5 w-px bg-slate-700" />

      <LevelBadge level={boardLevel} onChange={onSetBoardLevel} />

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

      <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
        Board
        <select value={boardId} onChange={(e) => onSelectBoard(e.target.value)} className={SELECT_CLS}>
          {boards.map((b) => (
            <option key={b.id} value={b.id} className={OPT}>{b.name}</option>
          ))}
        </select>
      </label>

      <div className="ml-auto flex items-center gap-2">
        {editMode && (
          <>
            <button
              onClick={onNewBoard}
              className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[12px] font-medium text-slate-300 hover:text-white"
              title="Create a new board"
            >
              <Plus size={13} /> Board
            </button>
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

        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Filter cards…"
            className="w-36 rounded-md border border-slate-700 bg-slate-800 py-1 pl-7 pr-2 text-[12px] text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>

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
