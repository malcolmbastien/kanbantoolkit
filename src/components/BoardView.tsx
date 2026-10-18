import { Archive, Download, Info, SlidersHorizontal } from 'lucide-react'
import { ArchivedBoardChip } from './ArchivedBoardChip'
import { BoardCanvas } from './BoardCanvas'
import { BoardSummary } from './BoardSummary'
import { KindFilter } from './KindFilter'
import { ManagementBoard } from './ManagementBoard'
import { isAggregating } from '@/domain/board'
import { boardCsv, csvFilename } from '@/domain/csv'
import { activeFilterCount } from '@/domain/filters'
import { effectiveStage } from '@/domain/lanes'
import { BAND_ACCENT } from '@/lib/colors'
import { downloadText } from '@/lib/download'
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
  const showFilters = useStore((s) => s.showFilters)
  const filters = useStore((s) => s.filters)
  const toggleFilters = useStore((s) => s.toggleFilters)
  const showLegend = useStore((s) => s.showLegend)
  const toggleLegend = useStore((s) => s.toggleLegend)

  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const issueTypes = useStore((s) => s.issueTypes)
  const users = useStore((s) => s.users)

  const board = boards.find((b) => b.id === boardId)
  // Drag empty workflow space to move the board. See usePanScroll.
  const pan = usePanScroll<HTMLDivElement>()

  // Coordination/strategic boards aggregate; operational boards render the flow.
  if (isAggregating(board)) return <ManagementBoard boardId={boardId} />

  const accent = BAND_ACCENT[board?.band ?? 'team']

  const doneCount = placements.filter(
    (p) => p.boardId === boardId && effectiveStage(lanes, p.laneId) === 'done' && !items.find((i) => i.id === p.itemId)?.archived,
  ).length

  // The board's secondary bar: board-scoped controls live with the board. On the left,
  // the board's state and its explainers — the legend right beside any condition chip.
  // Filters sits at the far right, in the corner where its panel opens: a control belongs
  // against the surface it commands. The bar is always present because the Filters control
  // always is; the rest of it appears only when it has something functional to say.
  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-meta text-slate-600">
        <button
          onClick={toggleLegend}
          disabled={editMode}
          className={cn(
            'flex items-center gap-1 rounded-md border px-2 py-1 font-medium transition disabled:pointer-events-none disabled:opacity-40',
            showLegend ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
          )}
          title="Legend — what this board means and how to read it"
        >
          <Info size={12} /> Legend
        </button>
        {board?.archived && <ArchivedBoardChip />}
        {editMode && (
          <span className="rounded bg-amber-100 px-1.5 py-px font-semibold text-amber-800 ring-1 ring-amber-300">
            edit mode · unsaved changes
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
              className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-meta font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
              title="Archive all Done cards on this board so they stop cluttering it"
            >
              <Archive size={11} /> Archive done ({doneCount})
            </button>
          )}
          {/* One explicit action, one file: the board as it reads, columns and all. */}
          <button
            onClick={() =>
              downloadText(
                csvFilename(board?.name ?? 'board', 'cards'),
                boardCsv(boardId, { items, edges, links, placements, lanes }, issueTypes, users, boards),
              )
            }
            disabled={editMode}
            className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-meta font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-40"
            title="Export this board's cards as a CSV file — ref, title, type, column, stage, people, dates and parent"
          >
            <Download size={11} /> Export CSV
          </button>
          <button
            onClick={toggleFilters}
            disabled={editMode}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 font-medium transition disabled:pointer-events-none disabled:opacity-40',
              showFilters ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
            )}
            title="Filters — narrow the cards shown on this board"
          >
            <SlidersHorizontal size={12} /> Filters
            {activeFilterCount(filters) > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-indigo-500 px-1 text-micro font-bold text-white">
                {activeFilterCount(filters)}
              </span>
            )}
          </button>
        </div>
      </div>

      <div ref={pan.ref} {...pan.handlers} className={cn('min-h-0 flex-1 space-y-4 overflow-y-auto p-3', pan.panning ? 'cursor-grabbing select-none' : 'cursor-grab')}>
        {/* Initiatives workflow — this team's initiatives, by rollup */}
        <section className="space-y-2">
          <div className={cn('flex items-center justify-between gap-2 border-b pb-1.5', accent.rule)}>
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', accent.dot)} />
              <h2 className="shrink-0 text-meta font-bold uppercase tracking-wide text-slate-900">Initiatives workflow</h2>
              <span className="truncate text-meta text-slate-600">this team’s initiatives — status rolls up from the cards below</span>
            </div>
            <KindFilter boardId={boardId} />
          </div>
          {/* `variant` says this surface is the board's *own* initiatives flow — the one that owns
              the board's kinds, and the one its kind filter narrows. Without it a team board's
              initiatives were read as somebody else's band: a kind could be set and stored, and
              the card never grew the header that says so. */}
          <BoardSummary boardId={boardId} variant="initiatives" interactive />
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
