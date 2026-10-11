import { Check, Crosshair, Layers, X } from 'lucide-react'
import { BoardCanvas } from './BoardCanvas'
import { BoardSummary } from './BoardSummary'
import { LevelBadge } from './LevelBadge'
import { ManagementBoard } from './ManagementBoard'
import { externalBlockersOnBoard } from '@/domain/board'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Graph } from '@/domain/derive'

interface Props {
  requestMove: (itemId: string, boardId: string, laneId: string) => void
}

export function BoardView({ requestMove }: Props) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const boards = useStore((s) => s.boards)
  const boardId = useStore((s) => s.boardId)
  const editMode = useStore((s) => s.editMode)
  const saveEdit = useStore((s) => s.saveEdit)
  const cancelEdit = useStore((s) => s.cancelEdit)
  const setBoardDerived = useStore((s) => s.setBoardDerived)
  const lensId = useStore((s) => s.lensId)
  const clearLens = useStore((s) => s.clearLens)

  const board = boards.find((b) => b.id === boardId)

  // A board is either a management board (Portfolio level) or a team board.
  if (board?.level === 'portfolio') return <ManagementBoard boardId={boardId} />

  const graph: Graph = { items, edges, links, placements, lanes }
  const external = externalBlockersOnBoard(graph, boardId)

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-950/40 bg-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
        {board && <LevelBadge level={board.level} />}
        <span className="font-semibold text-white">{board?.name}</span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-400">leanlane board</span>
        {board?.derived && (
          <span className="rounded bg-violet-400/20 px-1.5 py-px font-semibold text-violet-200" title="Columns are derived from the lowest-level work in each card's subtree">
            rollup status
          </span>
        )}
        {editMode && (
          <>
            <span className="rounded bg-amber-400/20 px-1.5 py-px font-semibold text-amber-200">edit mode · unsaved changes</span>
            <button onClick={saveEdit} className="flex items-center gap-1 rounded bg-emerald-500 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-400">
              <Check size={11} /> Save
            </button>
            <button onClick={cancelEdit} className="flex items-center gap-1 rounded border border-slate-600 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:text-white">
              <X size={11} /> Cancel
            </button>
            <button
              onClick={() => setBoardDerived(boardId, !board?.derived)}
              className={cn(
                'flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium',
                board?.derived ? 'border-violet-400/50 bg-violet-400/20 text-violet-200' : 'border-slate-600 text-slate-300 hover:text-white',
              )}
              title="Make this a rollup board: each card's column is derived from its lowest-level work"
            >
              rollup
            </button>
          </>
        )}
        {lensId && (
          <span className="flex items-center gap-1 rounded bg-indigo-500/20 px-1.5 py-px font-medium text-indigo-200">
            <Crosshair size={11} /> Focused: {items.find((i) => i.id === lensId)?.title ?? '—'}
            <button onClick={clearLens} className="ml-0.5 text-indigo-200 hover:text-white" title="Clear focus">
              <X size={10} />
            </button>
          </span>
        )}
        {external.length > 0 && (
          <span className="ml-auto flex items-center gap-1 rounded bg-slate-700 px-1.5 py-px font-medium text-slate-200">
            <Layers size={11} /> {external.length} external blocker{external.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* Initiatives workflow — this team's initiatives, by rollup */}
        <section className="rounded-lg border border-indigo-300 bg-indigo-50/60 shadow-sm">
          <div className="flex items-center gap-2 rounded-t-lg border-b border-indigo-300 bg-indigo-800 px-3 py-1.5 text-slate-200">
            <span className="text-[12px] font-bold uppercase tracking-wide text-white">Initiatives workflow</span>
            <span className="text-[10px] text-indigo-200">this team’s initiatives — status rolls up from the cards below</span>
          </div>
          <BoardSummary boardId={boardId} />
        </section>

        {/* Cards workflow — the team's customizable flow */}
        <section className="rounded-lg border border-slate-300 bg-slate-100 shadow-sm">
          <div className="flex items-center gap-2 rounded-t-lg border-b border-slate-300 bg-slate-800 px-3 py-1.5 text-slate-200">
            <span className="text-[12px] font-bold uppercase tracking-wide text-white">Cards workflow</span>
            <span className="text-[10px] text-slate-400">
              {board?.level === 'team' ? 'the team’s flow — drag cards between lanes' : 'the flow — drag cards between lanes'}
            </span>
          </div>
          <BoardCanvas boardId={boardId} interactive onMove={requestMove} />
        </section>
      </div>
    </div>
  )
}
