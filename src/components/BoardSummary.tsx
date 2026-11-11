import { Children, useMemo, useRef, useState } from 'react'
import { Card, type CardParent } from './Card'
import { DragLayer } from './DragLayer'
import { DropGap } from './DropGap'
import { InlineEdit } from './InlineEdit'
import { useCardLift } from '@/lib/useCardLift'
import { insertionIndex } from '@/lib/dropIndex'
import { parentTargetUnder } from '@/lib/dropTarget'
import { CtlDivider, CtlGroup, LaneCtl } from './LaneCtl'
import { LaneSettings } from './LaneSettings'
import {
  checklistProgress,
  canPlaceInSection,
  type Graph,
} from '@/domain/derive'
import { buildBoardModel } from '@/domain/boardModel'
import { initiativeHealth, type HealthFlagInfo } from '@/domain/health'
import { boardInitiatives, canAddInitiative, initiativeCellOf, initiativeRanks, initiativeTypeById, initiativeTypeId, isInitiativeItem, tagsOf } from '@/domain/board'
import { detailFor, type BoardDetail } from '@/domain/boardDetail'
import { childrenOf, isLeaf, lanePath, leavesUnder, topLevelLanes } from '@/domain/lanes'
import { STAGE_ACCENT, STAGE_SURFACE, tintOn } from '@/lib/colors'
import { cn } from '@/lib/utils'
import {
  ArrowLeftRight,
  BetweenHorizontalStart,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsRight,
  Columns3,
  Hourglass,
  CopyPlus,
  Plus,
  Rows3,
  Settings,
} from 'lucide-react'
import { useStore } from '@/store'
import { useDrag } from '@/lib/drag'
import type { IssueType, Item, Lane, Stage } from '@/domain/types'
import { initiativesFlow } from '@/domain/flows'

/**
 * A lane header row: the name truly centred, with the WIP count and any edit controls pinned
 * right. The side columns are `1fr` each and the middle sizes to the name, so the centring
 * holds whether or not a lane carries a count or is being edited.
 */
const HEAD_ROW = 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1'

/**
 * A summary band for the management view: only the board's initiative-level work
 * (items of the Initiative type), grouped by the typed columns of the board's flow.
 *
 * The *section* an initiative sits in is derived — `rollupOf(item).bucket` picks the
 * typed column, so an initiative can never claim a stage its work doesn't have. The
 * *cell* within that section is the user's: their placement names it, and if that
 * placement is stale (the work below moved the rollup on) the initiative simply falls
 * back to the section's first cell. Arrangement, not truth.
 */
export function BoardSummary({
  boardId,
  viewedBoardId,
  variant = 'team',
  interactive = false,
  onlyIds,
}: {
  boardId: string
  /** The board the person is looking at, when this is a band inside another board. */
  viewedBoardId?: string
  variant?: 'initiatives' | 'team'
  /** Own surface: drag initiatives between cells and edit the flow. Linked bands set this false. */
  interactive?: boolean
  /**
   * Draw exactly these initiatives — when a surface groups a flow by something other than the flow
   * itself. A portfolio groups it by the objective each initiative serves, and those initiatives
   * may live on any board: the link names the outcome, not a placement. So a group is the board's
   * own columns narrowed to named members, wherever they sit.
   *
   * Everything downstream follows from that one narrowing: a cell's badge counts the group's
   * initiatives, and the health is found for them alone — which matters, because the health rules
   * are not linear in the size of a board and N groups must not each pay for the whole board.
   * `[]` means none, which is a real answer: an objective nobody serves still shows its columns.
   */
  onlyIds?: string[]
}) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const flows = useStore((s) => s.flows)
  const issueTypes = useStore((s) => s.issueTypes)
  const boards = useStore((s) => s.boards)
  const users = useStore((s) => s.users)
  const links = useStore((s) => s.links)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const dropTargetId = useDrag((s) => s.dropTargetId)
  const setDropTarget = useDrag((s) => s.setDropTarget)
  const openItem = useStore((s) => s.openItem)
  const openItemDependencies = useStore((s) => s.openItemDependencies)
  const addCard = useStore((s) => s.addCard)
  const editMode = useStore((s) => s.editMode)
  const boardDetail = useStore((s) => s.boardDetail)
  const moveInitiativeToIndex = useStore((s) => s.moveInitiativeToIndex)

  const graph: Graph = { items, edges, links, placements, lanes }
  // The board's derived facts, once for the render; each initiative card reads a map.
  const model = useMemo(() => buildBoardModel(graph), [items, edges, links, placements, lanes])
  // A new initiative is made in the cell that offered it, from the Backlog column only — the same
  // place the cards workflow makes a card. A portfolio is read-only and never offers the door.
  const addsInitiatives = canAddInitiative(boards.find((b) => b.id === boardId))
  const addInitiativeTo = (laneId: string) => {
    const typeId = initiativeTypeId(issueTypes)
    if (!addsInitiatives || !typeId) return
    addCard({ boardId, typeId, laneId, title: 'New initiative' })
  }

  /**
   * Every initiative's health, found once per change to the work rather than once per render.
   *
   * This is the one derivation on this surface that is not linear in the size of the board: the
   * waiting rule walks the links once for each open descendant, and the staleness rule looks up a
   * placement for each of them, so a programme of three hundred cards costs more than a card
   * does by more than three hundred times. A re-render for a selection, a filter or a lens — which
   * is most of them — does not touch the work, so it does not recompute this.
   *
   * The day is part of the key because one of the rules counts days: without it a board left open
   * overnight would go on saying "still 12d".
   */
  const today = Math.floor(Date.now() / 86_400_000)
  // The ids as one string, because the array is rebuilt on every render by whoever passes it and
  // a memo keyed on the array would never hold.
  const onlyKey = onlyIds ? onlyIds.join(',') : null
  const health = useMemo(() => {
    const now = Date.now()
    const only = onlyKey === null ? null : new Set(onlyKey.split(',').filter(Boolean))
    const found = new Map<string, HealthFlagInfo[]>()
    for (const c of items) {
      if (!isInitiativeItem(c, issueTypes)) continue
      if (only && !only.has(c.id)) continue
      found.set(c.id, initiativeHealth(c.id, { items, edges, links, placements, lanes }, now).flags)
    }
    return found
  }, [items, edges, links, placements, lanes, issueTypes, today, onlyKey])
  const typeOf = (typeId: string): IssueType =>
    issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  // Initiative-level work only — the same computation the dashboard and the timeline read, so
  // the surfaces cannot disagree about what this board's initiatives are. Every initiative
  // placed on the board is drawn, including one that rolls up under another initiative here:
  // gaining a parent is a hierarchy edit, not a way off the board.
  // A named set is drawn as named, wherever the initiatives live; otherwise this is the board's
  // own initiatives, found once so every surface that reads them agrees.
  // The board's initiatives, found when the data changes rather than on every selection: one
  // pass over the items, keyed on the ids a named set carries (the array itself is rebuilt by
  // whoever passes it, so it cannot be a dependency).
  const allInitiatives = useMemo(() => {
    const only = onlyKey === null ? null : new Set(onlyKey.split(',').filter(Boolean))
    return only
      ? items.filter((i) => only.has(i.id) && isInitiativeItem(i, issueTypes) && !i.archived)
      : boardInitiatives({ items, edges, links, placements, lanes }, boardId, issueTypes)
  }, [onlyKey, items, edges, links, placements, lanes, issueTypes, boardId])
  const initiatives = allInitiatives

  /**
   * A section is a typed column; its cells are its leaves — itself, until it's split.
   *
   * Memoised on the data, because `initiativeRanks` asks for a rollup per initiative — twice per
   * section — and a rollup walks the work below it. On a board of a thousand cards that is the
   * largest thing a *selection* used to redo, for an answer that cannot have changed.
   */
  const initiativesFlowOf = useMemo(() => initiativesFlow(flows, boardId), [flows, boardId])
  const sections = useMemo(
    () =>
      (initiativesFlowOf ? topLevelLanes(lanes, initiativesFlowOf.id) : [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((section) => {
          const stage = (section.stage ?? 'inProgress') as Stage
          const cells = leavesUnder(lanes, section.id)
          // A cell's initiatives are a rank a person orders — the same order a drop writes — so
          // they read through placements. An initiative the work below has rolled out of the cell
          // it was arranged in has no rank left to read; `initiativeRanks` decides where it reads
          // instead of dropping it, which is what this filtering used to do by hand.
          const graph = { items, edges, links, placements, lanes }
          const byCell = initiativeRanks(graph, boardId, section.id, initiatives, flows)
          // The badge reads the column, not the view: narrowing the flow changes what is *shown*,
          // and never the load the cell carries. Two walks, because the two answers differ exactly
          // when a filter is on — and only then.
          const held = initiativeRanks(graph, boardId, section.id, allInitiatives, flows)
          const total = [...held.values()].reduce((n, rank) => n + rank.length, 0)
          return { section, stage, cells, byCell, held, total }
        }),
    [
      initiativesFlowOf,
      lanes,
      items,
      edges,
      links,
      placements,
      boardId,
      initiatives,
      allInitiatives,
      flows,
    ],
  )

  const isInitiatives = variant === 'initiatives'
  // The board the person is actually reading — the band's host when this is a band.
  const readBoard = boards.find((b) => b.id === (viewedBoardId ?? boardId))
  // A band is read on the board in front of the reader, so the dial of that board decides how
  // much of the band's initiatives to draw. A team board's own flow uses its own choice.
  const detail: BoardDetail = editMode ? 'full' : detailFor(boardDetail, viewedBoardId ?? boardId)
  const collapsedLanes = useStore((s) => s.collapsedLanes)
  const flowRef = useRef<HTMLDivElement>(null)
  // The initiatives flow's height when the gesture began. Taking a card out of a cell can make
  // the tallest section shorter before the gap appears under the pointer; hold the starting
  // height until the card is down, and let the board settle afterwards.
  const dragStartHeight = useRef<number | null>(null)

  /** The initiative currently in flight, if any. */
  // The same lift the cards workflow uses — one implementation, so a card in the air behaves
  // the same on either surface. Where it lands is this surface's own: a cell, and only a cell of
  // the section the initiative already belongs to.
  const { lift, start: startLift, justDragged } = useCardLift({
    // The lifted card's id comes from the gesture, not from `lift` — the move listener is
    // registered once at pointerdown, when lift is still null, so reading it through this
    // closure made the cell preview dead for the whole drag. This was the bug: drops worked
    // (onDrop is handed the id) while the target cell never lit up.
    onMove: (itemId, x, y) => {
      // An initiative card under the pointer takes the drop and the cells give way: the gesture
      // is a hierarchy edit there, and a rearrangement here, and never both at once.
      const parent = parentTargetUnder(x, y, itemId, graph, issueTypes)
      setDropTarget(parent)
      setDropCell(parent ? null : cellUnder(x, y, itemId))
    },
    onDrop: (itemId, x, y) => {
      setDropCell(null)
      setDropTarget(null)
      const parent = parentTargetUnder(x, y, itemId, graph, issueTypes)
      if (parent) {
        // An initiative rolls up to another initiative. It stays in its own cell: the section is
        // derived from the work, and this changes whose work it is, not where it sits.
        setParent(itemId, parent)
        return
      }
      const target = cellUnder(x, y, itemId)
      if (target) moveInitiativeToIndex(itemId, boardId, target.cellId, target.index)
    },
  })
  const [dropCell, setDropCell] = useState<{ cellId: string; index: number } | null>(null)
  // Measure before the lift's first render, while the card is still in its cell.
  const beginLift = (event: React.PointerEvent, itemId: string) => {
    dragStartHeight.current = flowRef.current?.getBoundingClientRect().height ?? null
    startLift(event, itemId)
  }
  // The highlighted cell is live only while an initiative is actually in the air — the same
  // rule the cards workflow keeps. A pointercancel ends a gesture without a drop, so the
  // preview must answer to the gesture, not to whichever cell was last under the pointer.
  const previewCell = lift !== null ? dropCell : null
  /** The cell under the pointer, if it is one an initiative may move into. */
  const cellUnder = (x: number, y: number, itemId: string | undefined) => {
    const here = itemId ? initiativeCellOf(itemId, boardId, graph, flows) : undefined
    if (!here) return null
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cell-id]')
    const cellId = cell?.dataset.cellId
    const sectionId = cell?.dataset.sectionId
    // A split section's own body answers `closest('[data-cell-id]')` too — it is a container,
    // not a cell. The store refuses drops there, so the preview refuses to light it: a shadow
    // may only stand where a drop would be accepted.
    if (!cellId || !isLeaf(lanes, cellId)) return null
    // An initiative may only be rearranged within its own section — and its own cell counts:
    // the initiatives of a cell are a rank, and reordering it is a move. An initiative with
    // nothing below it is the exception, because its section is the only fact there is; the rule
    // lives in the domain (`canPlaceInSection`), so this preview and the store cannot disagree.
    if (!canPlaceInSection(itemId!, cellId, graph) && sectionId !== here.sectionId) return null
    // The position the drop will write: the cards that remain, in rank order — which is the
    // order they render in — and how many of them sit above the pointer.
    const cards = [...cell.querySelectorAll<HTMLElement>('[data-card-id]')].filter((el) => el.dataset.cardId !== itemId)
    return { cellId, index: insertionIndex(cards, x, y, detail === 'mini') }
  }
  const parentPickId = useStore((s) => s.parentPickId)
  const setParent = useStore((s) => s.setParent)
  const cancelParentPick = useStore((s) => s.cancelParentPick)
  const childPickId = useStore((s) => s.childPickId)
  const openCardMenu = useStore((s) => s.openCardMenu)

  // A board with no typed columns says so — but only here, after every hook. The guard used to sit
  // above them, which made a board that gained its first column render *more* hooks than the render
  // before (React's #310). An empty workspace makes that the ordinary case: the design arrives, and
  // the sections arrive with it.
  if (sections.length === 0) return <p className="p-3 text-meta text-slate-600">This board has no typed columns.</p>
  // An initiative may only be rearranged within its own section, and never onto the cell
  // it already sits in — so those are the only cells worth highlighting.

  /**
   * Is this initiative on the board being viewed?
   *
   * Checked against the placement rather than `initiativeCellOf`, which falls back to a
   * section's first cell when it finds no placement — so it answers "yes" for an item that is on
   * a completely different board, which is exactly the case this has to refuse.
   */
  const onViewedBoard = (id: string) =>
    graph.placements.some((p) => p.itemId === id && p.boardId === (viewedBoardId ?? boardId))

  /**
   * The card in the air has left its cell — the lift draws it, not the cell — so the lane shows
   * the result of the drop before it happens rather than after, the same as a card does.
   */
  const inCell = (cards: Item[]) => cards.filter((c) => c.id !== lift?.itemId)
  /** The drop shadow a card drag has: a recessed gap inserted where the initiative will land. */
  const withGap = (nodes: React.ReactNode[], at: number | null) => {
    if (at === null) return nodes
    const out = [...nodes]
    out.splice(
      at,
      0,
      // The card's own measurements, so the shadow is the shape that will land there — an
      // initiative carrying a parent label and a blocked row is taller than a plain card. At Mini
      // it is a tile, because that is what will land.
      <DropGap key="drop-gap" height={lift?.height} compact={detail === 'mini'} />,
    )
    return out
  }
  /** The hovered position in a cell, if the cell in flight would land there. */
  const gapAt = (cellId: string) => (previewCell && previewCell.cellId === cellId ? previewCell.index : null)

  const initiativeCard = (c: Item) => {
    const pid = model.parentOf.get(c.id)
    const p = pid ? model.itemsById.get(pid) : undefined
    const parent: CardParent | undefined = p
      ? { id: p.id, title: p.title, type: typeOf(p.typeId) }
      : undefined
    // The pick's root — the card the edge is being formed for — stays lit and ringed. Everything
    // else that is not a choice recedes: choosing a card for an initiative happens on the cards
    // workflow, and a parent must be an initiative on the board being viewed. A card's **current**
    // parent is not a choice either — naming it again changes nothing — so it recedes too.
    const pickRoot = c.id === childPickId || c.id === parentPickId
    const currentParent = parentPickId ? model.parentOf.get(parentPickId) : undefined
    const picking =
      !pickRoot &&
      (childPickId !== null ||
        (parentPickId !== null && (!onViewedBoard(c.id) || c.id === currentParent)))
    // The direct children — archived ones included, because the rollup counts them and the count
    // beside the pips has to be the same number the percentage is about. Filtering them out here
    // is what made a card with one filed-away child read "nothing below" and "1 below" at once.
    const childItems = (model.childrenOf.get(c.id) ?? [])
      .map((id) => model.itemsById.get(id))
      .filter((i): i is Item => Boolean(i))
    // Symbols summarise the direct children — team initiatives for a top-level
    // initiative, cards for a team-level one — coloured by their status.
    const symbols = childItems.map((ci) => ({ id: ci.id, bucket: model.rollup.get(ci.id)?.bucket ?? 'backlog', title: ci.title }))
    return (
      <Card
        key={c.id}
        item={c}
        type={typeOf(c.typeId)}
        detail={detail}
        parent={parent}
        wide
        users={users}
        symbols={symbols}
        // The same health rules the dashboard's Health column reads, in the same words — so an
        // initiative cannot be "at risk" in one place and quiet in another.
        flags={health.get(c.id)}
        // How far the reader is from the work decides the tone, not which surface this is: a team
        // board's own initiatives sit one level above its cards, so a blockage there is a fact
        // about this board. A coordination board is reading work several levels down and says so
        // more quietly — which is what the softer tone was always for.
        blockedTone={readBoard?.band === 'team' ? 'detail' : 'aggregate'}
        // A kind is a board's own label for its own outcomes, so it is read where the board owns
        // them — its own initiatives flow, not the bands another board's flow shows through. The
        // band is a reading; the card menu and the drawer are where it changes.
        kind={isInitiatives ? initiativeTypeById(boards, c.initiativeTypeId) : undefined}
        tags={tagsOf(boards, c)}
        selected={selectedItemId === c.id}
        dropTarget={dropTargetId === c.id}
        // `draggable` gates whether a card can be picked up at all; `onLift` is what makes the
        // picking up ours rather than the browser's. A native drag dies the moment its source
        // leaves the document, and lifting the card out of its cell is the point.
        draggable={interactive}
        onLift={interactive ? beginLift : undefined}
        locked={editMode}
        // The menu is new here: initiative cards never had one.
        onContextMenu={openCardMenu}
        onOpenDependencies={openItemDependencies}
        openDependencies={model.openDependencies.get(c.id)?.size ?? 0}
        hasDependencies={Boolean(model.dependenciesOf.get(c.id)?.length)}
        dimmed={picking}
        inert={picking}
        connectRoot={pickRoot}
        onOpen={(id) => {
          if (justDragged.current) return
          // The pick state is read when the click happens, not captured: a memoized card keeps
          // the callback it was first given, and the valid target of a parent pick is exactly a
          // card whose props do not change when the pick starts (it is not dimmed). Capturing the
          // value opened the drawer instead of forming the link.
          const { parentPickId: parentPick, childPickId: childPick } = useStore.getState()
          // Naming a card for an initiative: an initiative is not a card, so it is not a choice.
          if (childPick) return
          // While a card is waiting for a parent, an initiative click is the answer rather than
          // an open. Every card on this surface is an initiative, which is why the pick is
          // answered here and not on the cards workflow.
          if (parentPick) {
            // Only the initiatives on the board being viewed are choices. On a Program board
            // that is what keeps a band from parenting another band: the act is a team
            // initiative rolling up to a management one, and this is what makes it that.
            if (!onViewedBoard(id)) return
            setParent(parentPick, id)
            cancelParentPick()
            return
          }
          openItem(id)
        }}
        summary={{
          childCount: model.childrenOf.get(c.id)?.length ?? 0,
          blockedBelow: model.blockedBelow.get(c.id) ?? 0,
          uncommittedBelow:
            (model.rollup.get(c.id)?.bucket === 'notStarted' || model.rollup.get(c.id)?.bucket === 'inProgress')
              ? (model.rollup.get(c.id)?.uncommitted ?? 0)
              : 0,
          openDescendants: model.openDescendants.get(c.id) ?? 0,
          rollupPercent: model.rollup.get(c.id)?.percent ?? 0,
          done: model.rollup.get(c.id)?.bucket === 'done',
          checklist: checklistProgress(c),
        }}
      />
    )
  }


  return (
    <div
      ref={flowRef}
      data-workflow="initiatives"
      className="flex gap-2 p-2"
      style={lift && dragStartHeight.current !== null ? { minHeight: dragStartHeight.current } : undefined}
    >
      {lift && (
        <DragLayer html={lift.html} x={lift.x} y={lift.y} grabX={lift.grabX} grabY={lift.grabY} width={lift.width} height={lift.height} />
      )}
      {sections.map(({ section, stage, cells, byCell, held, total }) => {
        const split = cells.length > 1
        const folded = collapsedLanes[section.id] === true
        // The section's own orientation arranges its cells; 'columns' by default.
        const rows = (section.orientation ?? 'columns') === 'rows'
        return (
          <Cell
            key={section.id}
            lane={section}
            stage={stage}
            isSection
            count={total}
            sectionId={section.id}
            interactive={interactive}
            editMode={editMode}
            detail={detail}
            onAddInitiative={interactive && addsInitiatives ? addInitiativeTo : undefined}
            // A section with more cells claims more of the width, so every *cell* gets an
            // equal share of the board — splitting a column doesn't squeeze its own cells.
            style={{
              borderTopWidth: 4,
              borderTopStyle: 'solid',
              borderTopColor: STAGE_ACCENT[stage],
              // A folded section gives its width back rather than its share of it. A stacked
              // one claims a single share — its cells are its own full width already — while
              // a split column shares itself out, so either way every cell holds one share
              // of the board and splitting never squeezes the cells it made.
              ...(folded
                ? { flexGrow: 0, flexBasis: '36px', flexShrink: 0 }
                : { flexGrow: split && !rows ? cells.length : 1, flexBasis: 0, flexShrink: 1 }),
            }}
            className={cn(
              'flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200/90',
              STAGE_SURFACE[stage],
            )}
          >
            {split ? (
              // A section arranges its own cells — the same flip the lane settings write.
              // 'columns' lays the cells side by side; 'rows' stacks them full-width.
              <div className={cn('flex min-h-0 flex-1 gap-1', rows ? 'flex-col' : 'flex-row')}>
                {cells.map((cell, i) => {
                  const cards = byCell.get(cell.id) ?? []
                  return (
                    <Cell
                      key={cell.id}
                      lane={cell}
                      stage={stage}
                      sectionId={section.id}
                      count={(held.get(cell.id) ?? []).length}
                      interactive={interactive}
                      editMode={editMode}
                      detail={detail}
                      onAddInitiative={interactive && addsInitiatives ? addInitiativeTo : undefined}
                      // Stacked cells size to their content with the last one filling what
                      // is left of the section, the same as a stacked lane in the canvas.
                      className={
                        rows
                          ? cn('flex min-h-0 w-full flex-col', i === cells.length - 1 && 'grow')
                          : 'flex min-w-0 flex-1 basis-0 flex-col'
                      }
                    >
                      {withGap(inCell(cards).map(initiativeCard), gapAt(cell.id))}
                    </Cell>
                  )
                })}
              </div>
            ) : (() => {
                const cards = byCell.get(section.id) ?? []
                // The nodes themselves, not a fragment: `Cell` counts its children to know
                // whether to show the empty state, and a fragment is one child even when it
                // holds none.
                return withGap(inCell(cards).map(initiativeCard), gapAt(section.id))
              })()}
          </Cell>
        )
      })}
    </div>
  )
}

/**
 * One cell of the initiatives flow. An unsplit section's cell *is* the column, so it
 * wears the column header; a split section's cells get the lighter sub-header.
 */
function Cell({
  lane,
  stage,
  sectionId,
  isSection,
  count,
  interactive,
  editMode,
  detail,
  onAddInitiative,
  className,
  style,
  children,
}: {
  lane: Lane
  /** The section's stage — the cell's own accent, and its own even when it is a sub-cell. */
  stage?: Stage
  /** The section this cell belongs to. An initiative never leaves it. */
  sectionId: string
  isSection?: boolean
  count: number
  interactive: boolean
  editMode: boolean
  detail: BoardDetail
  /** Make a new initiative in this cell — offered only by the Backlog section. */
  onAddInitiative?: (laneId: string) => void
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const lanes = useStore((s) => s.lanes)
  const splitLane = useStore((s) => s.splitLane)
  const addLane = useStore((s) => s.addLane)
  const setLaneOrientation = useStore((s) => s.setLaneOrientation)
  const insertLaneAfter = useStore((s) => s.insertLaneAfter)
  const duplicateLane = useStore((s) => s.duplicateLane)
  const moveLane = useStore((s) => s.moveLane)
  const removeLane = useStore((s) => s.removeLane)
  const renameLane = useStore((s) => s.renameLane)
  const setLaneWip = useStore((s) => s.setLaneWip)
  const setLaneDescription = useStore((s) => s.setLaneDescription)
  const askConfirm = useStore((s) => s.askConfirm)
  const toggleCollapse = useStore((s) => s.toggleCollapse)
  const collapsedLanes = useStore((s) => s.collapsedLanes)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const editable = interactive && editMode
  const leaf = isLeaf(lanes, lane.id)
  const siblings = lane.parentId ? childrenOf(lanes, lane.parentId) : []
  const at = siblings.findIndex((l) => l.id === lane.id)
  const orientation = lane.orientation ?? 'columns'

  // One header at every depth, the same shelf the cards workflow uses: a cell of a split section
  // is a column of the section above it, not a quieter kind of label. A translucent wash gives
  // the name its own ground without becoming a card: the work below stays the brightest plane.
  const head = cn(
    HEAD_ROW,
    'mx-1 mt-1 mb-1 gap-1.5 rounded-md px-2.5 py-1.5 text-slate-700',
    isSection ? 'bg-white/60' : 'bg-white/75',
  )
  // A cell with nothing in it still needs to read as a place work can go. The drag gap counts
  // as content: while an initiative is in the air over an empty cell, the shadow is what the
  // cell shows.
  const empty = count === 0 && Children.count(children) === 0

  const removeWithConfirm = () => {
    const kids = leavesUnder(lanes, lane.id).filter((l) => l.id !== lane.id)
    const target = kids[0]
    askConfirm({
      title: `Remove ${lane.name || 'this cell'}?`,
      body: target
        ? `Its initiatives move to "${target.name}", and the cell is deleted.`
        : 'Its initiatives move to a neighbouring cell, and the cell is deleted.',
      confirmLabel: 'Remove',
      onConfirm: () => removeLane(lane.id),
    })
  }

  // A folded section is a vertical strip; a folded cell of one is horizontal, because that is
  // how it sits. Same strip as the cards workflow, and the same accent, so a folded column
  // reads as the column it is on either surface.
  if (isSection && collapsedLanes[lane.id] === true) {
    const accent = stage ? STAGE_ACCENT[stage] : undefined
    return (
      <div
        className="flex min-h-0 w-full flex-col items-center gap-2 overflow-hidden rounded-lg border border-slate-300 py-2"
        style={{
          ...style,
          ...(accent
            ? {
                backgroundColor: tintOn(accent, 0.18),
                // Longhands, not the `borderColor` shorthand: mixing a shorthand here with the
                // column's longhand top accent makes React drop the colour when the rail expands.
                borderTopColor: accent,
                borderRightColor: accent,
                borderBottomColor: accent,
                borderLeftColor: accent,
              }
            : {}),
        }}
      >
        <button
          onClick={() => toggleCollapse(lane.id)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded text-slate-700 transition hover:bg-white/70"
          title="Expand"
        >
          <ChevronsRight size={13} />
        </button>
        <span
          className="px-1 text-micro font-semibold tabular-nums text-slate-600"
          title={`${count} initiative${count === 1 ? '' : 's'}`}
        >
          {count}
        </span>
        <button onClick={() => toggleCollapse(lane.id)} className="flex min-h-0 flex-1 items-center justify-center" title="Expand">
          <span
            className="rotate-180 whitespace-nowrap text-meta font-semibold uppercase tracking-wide text-slate-600 [writing-mode:vertical-rl]"
          >
            {lane.name}
          </span>
        </button>
      </div>
    )
  }

  return (
    <div
      className={className ?? 'flex min-w-0 flex-1 basis-0 flex-col'}
      style={style}
      // A leaf marks its whole widget — header included — so pointing at a row's header bar
      // means that row. A container never marks itself: its body would answer otherwise, and
      // a container is not a place an initiative can go.
      data-cell-id={leaf ? lane.id : undefined}
      data-section-id={sectionId}
    >
      <div className={head}>
        {/* The same three slots the cards workflow uses: the fold control left, the name
            centred, the count and any edit controls right. The left slot was a spacer, which is
            what put this workflow's fold control over on the right with the editing. */}
        <span className="flex items-center gap-1">
          {isSection && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleCollapse(lane.id)
              }}
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-600 transition hover:bg-slate-200 hover:text-slate-800 pointer-coarse:h-9 pointer-coarse:w-9"
              title={collapsedLanes[lane.id] === true ? 'Expand' : 'Collapse column'}
            >
              {collapsedLanes[lane.id] === true ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
            </button>
          )}
        </span>
        {editable ? (
          // Edited where it is read, exactly as on the cards workflow: this flow has no
          // edit cluster of its own on a program board, so the name is the way in.
          <InlineEdit
            value={lane.name}
            onSave={(name) => renameLane(lane.id, name)}
            ariaLabel={`Rename ${lane.name}`}
            title="Rename this lane"
            // Bigger than its row, like the board's headers: the negative margin cancels the
            // padding, so the field is easier to hit and its text has not moved.
            className="w-full self-stretch -my-0.5 rounded py-0.5 text-center text-meta font-bold uppercase leading-tight tracking-wide text-slate-700 transition hover:bg-slate-900/5"
            inputClassName="w-full self-stretch -my-0.5 rounded bg-white px-1 py-0.5 text-center text-meta font-semibold uppercase leading-tight tracking-wide text-slate-900 outline-none ring-1 ring-inset ring-indigo-300"
          />
        ) : (
          <span className="text-center text-meta font-bold uppercase leading-tight tracking-wide">
            {lane.name}
          </span>
        )}
        <span className="flex items-center justify-end gap-1">
          <span
            className="shrink-0 rounded-full bg-white/70 px-1.5 py-0.5 font-mono text-micro font-semibold tabular-nums text-slate-600 ring-1 ring-slate-300/60"
            title={`${count} initiative${count === 1 ? '' : 's'}`}
          >
            {count}
          </span>
          {editable && (
            <CtlGroup>
              {!isSection && (
                <>
                  <LaneCtl title={orientation === 'rows' ? 'Move up' : 'Move left'} disabled={at <= 0} onClick={() => moveLane(lane.id, -1)}>
                    {orientation === 'rows' ? <ChevronUp size={12} /> : <ChevronLeft size={12} />}
                  </LaneCtl>
                  <LaneCtl
                    title={orientation === 'rows' ? 'Move down' : 'Move right'}
                    disabled={at < 0 || at >= siblings.length - 1}
                    onClick={() => moveLane(lane.id, 1)}
                  >
                    {orientation === 'rows' ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </LaneCtl>
                  <CtlDivider />
                </>
              )}
              {leaf ? (
                <>
                  <LaneCtl title="Split this cell into columns" onClick={() => splitLane(lane.id, 'columns')}>
                    <Columns3 size={12} />
                  </LaneCtl>
                  <LaneCtl title="Split this cell into rows" onClick={() => splitLane(lane.id, 'rows')}>
                    <Rows3 size={12} />
                  </LaneCtl>
                </>
              ) : (
                <>
                  <LaneCtl title={`Add a ${orientation === 'rows' ? 'row' : 'column'} to this split`} onClick={() => addLane(lane.id)}>
                    <Plus size={12} />
                  </LaneCtl>
                  {/* A section arranges its own cells, so flipping is offered here even though a
                      section is top-level: the stages are fixed, the shape they take is not. */}
                  <LaneCtl title="Flip columns ↔ rows" onClick={() => setLaneOrientation(lane.id, orientation === 'rows' ? 'columns' : 'rows')}>
                    <ArrowLeftRight size={12} />
                  </LaneCtl>
                </>
              )}
              {!isSection && (
                <>
                  <CtlDivider />
                  <LaneCtl title="Insert a new lane after this one" onClick={() => insertLaneAfter(lane.id)}>
                    <BetweenHorizontalStart size={12} />
                  </LaneCtl>
                  <LaneCtl title="Duplicate this lane and its sub-lanes" onClick={() => duplicateLane(lane.id)}>
                    <CopyPlus size={12} />
                  </LaneCtl>
                </>
              )}
              <CtlDivider />
              <LaneCtl
                btnRef={btnRef}
                active={settingsOpen}
                title="Name, WIP limit and policy"
                onClick={() => setSettingsOpen((o) => !o)}
              >
                <Settings size={12} />
              </LaneCtl>
            </CtlGroup>
          )}
        </span>
      </div>

      {/* Every cell is a drop target, and says which section it belongs to: an initiative never
          leaves its own. */}
      <div
        data-cell-id={lane.id}
        data-section-id={sectionId}
        role="region"
        aria-label={`${lanePath(lanes, lane.id).join(' / ') || lane.name || 'Cell'} — ${count} initiative${count === 1 ? '' : 's'}`}
        className={
          detail === 'mini'
            ? 'flex min-h-[96px] min-w-0 flex-1 flex-row flex-wrap content-start gap-1 p-1.5'
            : 'flex min-h-[96px] min-w-0 flex-1 flex-col gap-2 p-1.5'
        }
      >
        {empty ? (
          // Words, not another box: the column is already a place, and a dashed frame inside
          // every empty one would be the nested enclosure this surface is trying to shed.
          <div className="flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
            <Hourglass size={16} className="text-slate-400/80" />
            <span className="text-micro text-slate-600">No initiatives</span>
          </div>
        ) : (
          children
        )}
      </div>

      {onAddInitiative && !editMode && detail !== 'mini' && stage === 'backlog' && leaf ? (
        <button
          onClick={() => onAddInitiative(lane.id)}
          title={`Add initiative to ${lane.name || 'this column'}`}
          aria-label={`Add initiative to ${lane.name || 'this column'}`}
          className="mx-auto mb-1.5 flex min-h-[32px] w-fit items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 px-3 text-meta font-medium text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50/60 hover:text-indigo-600 focus-visible:border-indigo-300 focus-visible:text-indigo-600 pointer-coarse:min-h-[44px]"
        >
          <Plus size={14} strokeWidth={2} className="shrink-0" /> Initiative
        </button>
      ) : null}

      {settingsOpen && (
        <LaneSettings
          lane={lane}
          top={Boolean(isSection)}
          anchorRef={btnRef}
          onClose={() => setSettingsOpen(false)}
          rename={(name) => renameLane(lane.id, name)}
          setWip={(w) => setLaneWip(lane.id, w)}
          setPolicy={(text) => setLaneDescription(lane.id, text)}
          remove={() => {
            setSettingsOpen(false)
            removeWithConfirm()
          }}
        />
      )}
    </div>
  )
}

/** A tiny edit button. `light` for the pale sub-headers, dark otherwise. */
