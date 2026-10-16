import { useRef, useState } from 'react'
import { Card, type CardParent } from './Card'
import { DragLayer } from './DragLayer'
import { useCardLift } from '@/lib/useCardLift'
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
  rollupOf,
  statusOf,
  uncommittedBelow,
  type Graph,
} from '@/domain/derive'
import { buildRefs, initiativeCellOf } from '@/domain/board'
import { childrenOf, isLeaf, leavesUnder, topLevelLanes } from '@/domain/lanes'
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
}: {
  boardId: string
  /** The board the person is looking at, when this is a band inside another board. */
  viewedBoardId?: string
  rootsOnly?: boolean
  variant?: 'initiatives' | 'team'
  /** Own surface: drag initiatives between cells and edit the flow. Linked bands set this false. */
  interactive?: boolean
}) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)
  const users = useStore((s) => s.users)
  const links = useStore((s) => s.links)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const openItem = useStore((s) => s.openItem)
  const lensId = useStore((s) => s.lensId)
  const toggleLens = useStore((s) => s.toggleLens)
  const editMode = useStore((s) => s.editMode)
  const moveInitiative = useStore((s) => s.moveInitiative)

  const graph: Graph = { items, edges, links, placements, lanes }
  const refs = buildRefs(items, issueTypes)
  const typeOf = (typeId: string): IssueType =>
    issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const onBoard = placements
    .filter((p) => p.boardId === boardId)
    .map((p) => items.find((i) => i.id === p.itemId))
    .filter((i): i is Item => Boolean(i))

  // Initiative-level work only — items of the Initiative type. `rootsOnly` restricts to a
  // board's *local* top-level initiatives: ones whose parent is not on this same board, so
  // an initiative can roll up to a top-level initiative on another management board and
  // still appear as top-level on its own board.
  const onBoardIds = new Set(onBoard.map((i) => i.id))
  const initiativeTypeId = issueTypes.find((t) => t.name === 'Initiative')?.id
  const initiatives = (initiativeTypeId
    ? onBoard.filter((i) => i.typeId === initiativeTypeId)
    : onBoard.filter((i) => decompositionChildren(i.id, edges).length > 0)
  ).filter((i) => !i.archived).filter((i) => {
    if (!rootsOnly) return true
    const parent = decompositionParent(i.id, edges)
    return !parent || !onBoardIds.has(parent)
  })

  // A section is a typed column; its cells are its leaves — itself, until it's split.
  const sections = topLevelLanes(lanes, boardId, 'initiatives')
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((section) => {
      const stage = (section.stage ?? 'inProgress') as Stage
      const cells = leavesUnder(lanes, section.id)
      const inSection = initiatives.filter((i) => initiativeCellOf(i.id, boardId, graph)?.sectionId === section.id)
      const byCell = new Map<string, Item[]>(cells.map((c) => [c.id, []]))
      for (const i of inSection) {
        const cellId = initiativeCellOf(i.id, boardId, graph)?.cellId
        if (cellId && byCell.has(cellId)) byCell.get(cellId)!.push(i)
      }
      return { section, stage, cells, byCell, total: inSection.length }
    })

  if (sections.length === 0) return <p className="p-3 text-meta text-slate-600">This board has no typed columns.</p>

  const isInitiatives = variant === 'initiatives'
  const collapsedLanes = useStore((s) => s.collapsedLanes)

  /** The initiative currently in flight, if any. */
  // The same lift the cards workflow uses — one implementation, so a card in the air behaves
  // the same on either surface. Where it lands is this surface's own: a cell, and only a cell of
  // the section the initiative already belongs to.
  const { lift, start: startLift, justDragged } = useCardLift({
    onMove: (x, y) => setDropCell(cellUnder(x, y, lift?.itemId)),
    onDrop: (itemId, x, y) => {
      const cell = cellUnder(x, y, itemId)
      if (cell) moveInitiative(itemId, boardId, cell)
    },
  })
  const [dropCell, setDropCell] = useState<string | null>(null)
  /** The cell under the pointer, if it is one an initiative may move into. */
  const cellUnder = (x: number, y: number, itemId: string | undefined) => {
    const here = itemId ? initiativeCellOf(itemId, boardId, graph) : undefined
    if (!here) return null
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cell-id]')
    const cellId = cell?.dataset.cellId
    const sectionId = cell?.dataset.sectionId
    // An initiative may only be rearranged within its own section, and never onto the cell it
    // already sits in — so those are the only cells worth highlighting.
    if (!cellId || sectionId !== here.sectionId || cellId === here.cellId) return null
    return cellId
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

  const initiativeCard = (c: Item) => {
    const pid = decompositionParent(c.id, edges)
    const p = pid ? items.find((i) => i.id === pid) : undefined
    const parent: CardParent | undefined = p
      ? { id: p.id, ref_: refs.get(p.id) ?? '', title: p.title, type: typeOf(p.typeId) }
      : undefined
    const childItems = decompositionChildren(c.id, edges)
      .map((id) => items.find((i) => i.id === id))
      .filter((i): i is Item => Boolean(i))
      .filter((i) => !i.archived)
    // Symbols summarise the direct children — team initiatives for a top-level
    // initiative, cards for a team-level one — coloured by their status.
    const symbols = childItems.map((ci) => ({ bucket: rollupOf(ci.id, graph).bucket, title: ci.title }))
    return (
      <Card
        key={c.id}
        item={c}
        type={typeOf(c.typeId)}
        ref_={refs.get(c.id) ?? ''}
        parent={parent}
        wide
        users={users}
        symbols={symbols}
        blockedTone={isInitiatives ? 'aggregate' : 'detail'}
        selected={selectedItemId === c.id}
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
      {sections.map(({ section, stage, cells, byCell, total }) => {
        const split = cells.length > 1
        const folded = collapsedLanes[section.id] === true
        return (
          <Cell
            key={section.id}
            lane={section}
            stage={stage}
            isSection
            primary
            count={total}
            sectionId={section.id}
            isTarget={dropCell === section.id}
            interactive={interactive}
            editMode={editMode}
            // A section with more cells claims more of the width, so every *cell* gets an
            // equal share of the board — splitting a column doesn't squeeze its own cells.
            style={{
              borderTop: `4px solid ${STAGE_ACCENT[stage]}`,
              // A folded section gives its width back rather than its share of it.
              ...(folded ? { flexGrow: 0, flexBasis: '36px', flexShrink: 0 } : { flexGrow: cells.length, flexBasis: 0, flexShrink: 1 }),
            }}
            className={cn(
              'flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-300',
              STAGE_SURFACE[stage],
            )}
          >
            {split
              ? cells.map((cell) => {
                  const cards = byCell.get(cell.id) ?? []
                  return (
                    <Cell
                      key={cell.id}
                      lane={cell}
                      stage={stage}
                      sectionId={section.id}
                      count={cards.length}
                      isTarget={dropCell === cell.id}
                      interactive={interactive}
                      editMode={editMode}
                    >
                      {inCell(cards).map(initiativeCard)}
                    </Cell>
                  )
                })
              : (() => {
                  const cards = byCell.get(section.id) ?? []
                  return (
                    <>
                      {inCell(cards).map(initiativeCard)}
                    </>
                  )
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
  isTarget,
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
  /** Whether the initiative in flight would land here. */
  isTarget?: boolean
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
    <div className={className ?? 'flex min-w-0 flex-1 basis-0 flex-col'} style={style}>
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
        <span className="text-center text-meta font-bold uppercase leading-tight tracking-wide">
          {lane.name}
        </span>
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
        className="flex min-h-[96px] min-w-0 flex-1 flex-col gap-1 p-1"
      >
        {isTarget && (
          <div
            data-drop-placeholder
            className="h-[68px] shrink-0 rounded-md bg-slate-900/[0.08] ring-1 ring-inset ring-slate-900/10"
          />
        )}
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
