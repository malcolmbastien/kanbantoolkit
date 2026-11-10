import { lazy, Suspense, useRef, useState } from 'react'
import { ExternalLink, Layers, Link2, X } from 'lucide-react'
import { ArchivedBoardChip } from './ArchivedBoardChip'
import { BandBadge } from './BandBadge'
import { BoardSummary } from './BoardSummary'
import { WorkflowHeader } from './WorkflowHeader'
import { DetailDial } from './DetailDial'
import { ConnectionsLegend, ConnectionsToggle } from './ConnectionsToggle'
import { ConnectionsLinks } from './ConnectionsLinks'
import { StrategyMap } from './StrategyMap'
import { BAND_ACCENT } from '@/lib/colors'
import { linkableBoards } from '@/domain/board'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { usePanScroll } from '@/lib/usePanScroll'
import { useRevealSelection } from '@/lib/useRevealSelection'

// A board is linked only in Edit board, so the picker is not part of the first download.
const LinkBoardDialog = lazy(() =>
  import('./LinkBoardDialog').then((module) => ({ default: module.LinkBoardDialog })),
)

/**
 * An aggregating board (coordination or strategic), Kanbanize-style:
 *  - an "Initiatives workflow" of its own initiatives (wide summary cards with a
 *    progress bar and linked-initiative symbols)
 *  - "Linked boards": the summary flow of every board it aggregates — teams or
 *    other coordination boards, at any depth.
 */
export function ManagementBoard({ boardId }: { boardId: string }) {
  const boards = useStore((s) => s.boards)
  const addLinkedBoard = useStore((s) => s.addLinkedBoard)
  const removeLinkedBoard = useStore((s) => s.removeLinkedBoard)
  const selectBoard = useStore((s) => s.selectBoard)
  const editMode = useStore((s) => s.editMode)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [linkOpen, setLinkOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const board = boards.find((b) => b.id === boardId)
  if (!board) return null

  const linkedIds = board.linkedBoardIds ?? []
  const linked = linkedIds
    .map((id) => boards.find((b) => b.id === id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b))
    // A retired board stops collecting rollups: it is filtered here rather than unlinked,
    // so unarchiving restores the graph exactly.
    .filter((b) => !b.archived)
  // Any board that keeps the aggregation graph acyclic and isn't already linked.
  const candidates = linkableBoards(boards, board.id).filter((b) => !linkedIds.includes(b.id))
  const portfolio = board.band === 'portfolio'
  // The initiatives surface wears the board's band colour (Team = green, Program = blue, Portfolio = violet).
  const accent = BAND_ACCENT[board.band]
  // Drag empty workflow space to move the board. See usePanScroll.
  const pan = usePanScroll<HTMLDivElement>()
  // A card opened from a band is brought into view in this board's own scroller.
  useRevealSelection(pan.ref)
  /**
   * A section wears the same workflow header a team board uses — a dot in the band's colour, a
   * name, a subtitle and the same sticky shelf — so a program or portfolio reads like a team
   * board. Only the colour changes with the board type; the shape is the product's.
   */
  const section = (
    key: string,
    name: string,
    body: React.ReactNode,
    right?: React.ReactNode,
    collapsible = true,
    tone: 'band' | 'slate' = 'slate',
    description?: React.ReactNode,
  ) => {
    const isCollapsed = collapsed[key]
    const dot = tone === 'band' ? accent.dot : 'bg-slate-400'
    return (
      <section key={key} className="space-y-2">
        <WorkflowHeader
          name={name}
          collapsed={collapsible ? isCollapsed : undefined}
          onToggle={collapsible ? () => setCollapsed((c) => ({ ...c, [key]: !c[key] })) : undefined}
          dot={dot}
          title={name}
          description={description}
          right={right}
          // A band section is a workflow and stays in view; a slate grouping ("Linked boards")
          // is a label over other bands, so it scrolls away with them.
          sticky={tone === 'band'}
        />
        {!isCollapsed && <div>{body}</div>}
      </section>
    )
  }

  return (
    // The same ground a team board uses. `slate-200` was the same colour an unsplit Backlog
    // column is tinted with, so on a program board that column disappeared into the page and the
    // columns stopped reading as objects — the one thing the ground exists to carry.
    <div className="flex h-full min-h-0 flex-col bg-board-ground">
      {/* A coordination board has the same secondary bar as a team board: its state on the left,
          and the reading controls on the right. A retired board says so here too — it has no other
          strip to carry the chip. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-meta text-slate-600">
        {board.archived && <ArchivedBoardChip />}
        <div className="ml-auto flex items-center gap-2">
          <ConnectionsLegend boardId={board.id} />
          <DetailDial boardId={board.id} editMode={editMode} />
          <ConnectionsToggle boardId={board.id} />
        </div>
      </div>

      <div ref={pan.ref} {...pan.handlers} className={cn('min-h-0 flex-1 overflow-y-auto p-3', pan.panning ? 'cursor-grabbing select-none' : 'cursor-grab')}>
        <div ref={contentRef} className="relative space-y-3">
        {/* A portfolio leads with strategy: objectives and the initiatives that serve
            them on one page. Other coordination boards show the initiatives workflow. */}
        {portfolio
          ? section(
              `${board.id}-strategy`,
              'Strategy map',
              <StrategyMap boardId={board.id} />,
              undefined,
              // The map is what a portfolio is for; folding it would leave the board empty.
              false,
              'band',
              'each objective with the initiatives that serve it, in this board’s own flow',
            )
          : section(
              `${board.id}-initiatives`,
              'Initiatives workflow',
              <BoardSummary boardId={board.id} variant="initiatives" interactive />,
              undefined,
              true,
              'band',
              'the outcomes this board owns',
            )}

        {/* Linked boards — teams or other coordination boards. A portfolio does not show them:
            its job is the objectives and the initiatives that serve them, and a band of another
            board's flow is a different reading of the same work. The links themselves stay in the
            model (a programme beneath it still rolls up), so this is a decision about one surface
            and not about the data. */}
        {!portfolio && section(
          `${board.id}-linked`,
          'Linked boards',
          <div className="space-y-3 p-2">
            {linked.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-meta text-slate-600">
                Nothing linked yet. Link a team board — or another coordination board — to roll its initiatives up here.
              </div>
            )}
            {linked.map((t) => {
              const isCollapsed = collapsed[`linked-${t.id}`]
              return (
                <div key={t.id} data-linked-board={t.id} className="space-y-2">
                  <WorkflowHeader
                    name={t.name}
                    collapsed={isCollapsed ?? false}
                    onToggle={() => setCollapsed((c) => ({ ...c, [`linked-${t.id}`]: !c[`linked-${t.id}`] }))}
                    dot={BAND_ACCENT[t.band].dot}
                    title={
                      <>
                        <BandBadge band={t.band} />
                        <span className="min-w-0 truncate px-1">{t.name}</span>
                      </>
                    }
                    description={
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-micro font-medium text-slate-600 ring-1 ring-slate-200"
                        title={`Viewing ${t.name}’s initiatives flow from its own board. Cards open and edit here; open the board to move them.`}
                      >
                        <Layers size={9} aria-hidden /> Initiatives flow
                      </span>
                    }
                    right={
                      <>
                        <button
                          onClick={() => selectBoard(t.id)}
                          className="flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-micro font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                          title={`Open ${t.name} in its own board`}
                        >
                          <ExternalLink size={10} /> Open board
                        </button>
                        {/* Unlinking is a change to the board's design, so it belongs with the other
                            design actions in Edit board — a reader is never offered a control that
                            would silently take a band away. */}
                        {editMode && (
                          <button
                            onClick={() => removeLinkedBoard(board.id, t.id)}
                            className="rounded p-0.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            title="Unlink this board"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </>
                    }
                  />
                  {!isCollapsed && <BoardSummary boardId={t.id} viewedBoardId={board.id} variant="initiatives" />}
                </div>
              )
            })}
          </div>,
          undefined,
          false,
          'slate',
          <span className="text-micro text-slate-600">
            {linked.length} board{linked.length === 1 ? '' : 's'} roll up here · each in its own initiatives flow
          </span>,
        )}

        {!portfolio && (
          <div className="flex items-center gap-1 px-1 text-micro text-slate-600">
            <Layers size={11} /> Each band is another board’s initiatives flow — its own Not Started / In Progress / Done. Cards open and edit here; open a board to move its work or change its flow.
          </div>
        )}

        {/* A link is part of the board's design, so it is made in Edit board — at the foot of the
            board, where a team adds a cards flow, rather than in the section header where it
            competed with reading the bands. */}
        {!portfolio && editMode && (
          <button
            onClick={() => setLinkOpen(true)}
            title="Choose a team or coordination board to roll up here"
            aria-label="Link a board"
            className={cn(
              'flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-meta font-medium text-slate-700 transition hover:bg-white',
              accent.section,
            )}
          >
            <Link2 size={13} /> Link a board
          </button>
        )}
        <ConnectionsLinks contentRef={contentRef} boardId={board.id} />
        </div>
      </div>

      {editMode && linkOpen && (
        <Suspense fallback={null}>
          <LinkBoardDialog
            candidates={candidates}
            hostName={board.name}
            onLink={(id) => {
              addLinkedBoard(board.id, id)
              setLinkOpen(false)
            }}
            onClose={() => setLinkOpen(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
