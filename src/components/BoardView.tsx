import { useRef } from 'react'
import { Archive, ChevronDown, ChevronUp, Download, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { ArchivedBoardChip } from './ArchivedBoardChip'
import { BoardCanvas } from './BoardCanvas'
import { InlineEdit } from './InlineEdit'
import { BoundaryWorkflow } from './BoundaryWorkflow'
import { BoardSummary } from './BoardSummary'
import { ManagementBoard } from './ManagementBoard'
import { isAggregating, isInitiativeItem } from '@/domain/board'
import { boardCsv, csvFilename } from '@/domain/csv'
import { activeFilterCount } from '@/domain/filters'
import { canRemoveFlow, cardsFlows, flowLaneIds } from '@/domain/flows'
import { effectiveStage } from '@/domain/lanes'
import { BAND_ACCENT } from '@/lib/colors'
import { downloadText } from '@/lib/download'
import { useStillScroll } from '@/lib/useStillScroll'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { usePanScroll } from '@/lib/usePanScroll'
import { useMay } from '@/lib/permissions'
import { useAuth } from '@/lib/auth'
import type { Item } from '@/domain/types'

interface Props {
  /**
   * Ask for a card to change lane. It answers whether the card is now there — false when a WIP
   * policy refused or held the move — and takes the place a drop offered, which a held move keeps.
   */
  requestMove: (itemId: string, boardId: string, laneId: string, index?: number) => boolean
}

export function BoardView({ requestMove }: Props) {
  const items = useStore((s) => s.items)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const flows = useStore((s) => s.flows)
  const boards = useStore((s) => s.boards)
  const boardId = useStore((s) => s.boardId)
  const editMode = useStore((s) => s.editMode)
  const addCardsFlow = useStore((s) => s.addCardsFlow)
  const renameFlow = useStore((s) => s.renameFlow)
  const moveFlow = useStore((s) => s.moveFlow)
  const removeFlow = useStore((s) => s.removeFlow)
  const archiveDoneOnBoard = useStore((s) => s.archiveDoneOnBoard)
  const askConfirm = useStore((s) => s.askConfirm)
  const showFilters = useStore((s) => s.showFilters)
  const filters = useStore((s) => s.filters)
  const toggleFilters = useStore((s) => s.toggleFilters)

  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const issueTypes = useStore((s) => s.issueTypes)
  const users = useStore((s) => s.users)

  const board = boards.find((b) => b.id === boardId)
  // A Viewer reads a board and comments on it, and is offered nothing that writes to it. The
  // server refuses the writes either way; offering the control would be the lie.
  const may = useMay()
  const editable = may('item.write')
  const signedIn = useAuth((state) => state.user !== null)
  // Drag empty workflow space to move the board. See usePanScroll.
  const pan = usePanScroll<HTMLDivElement>()
  // The board scroller and what is inside it, held still across height changes (a card moving
  // between columns is the usual one). Above the early return below, so the hook order is the same
  // for an aggregating board and a team board.
  const contentRef = useRef<HTMLDivElement>(null)
  useStillScroll(pan.ref, contentRef, undefined, boardId)

  // Coordination/strategic boards aggregate; operational boards render the flow.
  if (isAggregating(board)) return <ManagementBoard boardId={boardId} />

  const accent = BAND_ACCENT[board?.band ?? 'team']

  const doneCount = placements.filter(
    (p) => p.boardId === boardId && effectiveStage(lanes, p.laneId) === 'done' && !items.find((i) => i.id === p.itemId)?.archived,
  ).length

  // The two workflows, as two populations: an initiative is what the board is read for, and a
  // card is how it gets done. Saying each surface's size in its own band is the cheapest way to
  // keep a reader oriented in which one they are looking at — and neither number narrows.
  const onBoard = placements
    .filter((p) => p.boardId === boardId)
    .map((p) => items.find((i) => i.id === p.itemId))
    .filter((i): i is Item => i !== undefined && !i.archived)
  const initiativeCount = onBoard.filter((i) => isInitiativeItem(i, issueTypes)).length

  // The cards flows, in the board's order — each a band of its own, stacked the way the board's
  // flows are. A band's count is the load *its* lanes carry: archived cards are off the board, and
  // an initiative is not a card, so neither inflates it.
  const flowsOnBoard = cardsFlows(flows, boardId)
  const laneOf = new Map(placements.filter((p) => p.boardId === boardId).map((p) => [p.itemId, p.laneId] as const))
  const counts = Object.fromEntries(
    flowsOnBoard.map((flow) => {
      const laneIds = flowLaneIds(lanes, flow.id)
      const cards = onBoard.filter(
        (i) => !isInitiativeItem(i, issueTypes) && laneIds.has(laneOf.get(i.id) ?? ''),
      ).length
      return [flow.id, cards]
    }),
  )

  // The board's secondary bar: board-scoped controls live with the board. On the left,
  // the board's state; Filters sits at the far right, in the corner where its panel opens —
  // a control belongs against the surface it commands.
  return (
    <div className="flex h-full min-h-0 flex-col bg-board-ground">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-white/90 px-3 py-1.5 text-meta text-slate-600 backdrop-blur-sm">
        {board?.archived && <ArchivedBoardChip />}
        {signedIn && !editable && (
          <span
            className="rounded bg-slate-100 px-1.5 py-px font-semibold text-slate-600 ring-1 ring-slate-300"
            title="Your role is Viewer: you can read this board and comment on it"
          >
            read-only · viewer
          </span>
        )}
        {editMode && (
          <span className="rounded bg-amber-100 px-1.5 py-px font-semibold text-amber-800 ring-1 ring-amber-300">
            edit mode · unsaved changes
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {doneCount > 0 && !editMode && may('item.delete') && (
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
                boardCsv(boardId, { items, edges, links, placements, lanes }, issueTypes, users, flows, boards),
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

      <div
        ref={pan.ref}
        {...pan.handlers}
        // The board's height is its tallest column, so a card moving between columns changes it
        // while nobody asked the view to move. The browser's own anchoring is turned off here and
        // `useStillScroll` keeps the reader's place instead — one mechanism, the same in every
        // browser, and testable.
        style={{ overflowAnchor: 'none' }}
        data-board-scroll
        className={cn('min-h-0 flex-1 overflow-y-auto p-4', pan.panning ? 'cursor-grabbing select-none' : 'cursor-grab')}
      >
        <div ref={contentRef} className="space-y-6">
        {/* Initiatives workflow — this team's initiatives, by rollup. The strategic surface:
            a tinted band of its own, so a reader knows which workflow they are looking at
            before reading a single column. */}
        <section className="space-y-2.5">
          <div className={cn('flex items-center justify-between gap-2 rounded-lg border px-3 py-2', accent.section)}>
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', accent.dot)} />
              <h2 className="shrink-0 text-body font-bold uppercase tracking-wide text-slate-900">Initiatives workflow</h2>
              <span className="truncate text-meta text-slate-600">this team’s initiatives — status rolls up from the cards below</span>
            </div>
            <span className="hidden shrink-0 rounded-full bg-white px-2 py-0.5 text-micro font-semibold text-slate-600 ring-1 ring-emerald-200 sm:inline">
              {initiativeCount} {initiativeCount === 1 ? 'initiative' : 'initiatives'}
            </span>
          </div>
          {/* `variant` says this surface is the board's *own* initiatives flow — the one that owns
              the board's kinds. Without it a team board's initiatives were read as somebody else's
              band: a kind could be set and stored, and the card never grew the header that says so. */}
          <BoardSummary boardId={boardId} variant="initiatives" interactive={editable} />
        </section>

        {/* Cards flows — the team's own column sets, one band each. Stacked rather than tabbed:
            a card crossing flows is then a drag between two visible trees, and a board with three
            flows reads as three flows rather than as one and two hidden behind a tab. Each band
            names itself, counts its own work, and carries its own design controls in edit mode. */}
        {flowsOnBoard.map((flow, index) => {
          const name = flow.name
          const count = counts[flow.id] ?? 0
          const removable = canRemoveFlow(flows, flow.id, lanes, placements)
          return (
            <section
              key={flow.id}
              className="space-y-2.5"
              data-flow-band={flow.id}
              data-flow-name={name}
              aria-label={`${name} — cards flow`}
            >
              <div className="flex items-center justify-between gap-2 rounded-lg border border-indigo-200/80 bg-indigo-50/50 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-600" />
                  <h2 className="flex shrink-0 items-center text-body font-bold uppercase tracking-wide text-slate-900">
                    {editMode && editable ? (
                      <InlineEdit
                        value={name}
                        onSave={(next) => renameFlow(flow.id, next)}
                        ariaLabel={`Rename ${name}`}
                        title="Rename this flow"
                        className="rounded px-1 py-0.5 text-left uppercase tracking-wide transition hover:bg-indigo-100"
                        inputClassName="w-40 rounded border border-indigo-300 bg-white px-1 py-0.5 text-body font-bold uppercase tracking-wide text-slate-900 outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    ) : (
                      <span className="px-1 py-0.5">{name}</span>
                    )}
                  </h2>
                  <span className="truncate text-meta text-slate-600">
                    {board?.band === 'team' ? 'the team’s flow — drag cards between lanes' : 'the flow — drag cards between lanes'}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {editMode && editable && (
                    <>
                      <button
                        onClick={() => moveFlow(flow.id, -1)}
                        disabled={index <= 0}
                        title="Move this flow up"
                        aria-label={`Move ${name} up`}
                        className="grid h-6 w-6 place-items-center rounded text-slate-600 transition hover:bg-indigo-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        onClick={() => moveFlow(flow.id, 1)}
                        disabled={index >= flowsOnBoard.length - 1}
                        title="Move this flow down"
                        aria-label={`Move ${name} down`}
                        className="grid h-6 w-6 place-items-center rounded text-slate-600 transition hover:bg-indigo-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ChevronDown size={13} />
                      </button>
                      <button
                        onClick={() =>
                          askConfirm({
                            title: `Remove the “${name}” flow?`,
                            body: 'Its columns go with it. It holds no cards — a flow with work in it cannot be removed.',
                            confirmLabel: 'Remove flow',
                            danger: true,
                            onConfirm: () => removeFlow(flow.id),
                          })
                        }
                        disabled={!removable}
                        // Said separately, because the two refusals are different facts: the last
                        // flow is the board's floor, and an occupied one is a decision to make
                        // elsewhere. Neither is offered as if it might work.
                        title={
                          removable
                            ? 'Remove this flow and its columns'
                            : flowsOnBoard.length <= 1
                              ? 'A board keeps at least one cards flow'
                              : 'This flow still holds cards — move them to another flow first'
                        }
                        aria-label={`Remove ${name}`}
                        className="grid h-6 w-6 place-items-center rounded text-slate-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                  <span className="rounded-full bg-white px-2 py-0.5 text-micro font-semibold text-slate-600 ring-1 ring-indigo-200">
                    {count} {count === 1 ? 'card' : 'cards'}
                  </span>
                </div>
              </div>
              <BoardCanvas boardId={boardId} flowId={flow.id} interactive={editable} onMove={requestMove} />
            </section>
          )
        })}

        {flowsOnBoard.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-meta text-slate-600">
            This board has no cards flow: a coordination board aggregates work rather than holding it.
          </p>
        )}

        {/* The one place a second flow comes from, and it reads as a band would: the cards area
            grows by a band, not by a tab nobody can see. */}
        {editMode && editable && (
          <button
            onClick={() => addCardsFlow()}
            title="Add a cards flow — another set of columns on this board"
            aria-label="Add a cards flow"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-indigo-300 px-3 py-2 text-meta font-medium text-indigo-700 transition hover:bg-indigo-50"
          >
            <Plus size={13} /> Add a cards flow
          </button>
        )}

        {/* Boundary work: the edge of this board, as a workflow of its own — below the cards, in
            the same four stages, and read-only. It renders nothing when nothing crosses the edge. */}
        <BoundaryWorkflow boardId={boardId} />
        </div>
      </div>
    </div>
  )
}
