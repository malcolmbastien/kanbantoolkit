import { useMemo, useRef, useState } from 'react'
import { Card, type CardParent } from './Card'
import { DragLayer } from './DragLayer'
import { DropGap } from './DropGap'
import { InlineEdit } from './InlineEdit'
import { useCardLift } from '@/lib/useCardLift'
import { parentTargetUnder } from '@/lib/dropTarget'
import { CtlDivider, CtlGroup, LaneCtl } from './LaneCtl'
import { LaneSettings } from './LaneSettings'
import {
  blockedBelow,
  checklistProgress,
  decompositionChildren,
  decompositionParent,
  dependenciesOf,
  dependentsOf,
  isComplete,
  lensRole,
  openDescendants,
  canPlaceInSection,
  rollupOf,
  statusOf,
  uncommittedBelow,
  type Graph,
} from '@/domain/derive'
import { initiativeHealth, type HealthFlagInfo } from '@/domain/health'
import { boardInitiatives, initiativeCellOf, initiativeRanks, initiativeTypeById, isInitiativeItem, tagsOf } from '@/domain/board'
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
  CopyPlus,
  Plus,
  Rows3,
  Settings,
} from 'lucide-react'
import { useStore } from '@/store'
import type { IssueType, Item, Lane, Stage } from '@/domain/types'

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
  rootsOnly,
  variant = 'team',
  interactive = false,
  onlyIds,
}: {
  boardId: string
  /** The board the person is looking at, when this is a band inside another board. */
  viewedBoardId?: string
  rootsOnly?: boolean
  variant?: 'initiatives' | 'team'
  /** Own surface: drag initiatives between cells and edit the flow. Linked bands set this false. */
  interactive?: boolean
  /**
   * Show only these initiatives — when a surface groups the same flow by something other than the
   * flow itself. A portfolio groups it by the objective each initiative serves, so each group is
   * this board's own columns narrowed to its own members.
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
  const issueTypes = useStore((s) => s.issueTypes)
  const boards = useStore((s) => s.boards)
  const kindFilter = useStore((s) => s.initiativeKindFilter)
  const setInitiativeKind = useStore((s) => s.setInitiativeKind)
  const users = useStore((s) => s.users)
  const links = useStore((s) => s.links)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const dropTargetId = useStore((s) => s.dropTargetId)
  const setDropTarget = useStore((s) => s.setDropTarget)
  const openItem = useStore((s) => s.openItem)
  const lensId = useStore((s) => s.lensId)
  const toggleLens = useStore((s) => s.toggleLens)
  const editMode = useStore((s) => s.editMode)
  const moveInitiativeToIndex = useStore((s) => s.moveInitiativeToIndex)

  const graph: Graph = { items, edges, links, placements, lanes }

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
  // the surfaces cannot disagree about what this board's initiatives are. `rootsOnly` restricts
  // to the board's *local* top-level initiatives: ones whose parent is not on this same board,
  // so an initiative can roll up to a top-level initiative on another management board and
  // still appear as top-level on its own board.
  // The group's own members, if this instance is a group. `null` is "everything", `[]` is "none".
  const only = onlyKey === null ? null : new Set(onlyKey.split(',').filter(Boolean))
  const allInitiatives = boardInitiatives(graph, boardId, issueTypes, { rootsOnly }).filter(
    (i) => only === null || only.has(i.id),
  )
  // The kind filter narrows *this board's* flow and nothing else. Not the bands — another board's
  // flow shown through this one, with its own vocabulary and its own reading — and not the cards
  // workflow, the dashboard, the timeline or the strategy map. It never moves a count either: a
  // cell's badge reads the column, as everywhere.
  const initiatives =
    variant === 'initiatives' && kindFilter ? allInitiatives.filter((i) => i.initiativeTypeId === kindFilter) : allInitiatives
  const boardKinds = boards.find((b) => b.id === boardId)?.initiativeTypes

  // A section is a typed column; its cells are its leaves — itself, until it's split.
  const sections = topLevelLanes(lanes, boardId, 'initiatives')
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((section) => {
      const stage = (section.stage ?? 'inProgress') as Stage
      const cells = leavesUnder(lanes, section.id)
      // A cell's initiatives are a rank a person orders — the same order a drop writes — so
      // they read through placements. An initiative the work below has rolled out of the cell
      // it was arranged in has no rank left to read; `initiativeRanks` decides where it reads
      // instead of dropping it, which is what this filtering used to do by hand.
      const byCell = initiativeRanks(graph, boardId, section.id, initiatives)
      // The badge reads the column, not the view: narrowing the flow changes what is *shown*, and
      // never the load the cell carries. Two walks, because the two answers differ exactly when a
      // filter is on — and only then.
      const held = initiativeRanks(graph, boardId, section.id, allInitiatives)
      const total = [...held.values()].reduce((n, rank) => n + rank.length, 0)
      return { section, stage, cells, byCell, held, total }
    })

  if (sections.length === 0) return <p className="p-3 text-meta text-slate-600">This board has no typed columns.</p>

  const isInitiatives = variant === 'initiatives'
  const collapsedLanes = useStore((s) => s.collapsedLanes)

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
  // The highlighted cell is live only while an initiative is actually in the air — the same
  // rule the cards workflow keeps. A pointercancel ends a gesture without a drop, so the
  // preview must answer to the gesture, not to whichever cell was last under the pointer.
  const previewCell = lift !== null ? dropCell : null
  /** The cell under the pointer, if it is one an initiative may move into. */
  const cellUnder = (x: number, y: number, itemId: string | undefined) => {
    const here = itemId ? initiativeCellOf(itemId, boardId, graph) : undefined
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
    let index = cards.length
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect()
      if (y < r.top + r.height / 2) {
        index = i
        break
      }
    }
    return { cellId, index }
  }
  const parentPickId = useStore((s) => s.parentPickId)
  const setParent = useStore((s) => s.setParent)
  const cancelParentPick = useStore((s) => s.cancelParentPick)
  const childPickId = useStore((s) => s.childPickId)
  const openCardMenu = useStore((s) => s.openCardMenu)
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
      // initiative carrying a parent chip and a blocked row is taller than a plain card.
      <DropGap key="drop-gap" width={lift?.width} height={lift?.height} full />,
    )
    return out
  }
  /** The hovered position in a cell, if the cell in flight would land there. */
  const gapAt = (cellId: string) => (previewCell && previewCell.cellId === cellId ? previewCell.index : null)

  const initiativeCard = (c: Item) => {
    const pid = decompositionParent(c.id, edges)
    const p = pid ? items.find((i) => i.id === pid) : undefined
    const parent: CardParent | undefined = p
      ? { id: p.id, title: p.title, type: typeOf(p.typeId) }
      : undefined
    // The direct children — archived ones included, because the rollup counts them and the count
    // beside the pips has to be the same number the percentage is about. Filtering them out here
    // is what made a card with one filed-away child read "nothing below" and "1 below" at once.
    const childItems = decompositionChildren(c.id, edges)
      .map((id) => items.find((i) => i.id === id))
      .filter((i): i is Item => Boolean(i))
    // Symbols summarise the direct children — team initiatives for a top-level
    // initiative, cards for a team-level one — coloured by their status.
    const symbols = childItems.map((ci) => ({ id: ci.id, bucket: rollupOf(ci.id, graph).bucket, title: ci.title }))
    return (
      <Card
        key={c.id}
        item={c}
        type={typeOf(c.typeId)}
        parent={parent}
        wide
        users={users}
        symbols={symbols}
        // The same health rules the dashboard's Health column reads, in the same words — so an
        // initiative cannot be "at risk" in one place and quiet in another.
        flags={health.get(c.id)}
        blockedTone={isInitiatives ? 'aggregate' : 'detail'}
        // A kind is a board's own label for its own outcomes, so it is offered where the board
        // owns them — its own initiatives flow, not the bands another board's flow shows through.
        kind={isInitiatives ? initiativeTypeById(boards, c.initiativeTypeId) : undefined}
        kinds={isInitiatives ? boardKinds : undefined}
        tags={tagsOf(boards, c)}
        onSetKind={interactive && !editMode ? (kindId) => setInitiativeKind(c.id, kindId) : undefined}
        selected={selectedItemId === c.id}
        dropTarget={dropTargetId === c.id}
        lens={lensRole(c.id, lensId, graph)}
        // Focus belongs to the board's own initiatives workflow. A Linked boards band is
        // another board's flow shown as a rollup, so its rows are read-only here — its
        // team-level initiatives don't set this board's focus. The lineage highlight still
        // crosses into the bands, which is the point of it.
        onLens={interactive ? toggleLens : undefined}
        // `draggable` gates whether a card can be picked up at all; `onLift` is what makes the
        // picking up ours rather than the browser's. A native drag dies the moment its source
        // leaves the document, and lifting the card out of its cell is the point.
        draggable={interactive}
        onLift={interactive ? startLift : undefined}
        locked={editMode}
        // The menu is new here: initiative cards never had one.
        onContextMenu={openCardMenu}
        dimmed={
          childPickId !== null ||
          // Waiting for a parent, only the initiatives on this board are choices — so on a
          // Program board the bands' initiatives dim and the board's own stay lit.
          (parentPickId !== null && !onViewedBoard(c.id))
        }
        onOpen={(id) => {
          if (justDragged.current) return
          // Naming a card for an initiative: an initiative is not a card, so it is not a choice.
          if (childPickId) return
          // While a card is waiting for a parent, an initiative click is the answer rather than
          // an open. Every card on this surface is an initiative, which is why the pick is
          // answered here and not on the cards workflow.
          if (parentPickId) {
            // Only the initiatives on the board being viewed are choices. On a Program board
            // that is what keeps a band from parenting another band: the act is a team
            // initiative rolling up to a management one, and this is what makes it that.
            if (!onViewedBoard(id)) return
            setParent(parentPickId, id)
            cancelParentPick()
            return
          }
          openItem(id)
        }}
        summary={{
          childCount: decompositionChildren(c.id, edges).length,
          dependentsCount: dependentsOf(c.id, graph).filter((d) => !statusOf(d.dependent.id, graph).resolved).length,
          linksCount: dependenciesOf(c.id, graph).length + dependentsOf(c.id, graph).length,
          blockedBelow: blockedBelow(c.id, graph),
          uncommittedBelow: uncommittedBelow(c.id, graph),
          openDescendants: openDescendants(c.id, graph).length,
          rollupPercent: rollupOf(c.id, graph).percent,
          done: isComplete(c.id, graph),
          checklist: checklistProgress(c),
        }}
      />
    )
  }


  return (
    <div className="flex gap-2 p-2">
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
            primary
            count={total}
            sectionId={section.id}
            interactive={interactive}
            editMode={editMode}
            // A section with more cells claims more of the width, so every *cell* gets an
            // equal share of the board — splitting a column doesn't squeeze its own cells.
            style={{
              borderTop: `4px solid ${STAGE_ACCENT[stage]}`,
              // A folded section gives its width back rather than its share of it. A stacked
              // one claims a single share — its cells are its own full width already — while
              // a split column shares itself out, so either way every cell holds one share
              // of the board and splitting never squeezes the cells it made.
              ...(folded
                ? { flexGrow: 0, flexBasis: '36px', flexShrink: 0 }
                : { flexGrow: split && !rows ? cells.length : 1, flexBasis: 0, flexShrink: 1 }),
            }}
            className={cn(
              'flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-300',
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
                return <>{withGap(inCell(cards).map(initiativeCard), gapAt(section.id))}</>
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
  primary,
  count,
  interactive,
  editMode,
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
  primary?: boolean
  count: number
  interactive: boolean
  editMode: boolean
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

  // The same header bar the cards workflow uses: its own ground, a margin on every side,
  // so a section and its cells are separate labels rather than a continuous band.
  const head = primary
    ? cn(HEAD_ROW, 'mx-1 mt-1 mb-0.5 gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800 shadow-sm')
    : cn(HEAD_ROW, 'mx-1 mt-0.5 mb-1 gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700 shadow-sm')

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
        style={{ ...style, ...(accent ? { backgroundColor: tintOn(accent, 0.18), borderColor: accent } : {}) }}
      >
        <button
          onClick={() => toggleCollapse(lane.id)}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-700 transition hover:bg-white/70"
          title="Expand"
        >
          <ChevronsRight size={13} />
        </button>
        <span
          className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-slate-700 px-1 text-micro font-bold tabular-nums text-white"
          title={`${count} initiative${count === 1 ? '' : 's'}`}
        >
          {count}
        </span>
        <button onClick={() => toggleCollapse(lane.id)} className="flex min-h-0 flex-1 items-center justify-center" title="Expand">
          <span
            className="rotate-180 whitespace-nowrap text-meta font-bold uppercase tracking-wide text-slate-700 [writing-mode:vertical-rl]"
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
        <span className="flex items-center">
          {isSection && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleCollapse(lane.id)
              }}
              className="grid h-4 w-4 shrink-0 place-items-center rounded text-slate-600 transition hover:bg-slate-200 hover:text-slate-800"
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
            className="w-full self-stretch -my-0.5 rounded py-0.5 text-center text-meta font-bold uppercase leading-tight tracking-wide transition hover:bg-slate-900/5"
            inputClassName="w-full self-stretch -my-0.5 rounded bg-white px-1 py-0.5 text-center text-meta font-bold uppercase leading-tight tracking-wide text-slate-900 outline-none ring-1 ring-inset ring-indigo-300"
          />
        ) : (
          <span className="text-center text-meta font-bold uppercase leading-tight tracking-wide">
            {lane.name}
          </span>
        )}
        <span className="flex items-center justify-end gap-1">
          <span className="shrink-0 rounded bg-slate-700 px-1.5 py-0.5 font-mono text-micro font-bold tabular-nums text-white">
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
                title="Lane settings — name, WIP limit, policy"
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
        className="flex min-h-[96px] min-w-0 flex-1 flex-col gap-1 p-1"
      >
        {children}
      </div>

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
