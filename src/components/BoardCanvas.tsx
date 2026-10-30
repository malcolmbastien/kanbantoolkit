import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronsRight,
  Plus,
} from 'lucide-react'
import { focusBoundary } from './BoundaryWorkflow'
import { Card, type CardParent } from './Card'
import { LaneEditControls } from './LaneCtl'
import { DragLayer } from './DragLayer'
import { InlineEdit } from './InlineEdit'
import { useCardLift } from '@/lib/useCardLift'
import { parentTargetUnder } from '@/lib/dropTarget'
import { DropColumn } from './DropColumn'
import { LanePolicy, LaneSettings } from './LaneSettings'
import {
  blockedBelow,
  checklistProgress,
  decompositionChildren,
  decompositionParent,
  dependentsOf,
  isComplete,
  lensRole,
  openDescendants,
  rollupOf,
  statusOf,
  waitsOn,
  type Graph,
} from '@/domain/derive'
import { boardCardTypeId, tagsOf } from '@/domain/board'
import { externalWaits } from '@/domain/boundary'
import { childrenOf, effectiveStage, isTopLevel, laneDepth, laneHoldsCards, rootLane, subtreeIds, wipState } from '@/domain/lanes'
import { ageDays, initiativeScope, matchesFilters, type CardFilters } from '@/domain/filters'
import { STAGE_ACCENT, STAGE_PILL, STAGE_SURFACE, tintOn, WIP_PILL } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { usePanScroll } from '@/lib/usePanScroll'
import type { Board, IssueType, Item, Lane, User } from '@/domain/types'
import type { ConfirmRequest } from '@/store'


export interface BoardCanvasProps {
  boardId: string
  /**
   * The cards flow this canvas draws. Required: a board may carry several, and a canvas that
   * picked one for itself would hide the rest behind a default nobody chose.
   */
  flowId: string
  /** Read-only bands (management view) set this false. */
  interactive: boolean
  /**
   * The move seam: a change of lane goes through it, so a board's WIP policy can intercept. It
   * answers whether the card is now in that lane — `false` when the policy refused the move or
   * held it for a reason — and a caller with a position to write must then write nothing.
   * `index` is the place the gesture offered, for a policy that holds the move.
   */
  onMove?: (itemId: string, boardId: string, laneId: string, index?: number) => boolean
}

interface Ctx {
  lanes: Lane[]
  items: Item[]
  issueTypes: IssueType[]
  graph: Graph
  /** The people directory (to resolve card assignees). */
  users: User[]
  /** The boards, to resolve a card's tags wherever they are defined. */
  boards: Board[]
  editMode: boolean
  filters: CardFilters
  /** External dependency (the boundary workflow) whose local dependents are highlighted. */
  boundaryId: string | null
  /** Select a boundary card from a dependent's chip, and take the reader to it. */
  onBoundary: (dependencyId: string, title: string) => void
  /** Multi-select group (shift+click). */
  multiSelect: string[]
  toggleMultiSelect: (id: string) => void
  askConfirm: (request: ConfirmRequest) => void
  selectedItemId: string | null
  /** Cards to render. */
  boardItems: Item[]
  /** The board being read — needed for the boundary links, which are about the edge of *this* board. */
  boardId: string
  /** The focused item, for the lineage highlight. */
  lensId: string | null
  /** The card waiting for a parent, if any. See `startParentPick`. */
  parentPickId: string | null
  effectiveLane: Map<string, string>
  /** How long a card has sat in its lane, when the placement knows. See `ageDays`. */
  ageOf: (itemId: string) => number | undefined
  /** The ids an initiative filter narrows to, when one is active. See `initiativeScope`. */
  initiativeScope: ReadonlySet<string> | undefined
  interactive: boolean
  /**
   * The card in the air and the one gap it would land in. A lane has a single insertion
   * point rather than a target per card, so the lane never lights up as a second target.
   */
  drag: {
    itemId: string | null
    laneId: string | null
    index: number | null
    /** The lifted card's height, so the gap it leaves is the card's own shape. Its width is the
      lane's: a card fills the lane it lands in. */
    height: number | null
    /** The initiative the card in the air would become a child of, if one is under the pointer. */
    dropTargetId: string | null
    /** Begin a lift from a press on a card. */
    start: (e: React.PointerEvent, itemId: string) => void
  }
  /** Open a card's panel — unless the press that led here was a drag. */
  openCard: (itemId: string) => void
  openItem: (id: string) => void
  splitLane: (laneId: string, orientation: 'columns' | 'rows', count?: number) => void
  addLane: (parentId: string) => void
  insertLaneAfter: (laneId: string) => void
  duplicateLane: (laneId: string) => void
  toggleCollapse: (laneId: string) => void
  collapsedLanes: Record<string, boolean>
  moveLane: (laneId: string, delta: number) => void
  setLaneOrientation: (laneId: string, orientation: 'columns' | 'rows') => void
  setLaneWip: (laneId: string, wipLimit: number | undefined) => void
  setLaneDescription: (laneId: string, description: string | undefined) => void
  removeLane: (laneId: string) => void
  renameLane: (laneId: string, name: string) => void
  onAddCard: (laneId: string) => void
  /** Open the card context menu at a viewport position. */
  openCardMenu: (itemId: string, x: number, y: number) => void
}


/**
 * A lane header row: the name truly centred, with the edge controls pinned left and right.
 * The side columns are `1fr` each and the middle sizes to the name, so the centring holds
 * whether or not a lane has a collapse control, a WIP count or a policy icon.
 */
const HEAD_ROW = 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1'

function LaneBox({ lane, ctx, isRoot, hideHeader }: { lane: Lane; ctx: Ctx; isRoot: boolean; hideHeader?: boolean }) {
  const { lanes, items, issueTypes, graph, editMode, boardItems, effectiveLane } = ctx
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)
  const kids = childrenOf(lanes, lane.id)
  const top = isTopLevel(lanes, lane.id)
  const stage = lane.stage ?? effectiveStage(lanes, lane.id)
  const parent = lane.parentId ? lanes.find((l) => l.id === lane.parentId) : undefined
  const siblings = lane.parentId ? childrenOf(lanes, lane.parentId) : []
  const sibIdx = siblings.findIndex((s) => s.id === lane.id)
  const canMovePrev = sibIdx > 0
  const canMoveNext = sibIdx >= 0 && sibIdx < siblings.length - 1
  const parentOrientation = parent?.orientation ?? 'columns'
  // A top-level column folds away, and so does a row of a rows-split — the shape where one lane
  // spans the whole width, so folding it gives the other rows their space back. Not a cell of a
  // columns-split: those share the width they have, and folding one would be folding a column
  // the board has already divided. And never the board itself, which would leave nothing.
  const canCollapse = !isRoot && (top || parentOrientation === 'rows')
  const collapsed = ctx.collapsedLanes[lane.id] === true && canCollapse
  const typeOf = (typeId: string): IssueType =>
    issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const countInLane = (laneId: string) => {
    const ids = new Set(subtreeIds(lanes, laneId))
    return boardItems.filter((i) => {
      const lid = effectiveLane.get(i.id)
      return lid !== undefined && ids.has(lid)
    }).length
  }
  const wip = wipState(countInLane(lane.id), lane.wipLimit)

  // One lane, one item of the tree: its own path, its own count, and the level its nesting puts
  // it at. The label is the sentence a screen reader reads on arrival.
  // The level is the tree's own fact. No name: a lane contains the cards, and a container whose
  // visible text is not in its accessible name is a contradiction — the nesting and the header
  // inside it say what it is.
  const level = laneDepth(lanes, lane.id) + 1

  // A cards lane is removed only when it holds no card — deletion never moves work. The refusal is
  // said on the control, not discovered after the confirmation.
  const holdsCards = laneHoldsCards(lanes, graph.placements, lane.id)
  const canRemove = !holdsCards
  // Confirm before removing a lane that carries sub-lanes; a lane with cards is not offered.
  const removeWithConfirm = () => {
    if (!canRemove) return
    const parts: string[] = []
    if (kids.length > 0) parts.push(`${kids.length} sub-lane${kids.length === 1 ? '' : 's'} removed`)
    ctx.askConfirm({
      title: `Remove "${lane.name || 'lane'}"?`,
      body: parts.length ? `${parts.join('; ')}.` : undefined,
      confirmLabel: 'Remove lane',
      danger: true,
      onConfirm: () => ctx.removeLane(lane.id),
    })
  }

  const header = (isLeafCell: boolean) => {
    // One header, at every depth: a white bar with its own margin and a soft edge. A nested
    // cell is a column of the column above it, and it should read as the same kind of thing —
    // the depth is carried by where it sits, not by a lighter header.
    const over = wip === 'over'
    const at = wip === 'at'
    const count = countInLane(lane.id)
    const pill = over ? WIP_PILL.over : at ? WIP_PILL.at : stage ? STAGE_PILL[stage] : 'bg-slate-200/80 text-slate-700 ring-1 ring-slate-300/70'
    return (
      <div
        className={cn(
          'mx-1 mt-1 mb-0.5 rounded-lg border px-2.5 py-1.5 shadow-sm',
          collapsed
            ? // A collapsed row says so in its own right: a dashed edge and a muted ground, so
              // it reads as folded away rather than as a row that happens to be short.
              'border-dashed border-slate-300 bg-slate-100/80 text-slate-500 shadow-none'
            : over
              ? 'border-rose-200 bg-white text-slate-800'
              : at
                ? 'border-amber-200 bg-white text-slate-800'
                : 'border-slate-200/90 bg-white text-slate-800',
        )}
      >
        {/* Name truly centred, count and policy pinned right. The side columns are equal
            (1fr each) and the middle sizes to the name, so the centring holds whatever
            the lane's depth and whether the edge controls are present at all. */}
        <div className={HEAD_ROW}>
          <span className="flex items-center gap-1">
            {canCollapse ? (
              <button
                onClick={(e) => { e.stopPropagation(); ctx.toggleCollapse(lane.id) }}
                className="grid h-4 w-4 shrink-0 place-items-center rounded text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
                title={collapsed ? 'Expand' : `Collapse ${parentOrientation === 'columns' ? 'column' : 'row'}`}
              >
                {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              </button>
            ) : null}
          </span>
          {/* The name is the lane's own, so in edit mode it is edited where it is read —
              no trip to the settings popover to type a word. Out of edit mode it is a
              label like any other: the board is for working, not for designing. */}
          {editMode && !isRoot ? (
            <InlineEdit
              value={lane.name}
              onSave={(name) => ctx.renameLane(lane.id, name)}
              ariaLabel={`Rename ${lane.name || 'this lane'}`}
              title="Rename this lane"
              // The name fills its row and reaches a little past it: a 15px line of text is a
              // mean thing to ask anyone to hit. The negative margin cancels the padding
              // exactly, so the field is big to point at and its text has not moved a pixel.
              // A ring, not a border, for the same reason — the header bar and everything
              // under it must not shift the moment a name is clicked.
              className="w-full self-stretch -my-0.5 rounded py-0.5 text-center text-meta font-bold uppercase leading-tight tracking-wide transition hover:bg-slate-900/5"
              inputClassName="w-full self-stretch -my-0.5 rounded bg-white px-1 py-0.5 text-center text-meta font-bold uppercase leading-tight tracking-wide text-slate-900 outline-none ring-1 ring-inset ring-indigo-300"
            />
          ) : (
            <span className="text-center text-meta font-bold uppercase leading-tight tracking-wide">
              {lane.name || 'Board'}
            </span>
          )}
          <span className="flex items-center justify-end gap-1">
            {over && <AlertTriangle size={12} className="shrink-0 text-rose-600" aria-label="Over its WIP limit" />}
            {at && <AlertTriangle size={12} className="shrink-0 text-amber-600" aria-label="At its WIP limit" />}
            <span
              className={cn('shrink-0 rounded-full px-1.5 py-0.5 font-mono text-micro font-bold tabular-nums', pill)}
              title={
                over
                  ? `Over its WIP limit — ${count} card${count === 1 ? '' : 's'}, limit ${lane.wipLimit}`
                  : at
                    ? `At its WIP limit — ${count} card${count === 1 ? '' : 's'}`
                    : `${count} card${count === 1 ? '' : 's'}${lane.wipLimit !== undefined ? ` of ${lane.wipLimit}` : ''}`
              }
            >
              {count}
              {lane.wipLimit !== undefined ? `/${lane.wipLimit}` : ''}
            </span>
            {lane.description && <LanePolicy policy={lane.description} />}
          </span>
        </div>

        {editMode && !isRoot && (
          <div className="mt-1 flex w-0 min-w-full flex-wrap items-center gap-1.5" style={{ contain: 'inline-size' }}>
            {/* The same control component the template editor uses — one cluster, one rulebook. */}
            <LaneEditControls
              isLeafCell={isLeafCell}
              top={top}
              orientation={lane.orientation}
              horizontal={parentOrientation !== 'rows'}
              canMovePrev={canMovePrev}
              canMoveNext={canMoveNext}
              onMove={(d) => ctx.moveLane(lane.id, d)}
              onSplit={(o) => ctx.splitLane(lane.id, o)}
              onAdd={() => ctx.addLane(lane.id)}
              onFlip={() => ctx.setLaneOrientation(lane.id, (lane.orientation ?? 'columns') === 'rows' ? 'columns' : 'rows')}
              onInsert={() => ctx.insertLaneAfter(lane.id)}
              onDuplicate={() => ctx.duplicateLane(lane.id)}
              onSettings={() => setSettingsOpen((o) => !o)}
              settingsActive={settingsOpen}
              settingsBtnRef={settingsBtnRef}
            />
          </div>
        )}
        {settingsOpen && (
          <LaneSettings
            lane={lane}
            top={top}
            anchorRef={settingsBtnRef}
            onClose={() => setSettingsOpen(false)}
            rename={(name) => ctx.renameLane(lane.id, name)}
            setWip={(w) => ctx.setLaneWip(lane.id, w)}
            setPolicy={(text) => ctx.setLaneDescription(lane.id, text)}
            remove={() => {
              setSettingsOpen(false)
              removeWithConfirm()
            }}
            canRemove={canRemove}
            removeReason="This lane holds cards — move them out first"
          />
        )}
      </div>
    )
  }

  // A folded top-level column becomes a strip, because it has to fit in a row of columns and a
  // strip is what a column looks like when it has no width. It wears the column's own accent, so
  // a folded column is identifiable from across the board without being read — the point of
  // folding it rather than deleting it: it is still there, and still this column.
  //
  // A folded *row* is a different thing and gets a different answer: it already has a
  // horizontal header, so folding it means hiding what is under that header. Drawing a strip
  // instead would give one row a header that looks nothing like the rows beside it.
  if (collapsed && top) {
    const accent = stage ? STAGE_ACCENT[stage] : undefined
    const count = countInLane(lane.id)
    return (
      <div
        role="treeitem"
        aria-level={level}
        aria-expanded={false}
        className="flex h-full min-h-0 w-full flex-col items-center gap-2 overflow-hidden rounded-lg border border-slate-300 py-2"
        style={accent ? { backgroundColor: tintOn(accent, 0.18), borderColor: accent } : undefined}
      >
        <button
          onClick={() => ctx.toggleCollapse(lane.id)}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-700 transition hover:bg-white/70"
          title="Expand"
        >
          <ChevronsRight size={13} />
        </button>
        <span
          className={cn(
            'grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 text-micro font-bold tabular-nums',
            wip === 'over' ? WIP_PILL.over : wip === 'at' ? WIP_PILL.at : 'bg-white/80 text-slate-700 ring-1 ring-slate-300/70',
          )}
          title={`${count} card${count === 1 ? '' : 's'}${wip === 'over' ? ' — over its limit' : wip === 'at' ? ' — at its limit' : ''}`}
        >
          {count}
        </span>
        <button onClick={() => ctx.toggleCollapse(lane.id)} className="flex min-h-0 flex-1 items-center justify-center" title="Expand">
          <span className="rotate-180 whitespace-nowrap text-meta font-bold uppercase tracking-wide text-slate-700 [writing-mode:vertical-rl]">
            {lane.name}
          </span>
        </button>
      </div>
    )
  }

  if (kids.length > 0) {
    const orientation = lane.orientation ?? 'columns'
    const stacked = orientation === 'rows'

    // Columns-of-rows (leanKit swimlanes): render one shared grid so lanes span the
    // columns and every cell in a lane stretches to the lane's height.
    const transposable =
      orientation === 'columns' &&
      kids.length >= 2 &&
      kids.every((k) => (k.orientation ?? 'columns') === 'rows' && childrenOf(lanes, k.id).length > 0)
    if (transposable && !collapsed) return <SwimlaneBoard lane={lane} columns={kids} ctx={ctx} isRoot={isRoot} />

    return (
      <div
        role="treeitem"
        aria-level={level}
        aria-expanded={!collapsed}
        className={cn(
          'flex h-full min-h-0 w-full flex-1 flex-col',
          // No outer box: each top-level column is its own card, with a gap between them.
          // The stage tints the whole column, so it reads at a glance without a label.
          top && 'overflow-hidden rounded-xl border border-slate-300/80 shadow-sm',
          top && stage && STAGE_SURFACE[stage],
        )}
        style={top && stage ? { borderTop: `4px solid ${STAGE_ACCENT[stage]}` } : undefined}
      >
        {/* The root of the cards workflow is the board's whole flow, not a lane: its name is
            already the section's, and its count is the section's too. A header here would be a
            second title over the columns. */}
        {!hideHeader && !isRoot && (editMode || lane.name) && header(false)}
        {!collapsed && (
        <div
            role="group"
            className={cn(
              'flex w-full flex-1 min-h-0',
              // Stacked rows get a gap; a nested columns split is divided by one hairline.
              // The split used to be a heavier rule, with a white header box inside each
              // cell — two frames for one partition, which is what made a cell look like a
              // board of its own.
              stacked ? 'flex-col gap-2' : cn('grid', isRoot ? 'gap-3' : 'divide-x divide-slate-300/70'),
            )}
            style={
              orientation === 'columns'
                ? isRoot
                  ? { gridTemplateColumns: kids.map((k) => (ctx.collapsedLanes[k.id] ? '36px' : 'minmax(min-content, 1fr)')).join(' ') }
                  : { gridAutoFlow: 'column', gridAutoColumns: 'minmax(min-content, 1fr)' }
                : undefined
            }
          >
            {kids.map((k, i) => (
              <div
                key={k.id}
                className={cn(
                  'flex min-h-0 min-w-0 flex-col',
                  // Rows size to their content (+ buffer); only the last row stretches
                  // to fill the column's remaining height.
                  stacked
                    // A folded row is its header and no more — no height of its own, and no
                    // margin of its own either: the header already carries the spacing that
                    // separates it from the rows beside it, and adding to that is what made it
                    // stand out as different.
                    ? cn('w-full', ctx.collapsedLanes[k.id] ? 'shrink-0' : i === kids.length - 1 && 'grow')
                    : cn('flex-1', isRoot && 'overflow-hidden rounded-xl'),
                )}
              >
                <LaneBox lane={k} ctx={ctx} isRoot={false} />
              </div>
            ))}
        </div>
        )}
      </div>
    )
  }

  // Every narrowing here reads the filter panel — including its text criterion. The
  // top-bar search is a cross-board finder; it no longer also filters these columns,
  // and a deep-linked ?q= lands in the text filter instead (see App).
  const cards = boardItems
    .filter((i) => effectiveLane.get(i.id) === lane.id)
    .filter((i) => matchesFilters(i, ctx.filters, statusOf(i.id, graph).resolved, Date.now(), ctx.ageOf(i.id), ctx.initiativeScope))

  return (
    <div
      // A cell is an item of the tree: a screen reader announces "In Progress / Dev, 2 cards" and
      // the cards inside it are its contents, rather than one undifferentiated board. `data-lane-cell`
      // marks it as a cell for the tests — the tree nests, so a role alone cannot say which.
      role="treeitem"
      data-lane-cell
      aria-level={level}
      className={cn(
        'flex h-full min-h-0 w-full min-w-[196px] flex-1 flex-col',
        // A top-level column is the object: one edge, one tint, one accent. A nested cell
        // sits on its section's tint and needs none of the three — the partition line is
        // enough, and a second frame is what made a cell look like a box inside a box.
        top && 'overflow-hidden rounded-xl border border-slate-300/80 shadow-sm',
        top ? (stage ? STAGE_SURFACE[stage] : 'bg-slate-100') : '',
      )}
      style={top && stage ? { borderTop: `4px solid ${STAGE_ACCENT[stage]}` } : undefined}
    >
      {!hideHeader && header(true)}
      <DropColumn
        laneId={lane.id}
        draggingId={ctx.drag.itemId}
        draggingHeight={ctx.drag.height}
        at={ctx.drag.laneId === lane.id ? ctx.drag.index : null}
        items={cards.map((c) => {
          const pid = decompositionParent(c.id, graph.edges)
          const p = pid ? items.find((i) => i.id === pid) : undefined
          const parent: CardParent | undefined = p ? { id: p.id, title: p.title, type: typeOf(p.typeId) } : undefined
          const roll = rollupOf(c.id, graph)
          return {
            id: c.id,
            node: (
            <Card
              key={c.id}
              item={c}
              type={typeOf(c.typeId)}
              parent={parent}
              selected={ctx.selectedItemId === c.id}
              dropTarget={ctx.drag.dropTargetId === c.id}
              boundary={ctx.boundaryId ? waitsOn(c.id, ctx.boundaryId, graph) : false}
              waitingOn={externalWaits(c.id, graph, ctx.boardId).map((wait) => ({ id: wait.dependency.id, title: wait.dependency.title }))}
              onBoundary={ctx.onBoundary}
              multi={ctx.multiSelect.includes(c.id)}
              dimmed={
                (ctx.multiSelect.length > 0 && !ctx.multiSelect.includes(c.id)) ||
                // A selected boundary card is the thing being read: everything that does not wait
                // on it recedes, so the relationship is visible across the whole board.
                (ctx.boundaryId !== null && !waitsOn(c.id, ctx.boundaryId, graph)) ||
                // Waiting for a parent, only the initiatives are choices.
                (ctx.parentPickId !== null && typeOf(c.typeId).name !== 'Initiative')
              }
              users={ctx.users}
              onMultiSelect={ctx.toggleMultiSelect}
              onContextMenu={ctx.openCardMenu}
              onLift={ctx.drag.start}
              lens={lensRole(c.id, ctx.lensId, graph)}
              draggable={ctx.interactive && !ctx.editMode}
              locked={ctx.editMode}
              onOpen={ctx.openCard}
              tags={tagsOf(ctx.boards, c)}
              summary={{
                childCount: decompositionChildren(c.id, graph.edges).length,
                dependentsCount: dependentsOf(c.id, graph).filter((d) => !statusOf(d.dependent.id, graph).resolved).length,
                blockedBelow: blockedBelow(c.id, graph),
                openDescendants: openDescendants(c.id, graph).length,
                rollupPercent: decompositionChildren(c.id, graph.edges).length > 0 ? roll.percent : undefined,
                done: isComplete(c.id, graph),
                // Backlog is uncommitted inventory and legitimately rests, so it is not aged.
                ageDays: ctx.effectiveLane.get(c.id) && effectiveStage(lanes, ctx.effectiveLane.get(c.id)!) !== 'backlog' ? ctx.ageOf(c.id) : undefined,
                checklist: checklistProgress(c),
              }}
            />
            ),
          }
        })}
        footer={
          ctx.interactive && !ctx.editMode ? (
            /* The way to make work in this column, and the largest target in it: a full-width
               dashed block rather than a hairline of text, because "add a card here" is the one
               thing a reader does to a lane that has nothing in it. */
            <button
              onClick={() => ctx.onAddCard(lane.id)}
              title={`Add card to ${lane.name || 'this column'}`}
              aria-label={`Add card to ${lane.name || 'this column'}`}
              className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white text-meta font-semibold text-slate-800 transition hover:border-indigo-400 hover:bg-indigo-50/60 hover:text-indigo-700 pointer-coarse:min-h-[48px]"
            >
              <Plus size={16} strokeWidth={2.5} className="shrink-0" /> Add card
            </button>
          ) : null
        }
      />
    </div>
  )
}

function countInLane(laneId: string, ctx: Ctx): number {
  const ids = new Set(subtreeIds(ctx.lanes, laneId))
  return ctx.boardItems.filter((i) => {
    const lid = ctx.effectiveLane.get(i.id)
    return lid !== undefined && ids.has(lid)
  }).length
}

/** columns × lanes grid: lanes span the columns; cells in a lane share its height. */
function SwimlaneBoard({ lane, columns, ctx, isRoot }: { lane: Lane; columns: Lane[]; ctx: Ctx; isRoot: boolean }) {
  const { lanes, editMode } = ctx
  const rowNames: string[] = []
  for (const col of columns) {
    for (const r of childrenOf(lanes, col.id)) if (!rowNames.includes(r.name)) rowNames.push(r.name)
  }

  return (
    <div
      role="treeitem"
      aria-level={laneDepth(lanes, lane.id) + 1}
      aria-expanded
      className="flex min-h-0 w-full flex-1 flex-col"
    >
      {(editMode || lane.name) && (
        <div className="border-b border-slate-300 bg-slate-100 px-2.5 py-1.5 text-center text-slate-800">
          {/* This band is the only header a transposed container gets — its lane tree is
              rendered as a grid, so no other header carries its name. The board's own band
              stays a label, as everywhere else: its identity is the board, not a lane. */}
          {editMode && !isRoot ? (
            <InlineEdit
              value={lane.name}
              onSave={(name) => ctx.renameLane(lane.id, name)}
              ariaLabel={`Rename ${lane.name || 'this lane'}`}
              title="Rename this lane"
              className="w-full -my-1 rounded py-1 text-center text-meta font-bold uppercase tracking-wide transition hover:bg-slate-900/5"
              inputClassName="w-full -my-1 rounded bg-white px-1 py-1 text-center text-meta font-bold uppercase tracking-wide text-slate-900 outline-none ring-1 ring-inset ring-indigo-300"
            />
          ) : (
            <span className="text-meta font-bold uppercase tracking-wide">{lane.name || 'Board'}</span>
          )}
        </div>
      )}
      <div
        role="group"
        className="grid w-full flex-1 min-h-0"
        style={{ gridTemplateColumns: `160px repeat(${columns.length}, minmax(min-content, 1fr))` }}
      >
        {/* column headers */}
        <div />
        {columns.map((col) => (
          <div key={col.id} className={cn(HEAD_ROW, 'gap-1.5 border-b border-slate-300 bg-slate-100 px-2.5 py-1.5 text-slate-800')}>
            <span />
            {editMode ? (
              <InlineEdit
                value={col.name}
                onSave={(name) => ctx.renameLane(col.id, name)}
                ariaLabel={`Rename ${col.name}`}
                title="Rename this lane"
                className="w-full self-stretch -my-0.5 rounded py-0.5 text-center text-meta font-bold uppercase leading-tight tracking-wide transition hover:bg-slate-900/5"
                inputClassName="w-full self-stretch -my-0.5 rounded bg-white px-1 py-0.5 text-center text-meta font-bold uppercase leading-tight tracking-wide text-slate-900 outline-none ring-1 ring-inset ring-indigo-300"
              />
            ) : (
              <span className="text-center text-meta font-bold uppercase leading-tight tracking-wide">{col.name}</span>
            )}
            <span className="flex justify-end">
              <span className="rounded bg-slate-700 px-1.5 py-0.5 font-mono text-micro font-bold tabular-nums text-white">
                {countInLane(col.id, ctx)}
              </span>
            </span>
          </div>
        ))}

        {/* lane rows */}
        {rowNames.map((name) => {
          const railCount = columns.reduce((sum, col) => {
            const cell = childrenOf(lanes, col.id).find((r) => r.name === name)
            return sum + (cell ? countInLane(cell.id, ctx) : 0)
          }, 0)
          return (
            <Fragment key={name}>
              <div className="flex flex-col items-center justify-start rounded-lg border border-slate-300 bg-slate-100 px-2 py-2 text-center text-slate-700">
                <span className="text-meta font-bold">{name}</span>
                <span className="mt-1 w-fit rounded bg-slate-700 px-1.5 py-px text-micro font-bold text-white">{railCount}</span>
              </div>
              {columns.map((col) => {
                const cell = childrenOf(lanes, col.id).find((r) => r.name === name)
                return (
                  <div key={col.id + name} className="flex min-h-[64px] w-full flex-col">
                    {cell ? (
                      <LaneBox lane={cell} ctx={ctx} isRoot={false} hideHeader />
                    ) : (
                      <div className="flex-1 rounded-md border border-dashed border-slate-300/60 bg-slate-100/40" />
                    )}
                  </div>
                )
              })}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The card in the air. Carried in state rather than in a `dataTransfer`, because the board
 * draws the lifted card itself and a pointer drag has no `dataTransfer` to read from.
 */

export function BoardCanvas({ boardId, flowId, interactive, onMove }: BoardCanvasProps) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const flows = useStore((s) => s.flows)
  const boards = useStore((s) => s.boards)
  const issueTypes = useStore((s) => s.issueTypes)
  const users = useStore((s) => s.users)
  const filters = useStore((s) => s.filters)
  const boundaryId = useStore((s) => s.boundaryId)
  const toggleBoundary = useStore((s) => s.toggleBoundary)
  // From this end, selecting never toggles off: the chip is a link to the boundary card, and a
  // second press should take you there again rather than put the light out.
  const onBoundary = (dependencyId: string, title: string) => {
    if (boundaryId !== dependencyId) toggleBoundary(dependencyId)
    focusBoundary(dependencyId, title)
  }
  const multiSelect = useStore((s) => s.multiSelect)
  const toggleMultiSelect = useStore((s) => s.toggleMultiSelect)
  const askConfirm = useStore((s) => s.askConfirm)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const storeEdit = useStore((s) => s.editMode)
  const openItem = useStore((s) => s.openItem)
  const splitLane = useStore((s) => s.splitLane)
  const addLane = useStore((s) => s.addLane)
  const insertLaneAfter = useStore((s) => s.insertLaneAfter)
  const duplicateLane = useStore((s) => s.duplicateLane)
  const toggleCollapse = useStore((s) => s.toggleCollapse)
  const collapsedLanes = useStore((s) => s.collapsedLanes)
  const moveLane = useStore((s) => s.moveLane)
  const setLaneOrientation = useStore((s) => s.setLaneOrientation)
  const setLaneWip = useStore((s) => s.setLaneWip)
  const setLaneDescription = useStore((s) => s.setLaneDescription)
  const removeLane = useStore((s) => s.removeLane)
  const renameLane = useStore((s) => s.renameLane)
  const addCard = useStore((s) => s.addCard)
  const moveCardToIndex = useStore((s) => s.moveCardToIndex)
  const lensId = useStore((s) => s.lensId)
  const parentPickId = useStore((s) => s.parentPickId)
  const setParent = useStore((s) => s.setParent)
  const cancelParentPick = useStore((s) => s.cancelParentPick)
  const childPickId = useStore((s) => s.childPickId)
  const cancelChildPick = useStore((s) => s.cancelChildPick)
  const dropTargetId = useStore((s) => s.dropTargetId)
  const setDropTarget = useStore((s) => s.setDropTarget)
  // The card in the air and the gap it would land in, shared with every other canvas on the board:
  // a card can be dragged from one cards flow into another, and the shadow must appear in the
  // tree it would land in — which is not the tree that began the gesture.
  const dragPreview = useStore((s) => s.dragPreview)
  const setDragPreview = useStore((s) => s.setDragPreview)

  const graph: Graph = { items, edges, links, placements, lanes }
  const root = rootLane(lanes, flowId)
  const boardName = boards.find((b) => b.id === boardId)?.name
  const flowName = flows.find((f) => f.id === flowId)?.name
  const editMode = storeEdit && interactive
  const rowRef = useRef<HTMLDivElement>(null)
  // Drag empty workflow space to move the board. See usePanScroll.
  const pan = usePanScroll<HTMLDivElement>()
  const openCardMenu = useStore((s) => s.openCardMenu)

  const boardPlacements = placements
    .filter((p) => p.boardId === boardId)
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
  const isInitiative = (typeId: string) => issueTypes.find((t) => t.id === typeId)?.name === 'Initiative'

  // The cards workflow shows the team's cards (non-initiative items) in their lanes.
  // The board's initiatives are surfaced separately in the "Initiatives workflow" on top.
  // A focus narrows this to one initiative's work — the lens is a filter here, not a tint.
  // The cards workflow shows the team's cards (non-initiative items) in their lanes.
  // The board's initiatives are surfaced separately in the "Initiatives workflow" on top.
  const boardItems = boardPlacements
    .map((p) => items.find((i) => i.id === p.itemId))
    .filter((i): i is Item => Boolean(i))
    .filter((i) => !isInitiative(i.typeId) && !i.archived)

  const effectiveLane = new Map<string, string>()
  for (const p of boardPlacements) effectiveLane.set(p.itemId, p.laneId)

  // The card in the air, and the single gap it would land in. The gesture itself is shared with
  // the initiatives workflow; only where the card lands is this surface's own.
  //
  // Read through a ref, so the function itself never changes identity: a card that is memoized
  // (see `Card`) keeps the callback it was first given, and it must not be a stale one. The
  // lane map is the part that moves, so the ref carries it.
  const dragRef = useRef({ onMove, boardId, moveCardToIndex, effectiveLane })
  dragRef.current = { onMove, boardId, moveCardToIndex, effectiveLane }
  const dropCardAt = useCallback((itemId: string, laneId: string, index: number) => {
    // Changing lane goes through the move seam first — that is the path a board's WIP policy
    // intercepts, and it can decline: `block` refuses the move outright, `justify` holds it until
    // a reason arrives. The place is written only when the move actually happened; writing it
    // regardless landed the card the policy had just stopped, which is what a drop did before.
    // Landing at a position is then a plain reorder inside the target lane.
    const { onMove: move, boardId: board, moveCardToIndex: place, effectiveLane: lanes } = dragRef.current
    if (lanes.get(itemId) !== laneId && !move?.(itemId, board, laneId, index)) return
    place(itemId, board, laneId, index)
  }, [])

  /**
   * The lane under the pointer, and the gap in it the card would land in.
   *
   * The gap is drawn among the cards that are *left* — `DropColumn` takes the card in the air out
   * of the lane — and `placeCard` reads the position in that same list. So the card in the air is
   * taken out here too. On the move that begins a lift it is still in the DOM, and counting it put
   * the gap one slot too low: lifting the top card left the card below at the top and showed the
   * shadow in the second slot, as if the gesture had already moved a place.
   */
  const gapUnder = (draggedId: string, x: number, y: number) => {
    let lane = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-lane-id]') ?? null
    if (!lane) {
      // A release just below the last card lands past the lane's own box, and 'put it at the
      // end' is the commonest gesture of all — so take the nearest lane in the same column.
      let best: { el: HTMLElement; distance: number } | null = null
      for (const el of document.querySelectorAll<HTMLElement>('[data-lane-id]')) {
        const r = el.getBoundingClientRect()
        if (x < r.left || x > r.right) continue
        const distance = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
        if (distance <= 48 && (!best || distance < best.distance)) best = { el, distance }
      }
      lane = best?.el ?? null
    }
    const laneId = lane?.dataset.laneId
    if (!lane || !laneId) return null
    const cards = [...lane.querySelectorAll<HTMLElement>('[data-card-id]')].filter((el) => el.dataset.cardId !== draggedId)
    let index = cards.length
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect()
      if (y < r.top + r.height / 2) {
        index = i
        break
      }
    }
    return { laneId, index }
  }

  const { lift, start: startLift, justDragged } = useCardLift({
    // The lifted card's id and height arrive from the gesture itself. `gapUnder` reads the DOM, so
    // it never needed the id — but the parameters are the shape now, so no caller is tempted to
    // read `lift` through a closure that predates the lift.
    onMove: (itemId, x, y, height) => {
      // An initiative card under the pointer takes the drop, and the lane gives way to it: one
      // gesture, one meaning. The lane's gap is cleared so the two can never both be showing.
      const parent = parentTargetUnder(x, y, itemId, graph, issueTypes)
      const gap = parent ? null : gapUnder(itemId, x, y)
      setDropTarget(parent)
      setDragPreview({ itemId, height, laneId: gap?.laneId ?? null, index: gap?.index ?? null })
    },
    onDrop: (itemId, x, y) => {
      setDragPreview(null)
      setDropTarget(null)
      const parent = parentTargetUnder(x, y, itemId, graph, issueTypes)
      if (parent) {
        // A hierarchy edit, not a move: the card stays in the lane it was in.
        setParent(itemId, parent)
        return
      }
      const gap = gapUnder(itemId, x, y)
      if (gap) dropCardAt(itemId, gap.laneId, gap.index)
    },
  })
  const lifting = lift !== null

  // A gesture that ends without a drop — a pointercancel, a lost pointer — leaves no shadow
  // behind: the preview belongs to the gesture, and this is the only canvas that can see its end.
  useEffect(() => {
    if (!lift) setDragPreview(null)
  }, [lift, setDragPreview])

  const ctx: Ctx = {
    lanes, items, issueTypes, graph, users, boards, editMode, filters, boundaryId, boardId, onBoundary, multiSelect, toggleMultiSelect, askConfirm, selectedItemId, boardItems, lensId, effectiveLane,
    ageOf: (itemId) => ageDays(placements.find((p) => p.itemId === itemId && p.boardId === boardId)),
    initiativeScope: initiativeScope(filters, graph),
    interactive,
    parentPickId,
    drag: {
      // The card in the air may be over another canvas, which has no `lift` of its own: the shared
      // preview is what tells it a card is coming and where it would land.
      itemId: lift?.itemId ?? dragPreview?.itemId ?? null,
      laneId: dragPreview?.laneId ?? null,
      index: dragPreview?.index ?? null,
      height: dragPreview?.height ?? lift?.height ?? null,
      dropTargetId: lifting ? dropTargetId : null,
      start: startLift,
    },
    openCard: (itemId) => {
      if (justDragged.current) return
      // While a card is waiting for a parent, a click names one. Anything that is not an
      // initiative is not a choice, so the mode stays open rather than closing on a misclick —
      // and the store would refuse it anyway, which is the rule doing its job.
      // Naming a card for an initiative: the choices here are the cards, so anything that is
      // an initiative is not one.
      if (childPickId) {
        const picked = items.find((i) => i.id === itemId)
        if (picked && !isInitiative(picked.typeId)) {
          setParent(itemId, childPickId)
          cancelChildPick()
        }
        return
      }
      if (parentPickId) {
        const picked = items.find((i) => i.id === itemId)
        if (picked && isInitiative(picked.typeId)) {
          setParent(parentPickId, itemId)
          cancelParentPick()
        }
        return
      }
      openItem(itemId)
    },
    openItem, splitLane, addLane, insertLaneAfter, duplicateLane, toggleCollapse, collapsedLanes, moveLane, setLaneOrientation, setLaneWip, setLaneDescription, removeLane, renameLane,
    onAddCard: (laneId) => {
      const typeId = boardCardTypeId(boards.find((b) => b.id === boardId), issueTypes)
      if (typeId) addCard({ boardId, typeId, laneId, title: 'New card' })
    },
    openCardMenu,
  }

  const canvas = (
    <div ref={rowRef} data-workflow="cards" data-flow={flowId} className="relative flex min-h-0 flex-1">
      <div
        ref={pan.ref}
        {...pan.handlers}
        // A press anywhere that is not the boundary card itself ends its focus mode — clicking
        // off it is how a reader says "I am done with that". A press on a card also opens that
        // card, which `openItem` treats as the next focus; this is the case where nothing was
        // clicked but the ground.
        onPointerDown={(event) => {
          if (boundaryId && !(event.target as HTMLElement).closest?.('[data-boundary-card],[data-waiting-on]')) {
            toggleBoundary(boundaryId)
          }
          pan.handlers.onPointerDown(event)
        }}
        className={cn(
          'min-h-0 flex-1 overflow-auto p-3',
          // The surface is draggable, so it says so — and holds the selection still while
          // it is being dragged.
          pan.panning || lifting ? 'cursor-grabbing select-none' : 'cursor-grab',
          // While a card is in the air the cards underneath are scenery, not targets: they
          // must not light up, offer their menu, or show a pointer cursor as the card passes
          // over them. Taking away their pointer events does all three at once, and it leaves
          // the lane as the thing under the pointer — which is what the drop is looking for.
          lifting && '[&_[data-card-id]]:pointer-events-none',
        )}
      >
        {/* The lane tree, as a tree. Every lane is one item of it, at its own level, and a
            container says whether it is open — so the shape a sighted reader gets from the
            nesting is the shape a screen reader gets from the structure. */}
        <div
          role="tree"
          aria-label={boardName ? `${boardName} — ${flowName ?? 'cards'} lanes` : 'Lanes'}
          className="min-h-[120px] w-full min-w-min"
        >
          {root ? <LaneBox lane={root} ctx={ctx} isRoot /> : <p className="text-meta text-slate-600">This board has no lanes.</p>}
        </div>
      </div>
    </div>
  )

  return (
    <>
      {canvas}
      {lift && (
        <DragLayer html={lift.html} x={lift.x} y={lift.y} grabX={lift.grabX} grabY={lift.grabY} width={lift.width} height={lift.height} />
      )}
    </>
  )
}
