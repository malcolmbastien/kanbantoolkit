import { Archive } from 'lucide-react'
import { ArchivedBoardChip } from './ArchivedBoardChip'
import { BoardCanvas } from './BoardCanvas'
import { BoardSummary } from './BoardSummary'
import { ManagementBoard } from './ManagementBoard'
import { isAggregating } from '@/domain/board'
import { effectiveStage } from '@/domain/lanes'
import { BAND_ACCENT } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { usePanScroll } from '@/lib/usePanScroll'

interface Props {
  requestMove: (itemId: string, boardId: string, laneId: string) => void
}

export function BoardView({ requestMove }: Props) {
  const items = useStore((s) => s.items)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const boards = useStore((s) => s.boards)
  const boardId = useStore((s) => s.boardId)
  const editMode = useStore((s) => s.editMode)
  const archiveDoneOnBoard = useStore((s) => s.archiveDoneOnBoard)
  const askConfirm = useStore((s) => s.askConfirm)

  const board = boards.find((b) => b.id === boardId)
  // Drag empty workflow space to move the board. See usePanScroll.
  const pan = usePanScroll<HTMLDivElement>()

  // Coordination/strategic boards aggregate; operational boards render the flow.
  if (isAggregating(board)) return <ManagementBoard boardId={boardId} />

  const accent = BAND_ACCENT[board?.band ?? 'team']
  const doneCount = placements.filter(
    (p) => p.boardId === boardId && effectiveStage(lanes, p.laneId) === 'done' && !items.find((i) => i.id === p.itemId)?.archived,
  ).length

  // The board's level and name already live in the TopBar's board picker, so this
  // strip only appears when it has something functional to say.
  const showBar = Boolean(board?.archived || editMode || doneCount > 0)

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100">
      {showBar && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-meta text-slate-600">
          {board?.archived && <ArchivedBoardChip />}
          {editMode && (
            <span className="rounded bg-amber-100 px-1.5 py-px font-semibold text-amber-800 ring-1 ring-amber-300">
              edit mode · unsaved changes
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* Editing a board's design is its own mode, so its actions live in the mode
                strip rather than the top bar — where they used to push the row over and
                wrap it. */}
            {editMode && (
              <>
              </>
            )}
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
                className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-meta font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
                title="Archive all Done cards on this board so they stop cluttering it"
              >
                <Archive size={11} /> Archive done ({doneCount})
              </button>
            )}
          </div>
        </div>
      )}

      <div ref={pan.ref} {...pan.handlers} className={cn('min-h-0 flex-1 space-y-4 overflow-y-auto p-3', pan.panning ? 'cursor-grabbing select-none' : 'cursor-grab')}>
        {/* Initiatives workflow — this team's initiatives, by rollup */}
        <section className="space-y-2">
          <div className={cn('flex items-center justify-between gap-2 border-b pb-1.5', accent.rule)}>
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', accent.dot)} />
              <h2 className="shrink-0 text-meta font-bold uppercase tracking-wide text-slate-900">Initiatives workflow</h2>
              <span className="truncate text-meta text-slate-600">this team’s initiatives — status rolls up from the cards below</span>
            </div>
          </div>
          <BoardSummary boardId={boardId} interactive />
        </section>

        {/* Cards workflow — the team's customizable flow */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-600" />
              <h2 className="shrink-0 text-meta font-bold uppercase tracking-wide text-slate-900">Cards workflow</h2>
              <span className="truncate text-meta text-slate-600">
                {board?.band === 'team' ? 'the team’s flow — drag cards between lanes' : 'the flow — drag cards between lanes'}
              </span>
            </div>
          </div>
          <BoardCanvas boardId={boardId} interactive onMove={requestMove} />
        </section>
      </div>
    </div>
  )
}
