import { Archive, Focus, Layers, X } from 'lucide-react'
import { BoardCanvas } from './BoardCanvas'
import { BoardSummary } from './BoardSummary'
import { ManagementBoard } from './ManagementBoard'
import { externalDependenciesOnBoard, isAggregating } from '@/domain/board'
import { effectiveStage } from '@/domain/lanes'
import { BAND_ACCENT } from '@/lib/colors'
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
  const lensId = useStore((s) => s.lensId)
  const clearLens = useStore((s) => s.clearLens)
  const archiveDoneOnBoard = useStore((s) => s.archiveDoneOnBoard)
  const askConfirm = useStore((s) => s.askConfirm)

  const board = boards.find((b) => b.id === boardId)

  // Coordination/strategic boards aggregate; operational boards render the flow.
  if (isAggregating(board)) return <ManagementBoard boardId={boardId} />

  const graph: Graph = { items, edges, links, placements, lanes }
  const accent = BAND_ACCENT[board?.band ?? 'team']
  const external = externalDependenciesOnBoard(graph, boardId)
  const doneCount = placements.filter(
    (p) => p.boardId === boardId && effectiveStage(lanes, p.laneId) === 'done' && !items.find((i) => i.id === p.itemId)?.archived,
  ).length

  // The board's level and name already live in the TopBar's board picker, so this
  // strip only appears when it has something functional to say.
  const showBar = Boolean(editMode || lensId || doneCount > 0 || external.length > 0)

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-200">
      {showBar && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-950/40 bg-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
          {editMode && (
            <span className="rounded bg-amber-400/20 px-1.5 py-px font-semibold text-amber-200">edit mode · unsaved changes</span>
          )}
          {lensId && (
            <span className="flex items-center gap-1 rounded bg-indigo-500/20 px-1.5 py-px font-medium text-indigo-200">
              <Focus size={11} /> Focused: {items.find((i) => i.id === lensId)?.title ?? '—'}
              <button onClick={clearLens} className="ml-0.5 text-indigo-200 hover:text-white" title="Clear focus">
                <X size={10} />
              </button>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {doneCount > 0 && !editMode && (
              <button
                onClick={() =>
                  askConfirm({
                    title: `Archive ${doneCount} done item${doneCount === 1 ? '' : 's'}?`,
                    body: 'They leave this board but stay searchable in the Archive.',
                    confirmLabel: 'Archive',
                    onConfirm: () => archiveDoneOnBoard(boardId),
                  })
                }
                className="flex items-center gap-1 rounded border border-slate-600 px-2 py-0.5 text-[11px] font-medium text-slate-200 hover:text-white"
                title="Archive all Done cards on this board so they stop cluttering it"
              >
                <Archive size={11} /> Archive done ({doneCount})
              </button>
            )}
            {external.length > 0 && (
              <span className="flex items-center gap-1 rounded bg-slate-700 px-1.5 py-px font-medium text-slate-200">
                <Layers size={11} /> {external.length} external dependenc{external.length > 1 ? 'ies' : 'y'}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* Initiatives workflow — this team's initiatives, by rollup */}
        <section className={cn('rounded-lg border shadow-sm', accent.section)}>
          <div className={cn('flex items-center gap-2 rounded-t-lg border-b px-3 py-1.5 text-slate-200', accent.header)}>
            <span className="text-[12px] font-bold uppercase tracking-wide text-white">Initiatives workflow</span>
            <span className={cn('text-[10px]', accent.subtitle)}>this team’s initiatives — status rolls up from the cards below</span>
          </div>
          <BoardSummary boardId={boardId} interactive />
        </section>

        {/* Cards workflow — the team's customizable flow */}
        <section className="rounded-lg border border-slate-300 bg-slate-100 shadow-sm">
          <div className="flex items-center gap-2 rounded-t-lg border-b border-slate-300 bg-slate-800 px-3 py-1.5 text-slate-200">
            <span className="text-[12px] font-bold uppercase tracking-wide text-white">Cards workflow</span>
            <span className="text-[10px] text-slate-400">
              {lensId
                ? `showing only “${items.find((i) => i.id === lensId)?.title ?? '—'}” — clear the focus to see all cards`
                : board?.band === 'team'
                  ? 'the team’s flow — drag cards between lanes'
                  : 'the flow — drag cards between lanes'}
            </span>
          </div>
          <BoardCanvas boardId={boardId} interactive onMove={requestMove} />
        </section>
      </div>
    </div>
  )
}
