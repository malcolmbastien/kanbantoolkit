import { useEffect, useRef, useState } from 'react'
import { Archive, ChevronDown, ChevronUp, Download, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { ArchivedBoardChip } from './ArchivedBoardChip'
import { BoardCanvas } from './BoardCanvas'
import { DetailDial } from './DetailDial'
import { ConnectionsLegend, ConnectionsToggle } from './ConnectionsToggle'
import { ConnectionsLinks } from './ConnectionsLinks'
import { InlineEdit } from './InlineEdit'
import { BoundaryWorkflow } from './BoundaryWorkflow'
import { BoardSummary } from './BoardSummary'
import { ManagementBoard } from './ManagementBoard'
import { WorkflowHeader } from './WorkflowHeader'
import { isAggregating, isInitiativeItem } from '@/domain/board'
import { boardCsv, csvFilename } from '@/domain/csv'
import { activeFilterCount } from '@/domain/filters'
import { canRemoveFlow, cardsFlows, FLOW_DESCRIPTION_LIMIT, flowLaneIds, initiativesFlow } from '@/domain/flows'
import { effectiveStage } from '@/domain/lanes'
import { BAND_ACCENT } from '@/lib/colors'
import { downloadText } from '@/lib/download'
import { stillScrolling, useStillScroll } from '@/lib/useStillScroll'
import { useRevealSelection } from '@/lib/useRevealSelection'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { usePanScroll } from '@/lib/usePanScroll'
import { useMay } from '@/lib/permissions'
import { useAuth } from '@/lib/auth'
import type { BoardFlow, Item } from '@/domain/types'

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
  // Selecting a card brings it into view: the drawer takes width and the card may be off-screen.
  useRevealSelection(pan.ref)
  // Which workflow bands are folded away. A band is folded on its own, so a reader can keep the
  // initiatives and the boundary in view while one cards flow takes the room; a board switch starts
  // fresh because the initiatives key carries the board and a flow id belongs to one board.
  const [collapsedWorkflows, setCollapsedWorkflows] = useState<Record<string, boolean>>({})
  const toggleWorkflow = (key: string, from?: HTMLButtonElement) => {
    const expanding = collapsedWorkflows[key] === true
    if (expanding) {
      // An expanding band puts its body back under its header. The scroll keeper is told the view
      // is moving on purpose — otherwise it holds the first card below the band still and pushes
      // the new body above the fold — then the band's header is brought to the top of the board,
      // so the body opens where a reader looks for it.
      stillScrolling()
      from?.closest('section')?.scrollIntoView({ block: 'start', inline: 'nearest' })
    }
    setCollapsedWorkflows((current) => ({ ...current, [key]: !current[key] }))
  }

  // Coordination/strategic boards aggregate; operational boards render the flow.
  if (isAggregating(board)) return <ManagementBoard boardId={boardId} />

  const accent = BAND_ACCENT[board?.band ?? 'team']
  const initiativesKey = `initiatives:${boardId}`
  const initiativesCollapsed = collapsedWorkflows[initiativesKey] === true

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
  const initiativesBand = initiativesFlow(flows, boardId)
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
            title="Your role is Viewer: you can read this board and comment"
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
          {/* The board's own reading: how much of a card it draws. It lives here with the other
              controls that command the surface beneath it, not in the global bar. */}
          <ConnectionsLegend boardId={boardId} />
          <DetailDial boardId={boardId} editMode={editMode} />
          <ConnectionsToggle boardId={boardId} />
          <span aria-hidden className="h-4 w-px bg-slate-200" />
          {doneCount > 0 && !editMode && may('item.delete') && (
            <button
              onClick={() =>
                askConfirm({
                  title: `Archive ${doneCount} done item${doneCount === 1 ? '' : 's'}?`,
                  body: 'They leave the board and stay in the Archive.',
                  confirmLabel: 'Archive',
                  onConfirm: () => archiveDoneOnBoard(boardId),
                })
              }
              className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-meta font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
              title="Archive every Done card on this board"
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
            title="This board's cards as CSV: title, type, column, people, dates, parent"
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
            title="Narrow the cards on this board"
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
        <div ref={contentRef} className="relative space-y-6">
        <ConnectionsLinks contentRef={contentRef} boardId={boardId} />
        {/* Initiatives workflow — this team's initiatives, by rollup. The strategic surface:
            a tinted band of its own, so a reader knows which workflow they are looking at
            before reading a single column. */}
        <section className="space-y-2.5">
          <WorkflowHeader
            name="Initiatives workflow"
            collapsed={initiativesCollapsed}
            onToggle={(button) => toggleWorkflow(initiativesKey, button)}
            dot={accent.dot}
            title="Initiatives workflow"
            description={initiativesBand ? <FlowDescription flow={initiativesBand} editable={editMode && editable} /> : undefined}
            right={
              <span className="hidden shrink-0 text-micro font-semibold text-slate-600 sm:inline">
                {initiativeCount} {initiativeCount === 1 ? 'initiative' : 'initiatives'}
              </span>
            }
          />
          {/* `variant` says this surface is the board's *own* initiatives flow — the one that owns
              the board's kinds. Without it a team board's initiatives were read as somebody else's
              band: a kind could be set and stored, and the card never grew the header that says so. */}
          {!initiativesCollapsed && <BoardSummary boardId={boardId} variant="initiatives" interactive={editable} />}
        </section>

        {/* Cards flows — the team's own column sets, one band each. Stacked rather than tabbed:
            a card crossing flows is then a drag between two visible trees, and a board with three
            flows reads as three flows rather than as one and two hidden behind a tab. Each band
            names itself, counts its own work, and carries its own design controls in edit mode. */}
        {flowsOnBoard.map((flow, index) => {
          const name = flow.name
          const count = counts[flow.id] ?? 0
          const removable = canRemoveFlow(flows, flow.id, lanes, placements)
          const collapsed = collapsedWorkflows[flow.id] === true
          return (
            <section
              key={flow.id}
              className="space-y-2.5"
              data-flow-band={flow.id}
              data-flow-name={name}
              aria-label={`${name} — cards flow`}
            >
              <WorkflowHeader
                name={name}
                collapsed={collapsed}
                onToggle={(button) => toggleWorkflow(flow.id, button)}
                dot="bg-indigo-600"
                title={
                  editMode && editable ? (
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
                  )
                }
                description={<FlowDescription flow={flow} editable={editMode && editable} />}
                right={
                  <>
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
                              body: 'Its columns go with it. A flow holding cards cannot be removed.',
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
                                ? 'A board needs at least one cards flow'
                                : 'Move its cards to another flow first'
                          }
                          aria-label={`Remove ${name}`}
                          className="grid h-6 w-6 place-items-center rounded text-slate-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:pointer-events-none disabled:opacity-30"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                    <span className="text-micro font-semibold text-slate-600">
                      {count} {count === 1 ? 'card' : 'cards'}
                    </span>
                  </>
                }
              />
              {!collapsed && (
                <BoardCanvas boardId={boardId} flowId={flow.id} interactive={editable} onMove={requestMove} />
              )}
            </section>
          )
        })}

        {flowsOnBoard.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-meta text-slate-600">
            This board has no cards flow. It aggregates other boards' work.
          </p>
        )}

        {/* The one place a second flow comes from. A compact action, not another band: the
            button sits at the end of the stack with its own solid ground and shadow, so it reads
            as something to press rather than the header of an empty workflow. */}
        {editMode && editable && (
          <div className="flex justify-center pt-1">
            <button
              onClick={() => addCardsFlow()}
              title="Another set of columns on this board"
              aria-label="Add a cards flow"
              className="flex w-fit items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-meta font-semibold text-white shadow-md ring-1 ring-indigo-700/20 transition hover:bg-indigo-500 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
            >
              <Plus size={14} strokeWidth={2.5} /> Add a cards flow
            </button>
          </div>
        )}

        {/* Boundary work: the edge of this board, as a workflow of its own — below the cards, in
            the same four stages, and read-only. It renders nothing when nothing crosses the edge. */}
        <BoundaryWorkflow key={boardId} boardId={boardId} />
        </div>
      </div>
    </div>
  )
}

/**
 * A workflow's optional sub-header: what this workflow is for, in the board's own words.
 *
 * It is part of the board's design, so it is written in Edit board, in place beside the name. A
 * workflow with no line shows only its name and count; an empty line is a legitimate choice, not a
 * missing one. Enter or a click away saves, Escape reverts, and a clear button removes it.
 */
function FlowDescription({ flow, editable }: { flow: BoardFlow; editable: boolean }) {
  const setFlowDescription = useStore((state) => state.setFlowDescription)
  const saved = flow.description ?? ''
  const [draft, setDraft] = useState(saved)
  const cancelled = useRef(false)

  // A design adopted from another device is the new saved line; a draft that was being typed is
  // not worth keeping over it.
  useEffect(() => setDraft(saved), [saved])

  if (!editable) {
    return saved ? <span className="min-w-0 truncate text-meta text-slate-600">{saved}</span> : null
  }

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false
            return
          }
          setFlowDescription(flow.id, draft)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            cancelled.current = true
            setDraft(saved)
            event.currentTarget.blur()
          }
        }}
        placeholder="Describe this workflow (optional)"
        aria-label={`${flow.name} description`}
        maxLength={FLOW_DESCRIPTION_LIMIT}
        className="min-w-0 flex-1 rounded border border-slate-200 bg-white/70 px-1 py-0.5 text-meta text-slate-600 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-300 focus:bg-white"
      />
      {draft.trim() && (
        <button
          type="button"
          // Keep the input's focus: a blur here would commit the line the button is about to clear.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setDraft('')
            setFlowDescription(flow.id, '')
          }}
          aria-label={`Clear ${flow.name} description`}
          title="Clear this description"
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={11} />
        </button>
      )}
    </span>
  )
}
