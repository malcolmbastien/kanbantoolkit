import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronsRight,
  Plus,
} from 'lucide-react'
import { Card, type CardParent } from './Card'
import { LaneEditControls } from './LaneCtl'
import { DragLayer } from './DragLayer'
import { InlineEdit } from './InlineEdit'
import { useCardLift } from '@/lib/useCardLift'
import { insertionIndex } from '@/lib/dropIndex'
import { parentTargetUnder } from '@/lib/dropTarget'
import { DropColumn } from './DropColumn'
import { LanePolicy, LaneSettings } from './LaneSettings'
import {
  checklistProgress,
  type Graph,
} from '@/domain/derive'
import { boardCardTypeId, tagsOf } from '@/domain/board'
import { detailFor, type BoardDetail } from '@/domain/boardDetail'
import { lateStartDay } from '@/domain/due'
import { childrenOf, effectiveStage, isTopLevel, laneDepth, laneHoldsCards, rootLane, subtreeIds, wipState } from '@/domain/lanes'
import { ageDays, initiativeScope, matchesFilters, type CardFilters } from '@/domain/filters'
import { STAGE_ACCENT, STAGE_SURFACE, tintOn, WIP_PILL, WIP_SURFACE } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { usePanScroll } from '@/lib/usePanScroll'
import { useDrag } from '@/lib/drag'
import { buildBoardModel, type BoardModel } from '@/domain/boardModel'
import type { Board, IssueType, Item, Lane, Placement, User } from '@/domain/types'
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
  /** Multi-select group (shift+click). */
  multiSelect: string[]
  toggleMultiSelect: (id: string) => void
  /** How much of a card this board draws: the dial's choice, or Full while designing. */
  detail: BoardDetail
  askConfirm: (request: ConfirmRequest) => void
  selectedItemId: string | null
  /** Cards to render. */
  boardItems: Item[]
  /** The board being read — needed for the boundary links, which are about the edge of *this* board. */
  boardId: string
  /** The card waiting for a parent, if any. See `startParentPick`. */
  parentPickId: string | null
  /** The initiative waiting for a card, if any. See `startChildPick`. */
  childPickId: string | null
  effectiveLane: Map<string, string>
  /** The board's derived facts, built once for the render rather than per card. */
  model: BoardModel
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
  /** Open a card at its dependencies: Hierarchy, with its own connections showing. */
  openDependencies: (itemId: string) => void
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

function LaneBox({
  lane,
  ctx,
  isRoot,
  hideHeader,
  gridRef,
  holdHeight,
  holdWidths,
}: {
  lane: Lane
  ctx: Ctx
  isRoot: boolean
  hideHeader?: boolean
  /** The root's row of columns — the thing whose height a lift holds. */
  gridRef?: React.Ref<HTMLDivElement>
  /** The height that row had when the gesture began, applied while a card is in the air. */
  holdHeight?: number | null
  /** The width each column had when the gesture began, so a lift cannot change it. */
  holdWidths?: Record<string, number> | null
}) {
  const { lanes, issueTypes, graph, editMode, boardItems, effectiveLane } = ctx
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
  // A top-level column folds away, and so does any nested lane — a cell of a columns-split, a
  // row of a rows-split, or a leaf. Never the board itself, which would leave nothing, and never
  // a transposed swimlane cell, whose header is the shared row/column grid rather than its own.
  const canCollapse = !isRoot && !hideHeader
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
    // One header, at every depth — a shelf, not a card. A white plate with an edge and a shadow
    // made every column repeat the card's own treatment and compete with the work it named; bare
    // text on the tint then made the columns too easy to skip. A translucent wash is the middle:
    // lighter than the lane's own tint and with no shadow, so a card is still the brightest
    // plane, but the name and count sit on a surface a reader's eye catches before the cards.
    const over = wip === 'over'
    const at = wip === 'at'
    const count = countInLane(lane.id)
    // A limit is an alarm, so at/over keeps its tinted pill; a plain count is only a label.
    const pill = over ? WIP_PILL.over : at ? WIP_PILL.at : undefined
    return (
      <div
        className={cn(
          'mx-1 mt-1 mb-1 rounded-md px-2.5 py-1.5',
          collapsed
            ? // A collapsed row says so in its own right: a dashed edge and a muted ground, so
              // it reads as folded away rather than as a row that happens to be short.
              'border border-dashed border-slate-300 bg-slate-100/80 text-slate-500'
            : // A full column's shelf is its warning surface; otherwise nested cells take a
              // touch more ground than the column's own, so each name owns its side of the split.
              wip
              ? WIP_SURFACE[wip].header
              : cn('bg-white/60 text-slate-700', top ? '' : 'bg-white/75'),
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
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 pointer-coarse:h-9 pointer-coarse:w-9"
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
              inputClassName="w-full self-stretch -my-0.5 rounded bg-white px-1 py-0.5 text-center text-meta font-semibold uppercase leading-tight tracking-wide text-slate-900 outline-none ring-1 ring-inset ring-indigo-300"
            />
          ) : (
            <span className="text-center text-meta font-bold uppercase leading-tight tracking-wide">
              {lane.name || 'Board'}
            </span>
          )}
          <span className="flex items-center justify-end gap-1">
            {over && <AlertTriangle size={12} className="shrink-0 text-white" aria-label="Over its WIP limit" />}
            {at && <AlertTriangle size={12} className="shrink-0 text-amber-950" aria-label="At its WIP limit" />}
            <span
              className={cn(
                'shrink-0 font-mono text-micro tabular-nums',
                pill ? cn('rounded-full px-1.5 py-0.5 font-bold', pill) : 'rounded-full bg-white/70 px-1.5 py-0.5 font-semibold text-slate-600 ring-1 ring-slate-300/60',
              )}
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

        {/* The sentence. The pill says how many; this says what it means, on the shelf a reader
            is already looking at — no glyph to decode and no colour to interpret. */}
        {wip && (
          <div
            data-wip-label={wip}
            className={cn(
              'mt-1 border-t pt-1 text-center text-micro font-bold uppercase tracking-wide',
              WIP_SURFACE[wip].rule,
            )}
          >
            {WIP_SURFACE[wip].label}
          </div>
        )}

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
            removeReason="This lane holds cards. Move them out first"
          />
        )}
      </div>
    )
  }

  // A folded column becomes a strip, because it has to fit in a row of columns and a strip is
  // what a column looks like when it has no width. It wears the column's own accent, so a folded
  // column is identifiable from across the board without being read — the point of folding it
  // rather than deleting it: it is still there, and still this column. This holds at every depth:
  // Dev and Test under In Progress fold to their own strips just as the top-level columns do.
  //
  // A folded *row* is a different thing and gets a different answer: it already has a
  // horizontal header, so folding it means hiding what is under that header. Drawing a strip
  // instead would give one row a header that looks nothing like the rows beside it.
  if (collapsed && parentOrientation === 'columns') {
    const accent = stage ? STAGE_ACCENT[stage] : undefined
    const count = countInLane(lane.id)
    return (
      <div
        role="treeitem"
        aria-level={level}
        aria-expanded={false}
        className="flex h-full min-h-0 w-full flex-col items-center gap-2 overflow-hidden rounded-lg border border-slate-300 py-2"
        style={
          accent
            ? {
                backgroundColor: tintOn(accent, 0.18),
                // Longhands, not the `borderColor` shorthand: mixing a shorthand here with the
                // column's longhand top accent makes React drop the colour when the rail expands.
                borderTopColor: accent,
                borderRightColor: accent,
                borderBottomColor: accent,
                borderLeftColor: accent,
              }
            : undefined
        }
      >
        <button
          onClick={() => ctx.toggleCollapse(lane.id)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded text-slate-700 transition hover:bg-white/70"
          title="Expand"
        >
          <ChevronsRight size={13} />
        </button>
        <span
          className={cn(
            'grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 text-micro font-bold tabular-nums',
            wip === 'over' ? WIP_PILL.over : wip === 'at' ? WIP_PILL.at : 'bg-white/80 text-slate-700 ring-1 ring-slate-300/70',
          )}
          title={`${count} card${count === 1 ? '' : 's'}${wip === 'over' ? ', over its limit' : wip === 'at' ? ', at its limit' : ''}`}
        >
          {count}
        </span>
        <button onClick={() => ctx.toggleCollapse(lane.id)} className="flex min-h-0 flex-1 items-center justify-center" title="Expand">
          <span className="rotate-180 whitespace-nowrap text-meta font-semibold uppercase tracking-wide text-slate-600 [writing-mode:vertical-rl]">
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
    if (transposable && !collapsed) {
      return (
        <SwimlaneBoard
          lane={lane}
          columns={kids}
          ctx={ctx}
          isRoot={isRoot}
          gridRef={gridRef}
          holdHeight={holdHeight}
          holdWidths={holdWidths}
        />
      )
    }

    return (
      <div
        role="treeitem"
        aria-level={level}
        aria-expanded={!collapsed}
        className={cn(
          'relative flex h-full min-h-0 w-full flex-1 flex-col',
          // No outer box: each top-level column is its own card, with a gap between them.
          // The stage tints the whole column, so it reads at a glance without a label — unless
          // the column is at or over its WIP limit, which takes the ground, the edge, the tape
          // and the words: a full column is the thing a reader needs to see first.
          top && 'overflow-hidden rounded-xl border',
          top && (wip ? WIP_SURFACE[wip].lane : 'border-slate-300/80'),
          !top && wip ? WIP_SURFACE[wip].cell : '',
          top && stage && !wip && STAGE_SURFACE[stage],
        )}
        style={top && stage && !wip ? { borderTopWidth: 4, borderTopStyle: 'solid', borderTopColor: STAGE_ACCENT[stage] } : undefined}
      >
        {/* Hazard tape: the one striped edge on the board, so a breach is not read as another
            column colour. It replaces the stage accent line while the alarm stands. */}
        {wip && (
          <span
            aria-hidden
            data-wip-stripe={wip}
            className="absolute inset-x-0 top-0 z-10 h-1.5"
            style={{ backgroundImage: WIP_SURFACE[wip].hazard }}
          />
        )}
        {/* The root of the cards workflow is the board's whole flow, not a lane: its name is
            already the section's, and its count is the section's too. A header here would be a
            second title over the columns. */}
        {!hideHeader && !isRoot && (editMode || lane.name) && header(false)}
        {!collapsed && (
        <div
            role="group"
            ref={isRoot ? gridRef : undefined}
            data-lane-grid={isRoot ? '' : undefined}
            className={cn(
              'flex w-full flex-1 min-h-0',
              // Stacked rows get a gap, and so do nested cells: a split is air between two
              // columns of the one column, not a rule drawn through it. A gap plus each cell's
              // own header shelf is what says where one cell ends and the next begins.
              stacked ? 'flex-col gap-2' : cn('grid', isRoot ? 'gap-3' : 'gap-2'),
            )}
            style={{
              ...(orientation === 'columns'
                ? {
                    gridTemplateColumns: kids
                      .map((k) => {
                        // A column is as wide as its widest card, and taking that card out would
                        // re-measure every column under the reader's hand — at every depth of the
                        // split. Freeze the tracks the gesture started with, so only the card
                        // moves while it is in the air.
                        const held = holdWidths?.[k.id]
                        if (held != null) return `${held}px`
                        return ctx.collapsedLanes[k.id]
                          ? isRoot
                            ? '36px'
                            : '48px'
                          : isRoot
                            ? 'minmax(min-content, 1fr)'
                            : // A split is a set of equal cells: a longer card in one must not
                              // widen its column at its sibling's expense. The floor is wide
                              // enough for a card's foot row, and the parent grows to hold both.
                              'minmax(320px, 1fr)'
                      })
                      .join(' '),
                  }
                : {}),
              // A lift takes its card out of the column, and the tallest column is what sets the
              // row's height. Holding the row at its starting height keeps the workflow from
              // jumping mid-drag: the columns keep their full height, so the gap under the
              // pointer is still where the drop looks for it, and the board gives the space back
              // once the card is down.
              ...(isRoot && holdHeight != null ? { minHeight: holdHeight } : {}),
            }}
          >
            {kids.map((k, i) => (
              <div
                key={k.id}
                data-lane-col={k.id}
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
                    : cn(
                        'flex-1',
                        isRoot && !ctx.collapsedLanes[k.id] && 'overflow-hidden rounded-xl',
                        // A folded rail inside a column needs air from that column's edge; without
                        // it the parent's rounded overflow still shaves the rail's outline.
                        !isRoot && ctx.collapsedLanes[k.id] && 'm-1.5',
                      ),
                )}
              >
                <LaneBox lane={k} ctx={ctx} isRoot={false} holdWidths={holdWidths} />
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
    .filter((i) => matchesFilters(i, ctx.filters, ctx.model.status.get(i.id)?.resolved ?? false, Date.now(), ctx.ageOf(i.id), ctx.initiativeScope))

  return (
    <div
      // A cell is an item of the tree: a screen reader announces "In Progress / Dev, 2 cards" and
      // the cards inside it are its contents, rather than one undifferentiated board. `data-lane-cell`
      // marks it as a cell for the tests — the tree nests, so a role alone cannot say which.
      role="treeitem"
      data-lane-cell
      aria-level={level}
      className={cn(
        'relative flex h-full min-h-0 w-full min-w-[196px] flex-1 flex-col',
        // A top-level column is the object: one edge, one tint, one accent. A nested cell
        // sits on its section's tint and needs none of the three — the air beside it is
        // enough, and a second frame is what made a cell look like a box inside a box. A lane
        // at or over its limit is the exception at both depths: the alarm owns the colour.
        top && 'overflow-hidden rounded-xl border',
        top && (wip ? WIP_SURFACE[wip].lane : 'border-slate-300/80'),
        top ? (wip ? '' : stage ? STAGE_SURFACE[stage] : 'bg-slate-100') : wip ? WIP_SURFACE[wip].cell : '',
      )}
      style={top && stage && !wip ? { borderTopWidth: 4, borderTopStyle: 'solid', borderTopColor: STAGE_ACCENT[stage] } : undefined}
    >
      {wip && (
        <span
          aria-hidden
          data-wip-stripe={wip}
          className="absolute inset-x-0 top-0 z-10 h-1.5"
          style={{ backgroundImage: WIP_SURFACE[wip].hazard }}
        />
      )}
      {!hideHeader && header(true)}
      <DropColumn
        laneId={lane.id}
        dense={ctx.detail === 'mini'}
        draggingId={ctx.drag.itemId}
        draggingHeight={ctx.drag.height}
        at={ctx.drag.laneId === lane.id ? ctx.drag.index : null}
        items={cards.map((c) => {
          const pid = ctx.model.parentOf.get(c.id)
          const p = pid ? ctx.model.itemsById.get(pid) : undefined
          const parent: CardParent | undefined = p ? { id: p.id, title: p.title, type: typeOf(p.typeId) } : undefined
          const roll = ctx.model.rollup.get(c.id)!
          const stage = ctx.effectiveLane.get(c.id) ? effectiveStage(lanes, ctx.effectiveLane.get(c.id)!) : undefined
          // The pick's root is the card the edge is being formed for: it keeps its place and its
          // ring while everything that is not a choice recedes. Waiting for a parent, only the
          // initiatives are choices — and not the card's current parent, which would change
          // nothing. Choosing a card for an initiative, the cards already under it are the link
          // that is already there, and an initiative is not a card at all.
          const pickRoot = ctx.parentPickId === c.id || ctx.childPickId === c.id
          const currentParent = ctx.parentPickId ? ctx.model.parentOf.get(ctx.parentPickId) : undefined
          const picking =
            !pickRoot &&
            ((ctx.parentPickId !== null &&
              (typeOf(c.typeId).name !== 'Initiative' || c.id === currentParent)) ||
              (ctx.childPickId !== null &&
                (typeOf(c.typeId).name === 'Initiative' || ctx.model.parentOf.get(c.id) === ctx.childPickId)))
          return {
            id: c.id,
            node: (
            <Card
              key={c.id}
              item={c}
              type={typeOf(c.typeId)}
              detail={ctx.detail}
              parent={parent}
              selected={ctx.selectedItemId === c.id}
              dropTarget={ctx.drag.dropTargetId === c.id}
              boundary={ctx.boundaryId ? ctx.model.openDependencies.get(c.id)?.has(ctx.boundaryId) === true : false}
              openDependencies={ctx.model.openDependencies.get(c.id)?.size ?? 0}
              multi={ctx.multiSelect.includes(c.id)}
              dimmed={
                // A selected boundary card is the thing being read: everything that does not wait
                // on it recedes, so the relationship is visible across the whole board.
                (ctx.boundaryId !== null && !ctx.model.openDependencies.get(c.id)?.has(ctx.boundaryId)) ||
                picking
              }
              inert={picking}
              connectRoot={pickRoot}
              users={ctx.users}
              onMultiSelect={ctx.toggleMultiSelect}
              onContextMenu={ctx.openCardMenu}
              onLift={ctx.drag.start}
              draggable={ctx.interactive && !ctx.editMode}
              locked={ctx.editMode}
              onOpen={ctx.openCard}
              onOpenDependencies={ctx.openDependencies}
              lateStart={lateStartDay(c.targetStartDate, stage)}
              tags={tagsOf(ctx.boards, c)}
              completed={stage === 'done'}
              summary={{
                childCount: ctx.model.childrenOf.get(c.id)?.length ?? 0,
                blockedBelow: ctx.model.blockedBelow.get(c.id) ?? 0,
                openDescendants: ctx.model.openDescendants.get(c.id) ?? 0,
                rollupPercent: (ctx.model.childrenOf.get(c.id)?.length ?? 0) > 0 ? roll.percent : undefined,
                done: roll.bucket === 'done',
                // Backlog is uncommitted inventory and legitimately rests; Done is finished, so
                // neither is aged. A card in Done with an open child is still done.
                ageDays: stage && stage !== 'backlog' && stage !== 'done' ? ctx.ageOf(c.id) : undefined,
                checklist: checklistProgress(c),
              }}
            />
            ),
          }
        })}
        footer={
          ctx.interactive && !ctx.editMode && ctx.detail !== 'mini' && stage === 'backlog' ? (
            /* The way to make work in the backlog — compact, not a full-width block. A lane's
               empty ground is a place to drop work, and a wide button there catches presses meant
               for the lane. A hover/focus brings the offer forward; a coarse pointer still gets a
               full-height target. */
            <button
              onClick={() => ctx.onAddCard(lane.id)}
              title={`Add card to ${lane.name || 'this column'}`}
              aria-label={`Add card to ${lane.name || 'this column'}`}
              className="mx-auto flex min-h-[32px] w-fit items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 px-3 text-meta font-medium text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50/60 hover:text-indigo-600 focus-visible:border-indigo-300 focus-visible:text-indigo-600 pointer-coarse:min-h-[44px]"
            >
              <Plus size={14} strokeWidth={2} className="shrink-0" /> Add card
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
function SwimlaneBoard({
  lane,
  columns,
  ctx,
  isRoot,
  gridRef,
  holdHeight,
  holdWidths,
}: {
  lane: Lane
  columns: Lane[]
  ctx: Ctx
  isRoot: boolean
  gridRef?: React.Ref<HTMLDivElement>
  holdHeight?: number | null
  holdWidths?: Record<string, number> | null
}) {
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
        ref={isRoot ? gridRef : undefined}
        data-lane-grid={isRoot ? '' : undefined}
        className="grid w-full flex-1 min-h-0"
        style={{
          gridTemplateColumns: `160px ${columns
            .map((c) => {
              // The same freeze as the ordinary row of columns: the lane rail keeps its 160px,
              // and every column keeps the width the gesture started with.
              const held = holdWidths?.[c.id]
              return held != null ? `${held}px` : 'minmax(min-content, 1fr)'
            })
            .join(' ')}`,
          ...(isRoot && holdHeight != null ? { minHeight: holdHeight } : {}),
        }}
      >
        {/* column headers */}
        <div />
        {columns.map((col) => (
          <div key={col.id} data-lane-col={col.id} className={cn(HEAD_ROW, 'gap-1.5 border-b border-slate-300 bg-slate-100 px-2.5 py-1.5 text-slate-800')}>
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
                      <LaneBox lane={cell} ctx={ctx} isRoot={false} hideHeader holdWidths={holdWidths} />
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
  const multiSelect = useStore((s) => s.multiSelect)
  const toggleMultiSelect = useStore((s) => s.toggleMultiSelect)
  const askConfirm = useStore((s) => s.askConfirm)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const boardDetail = useStore((s) => s.boardDetail)
  const storeEdit = useStore((s) => s.editMode)
  const openItem = useStore((s) => s.openItem)
  const openItemDependencies = useStore((s) => s.openItemDependencies)
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
  const parentPickId = useStore((s) => s.parentPickId)
  const childPickId = useStore((s) => s.childPickId)
  const setParent = useStore((s) => s.setParent)
  const cancelParentPick = useStore((s) => s.cancelParentPick)
  const cancelChildPick = useStore((s) => s.cancelChildPick)
  const dropTargetId = useDrag((s) => s.dropTargetId)
  const setDropTarget = useDrag((s) => s.setDropTarget)
  // The card in the air and the gap it would land in, shared with every other canvas on the board:
  // a card can be dragged from one cards flow into another, and the shadow must appear in the
  // tree it would land in — which is not the tree that began the gesture.
  const dragPreview = useDrag((s) => s.dragPreview)
  const setDragPreview = useDrag((s) => s.setDragPreview)

  const graph: Graph = { items, edges, links, placements, lanes }
  // One pass over the workspace arrays; every card below reads a map instead of scanning them.
  const model = useMemo(() => buildBoardModel(graph), [items, edges, links, placements, lanes])
  const root = rootLane(lanes, flowId)
  const boardName = boards.find((b) => b.id === boardId)?.name
  const flowName = flows.find((f) => f.id === flowId)?.name
  const editMode = storeEdit && interactive
  // Designing a board needs the full card: a Mini tile has no fields to compare across a split.
  // The chosen level is untouched and returns when design mode ends.
  const detail: BoardDetail = editMode ? 'full' : detailFor(boardDetail, boardId)
  const rowRef = useRef<HTMLDivElement>(null)
  // The row of columns when the gesture began. A lift takes its card out of the lane and the gap
  // only appears under the pointer, so the tallest column can shrink mid-drag. Hold that row —
  // not the outer workflow — because the columns stretching with it is what keeps the drop area
  // where the reader is aiming; the workflow's height follows the row.
  const laneGridRef = useRef<HTMLDivElement>(null)
  const dragStartHeight = useRef<number | null>(null)
  // Each column's width at the same moment. A column is as wide as its widest card, so taking
  // that card out would narrow it and widen its neighbours mid-drag.
  const dragStartWidths = useRef<Record<string, number> | null>(null)
  // Drag empty workflow space to move the board. See usePanScroll.
  const pan = usePanScroll<HTMLDivElement>()
  const openCardMenu = useStore((s) => s.openCardMenu)

  // The board's placements in rank order: a fact about the data, so it is found when the data
  // changes rather than on every selection, drag or hover.
  const boardPlacements = useMemo(
    () =>
      placements
        .filter((p) => p.boardId === boardId)
        .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)),
    [placements, boardId],
  )
  const initiativeTypeId = useMemo(() => issueTypes.find((t) => t.name === 'Initiative')?.id, [issueTypes])
  const isInitiative = useCallback((typeId: string) => typeId === initiativeTypeId, [initiativeTypeId])

  // The cards workflow shows the team's cards (non-initiative items) in their lanes.
  // The board's initiatives are surfaced separately in the "Initiatives workflow" on top.
  // A focus narrows this to one initiative's work — the lens is a filter here, not a tint.
  // The cards workflow shows the team's cards (non-initiative items) in their lanes.
  // The board's initiatives are surfaced separately in the "Initiatives workflow" on top.
  const boardItems = useMemo(
    () =>
      boardPlacements
        .map((p) => model.itemsById.get(p.itemId))
        .filter((i): i is Item => Boolean(i))
        .filter((i) => !isInitiative(i.typeId) && !i.archived),
    [boardPlacements, model, isInitiative],
  )

  const effectiveLane = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of boardPlacements) map.set(p.itemId, p.laneId)
    return map
  }, [boardPlacements])

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
  const gapUnder = (draggedId: string, x: number, y: number, dense: boolean) => {
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
    return { laneId, index: insertionIndex(cards, x, y, dense) }
  }

  const { lift, start: startLift, justDragged } = useCardLift({
    // The lifted card's id and height arrive from the gesture itself. `gapUnder` reads the DOM, so
    // it never needed the id — but the parameters are the shape now, so no caller is tempted to
    // read `lift` through a closure that predates the lift.
    onMove: (itemId, x, y, height) => {
      // An initiative card under the pointer takes the drop, and the lane gives way to it: one
      // gesture, one meaning. The lane's gap is cleared so the two can never both be showing.
      const parent = parentTargetUnder(x, y, itemId, graph, issueTypes)
      const gap = parent ? null : gapUnder(itemId, x, y, detail === 'mini')
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
      const gap = gapUnder(itemId, x, y, detail === 'mini')
      if (gap) dropCardAt(itemId, gap.laneId, gap.index)
    },
  })
  const lifting = lift !== null
  // Measure before the lift's first render, while the card is still in its lane.
  const beginLift = (event: React.PointerEvent, itemId: string) => {
    const grid = laneGridRef.current
    dragStartHeight.current = grid?.getBoundingClientRect().height ?? null
    dragStartWidths.current = grid
      ? Object.fromEntries(
          [...grid.querySelectorAll<HTMLElement>('[data-lane-col]')].map((el) => [
            el.dataset.laneCol ?? '',
            el.getBoundingClientRect().width,
          ]),
        )
      : null
    startLift(event, itemId)
  }

  // A gesture that ends without a drop — a pointercancel, a lost pointer — leaves no shadow
  // behind: the preview belongs to the gesture, and this is the only canvas that can see its end.
  useEffect(() => {
    if (!lift) setDragPreview(null)
  }, [lift, setDragPreview])

  const boardPlacement = useMemo(() => {
    const map = new Map<string, Placement>()
    for (const placement of placements) {
      if (placement.boardId === boardId && !map.has(placement.itemId)) map.set(placement.itemId, placement)
    }
    return map
  }, [placements, boardId])
  const ctx: Ctx = {
    lanes, items, issueTypes, graph, users, boards, editMode, detail, filters, boundaryId, boardId, multiSelect, toggleMultiSelect, askConfirm, selectedItemId, boardItems, effectiveLane,
    model,
    ageOf: (itemId) => ageDays(boardPlacement.get(itemId)),
    initiativeScope: initiativeScope(filters, graph),
    interactive,
    parentPickId,
    childPickId,
    drag: {
      // The card in the air may be over another canvas, which has no `lift` of its own: the shared
      // preview is what tells it a card is coming and where it would land.
      itemId: lift?.itemId ?? dragPreview?.itemId ?? null,
      laneId: dragPreview?.laneId ?? null,
      index: dragPreview?.index ?? null,
      height: dragPreview?.height ?? lift?.height ?? null,
      dropTargetId: lifting ? dropTargetId : null,
      start: beginLift,
    },
    openCard: (itemId) => {
      if (justDragged.current) return
      // Read at click time: a memoized card can hold the callback it was first given, and the
      // pick mode may have started since. The store's current answer decides, not the render's.
      const { parentPickId: parentPick, childPickId: childPick } = useStore.getState()
      // While a card is waiting for a parent, a click names one. Anything that is not an
      // initiative is not a choice, so the mode stays open rather than closing on a misclick —
      // and the store would refuse it anyway, which is the rule doing its job.
      // Naming a card for an initiative: the choices here are the cards, so anything that is
      // an initiative is not one.
      if (childPick) {
        const picked = items.find((i) => i.id === itemId)
        // A card already under this initiative is the edge that is already there; a press on it
        // changes nothing, so it must not end the pick either.
        if (
          picked &&
          !isInitiative(picked.typeId) &&
          model.parentOf.get(itemId) !== childPick
        ) {
          setParent(itemId, childPick)
          cancelChildPick()
        }
        return
      }
      if (parentPick) {
        const picked = items.find((i) => i.id === itemId)
        if (picked && isInitiative(picked.typeId)) {
          setParent(parentPick, itemId)
          cancelParentPick()
        }
        return
      }
      openItem(itemId)
    },
    openItem, splitLane, addLane, insertLaneAfter, duplicateLane, toggleCollapse, collapsedLanes, moveLane, setLaneOrientation, setLaneWip, setLaneDescription, removeLane, renameLane,
    openDependencies: openItemDependencies,
    onAddCard: (laneId) => {
      const typeId = boardCardTypeId(boards.find((b) => b.id === boardId), issueTypes)
      if (typeId) addCard({ boardId, typeId, laneId, title: 'New card' })
    },
    openCardMenu,
  }

  const canvas = (
    <div
      ref={rowRef}
      data-workflow="cards"
      data-flow={flowId}
      className="relative flex min-h-0 flex-1"
    >
      <div
        ref={pan.ref}
        {...pan.handlers}
        // A press anywhere that is not the boundary card itself ends its focus mode — clicking
        // off it is how a reader says "I am done with that". A press on a card also opens that
        // card, which `openItem` treats as the next focus; this is the case where nothing was
        // clicked but the ground.
        onPointerDown={(event) => {
          if (boundaryId && !(event.target as HTMLElement).closest?.('[data-boundary-card]')) {
            toggleBoundary(boundaryId)
          }
          pan.handlers.onPointerDown(event)
        }}
        className={cn(
          'min-h-0 flex-1 overflow-auto py-3',
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
          {root ? (
            <LaneBox
              lane={root}
              ctx={ctx}
              isRoot
              gridRef={laneGridRef}
              holdHeight={lifting ? dragStartHeight.current : null}
              holdWidths={lifting ? dragStartWidths.current : null}
            />
          ) : (
            <p className="text-meta text-slate-600">This board has no lanes.</p>
          )}
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
