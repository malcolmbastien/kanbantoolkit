import { Fragment, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronsRight, CopyPlus, Plus, Settings } from 'lucide-react'
import { BoundaryPin } from './BoundaryPin'
import { BoundaryConnectors } from './BoundaryConnectors'
import { Card, type CardDrag, type CardParent } from './Card'
import { CardMenu } from './CardMenu'
import { DragLayer } from './DragLayer'
import { DropColumn } from './DropColumn'
import { LanePolicy, LaneSettings } from './LaneSettings'
import {
  blockedBelow,
  checklistProgress,
  decompositionChildren,
  decompositionParent,
  dependenciesOf,
  dependentsOf,
  lensRole,
  openDescendants,
  rollupOf,
  statusOf,
  waitsOn,
  type Graph,
} from '@/domain/derive'
import { boardCardTypeId, buildRefs, externalDependenciesOnBoard } from '@/domain/board'
import { childrenOf, effectiveStage, isTopLevel, leavesUnder, rootLane, subtreeIds, wipState } from '@/domain/lanes'
import { ageDays, matchesFilters, type CardFilters } from '@/domain/filters'
import { STAGE_ACCENT, STAGE_PILL, STAGE_SURFACE, WIP_HEADER } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { usePanScroll } from '@/lib/usePanScroll'
import type { IssueType, Item, Lane, User } from '@/domain/types'
import type { ConfirmRequest } from '@/store'

export interface BoardCanvasProps {
  boardId: string
  /** Read-only bands (management view) set this false. */
  interactive: boolean
  onMove?: (itemId: string, boardId: string, laneId: string) => void
}

interface Ctx {
  lanes: Lane[]
  items: Item[]
  issueTypes: IssueType[]
  refs: Map<string, string>
  graph: Graph
  /** The people directory (to resolve card assignees). */
  users: User[]
  editMode: boolean
  search: string
  filters: CardFilters
  /** External dependency (boundary lane) whose local dependents are highlighted. */
  boundaryId: string | null
  /** Multi-select group (shift+click). */
  multiSelect: string[]
  toggleMultiSelect: (id: string) => void
  askConfirm: (request: ConfirmRequest) => void
  selectedItemId: string | null
  /** Cards to render. */
  boardItems: Item[]
  /** The focused item, for the lineage highlight. */
  lensId: string | null
  effectiveLane: Map<string, string>
  /** How long a card has sat in its lane, when the placement knows. See `ageDays`. */
  ageOf: (itemId: string) => number | undefined
  interactive: boolean
  /**
   * The card in the air and the one gap it would land in. A lane has a single insertion
   * point rather than a target per card, so the lane never lights up as a second target.
   */
  drag: {
    itemId: string | null
    laneId: string | null
    index: number | null
    lift: (drag: CardDrag | null) => void
    setIndex: (laneId: string, index: number) => void
    clearIndex: (laneId: string) => void
  }
  /** Land a card at a position in a lane, counting the cards already there. */
  dropCardAt: (itemId: string, laneId: string, index: number) => void
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

function Ctl({ children, onClick, title, active, danger, disabled, btnRef }: { children: React.ReactNode; onClick: () => void; title: string; active?: boolean; danger?: boolean; disabled?: boolean; btnRef?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={btnRef}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'grid h-5 w-5 place-items-center rounded text-[11px] transition',
        disabled
          ? 'cursor-not-allowed bg-slate-100 text-slate-400'
          : active
            ? 'bg-indigo-600 text-white'
            : danger
              ? 'bg-slate-200 text-slate-600 hover:bg-rose-100 hover:text-rose-700'
              : 'bg-slate-200 text-slate-600 hover:bg-slate-300 hover:text-slate-900',
      )}
    >
      {children}
    </button>
  )
}

/**
 * A lane header row: the name truly centred, with the edge controls pinned left and right.
 * The side columns are `1fr` each and the middle sizes to the name, so the centring holds
 * whether or not a lane has a collapse control, a WIP count or a policy icon.
 */
const HEAD_ROW = 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1'

function LaneBox({ lane, ctx, isRoot, hideHeader }: { lane: Lane; ctx: Ctx; isRoot: boolean; hideHeader?: boolean }) {
  const { lanes, items, issueTypes, refs, graph, editMode, boardItems, effectiveLane } = ctx
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
  // Two things can collapse: a top-level column (into a vertical strip, LeanKit style),
  // and a row of a column split into rows — the shape where one lane spans the whole
  // width, so folding it away gives the other rows their space back.
  const canCollapse = kids.length > 0 && (top || parent?.orientation === 'rows')
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

  // Confirm before removing a lane that carries cards or sub-lanes.
  const removeWithConfirm = () => {
    const count = countInLane(lane.id)
    const target = childrenOf(lanes, lane.parentId!)
      .filter((s) => s.id !== lane.id)
      .flatMap((s) => leavesUnder(lanes, s.id))[0]
    const parts: string[] = []
    if (count > 0) parts.push(`${count} card${count === 1 ? '' : 's'} will move to ${target ? `"${target.name}"` : 'no lane (they leave the board)'}`)
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
    // A header is its own bar rather than a strip flush to the column: it carries a margin
    // so stacked headers read as separate things, and a white ground so it is not the same
    // colour as the canvas behind it.
    return (
      <div
        className={cn(
          'mx-1 mt-1 mb-0.5 rounded-md border px-2.5 py-1.5 shadow-sm',
          // A collapsed row says so in its own right: a dashed edge and a muted ground, so
          // it reads as folded away rather than as a row that happens to be short.
          collapsed
            ? 'border-dashed border-slate-400 bg-slate-200 text-slate-600 shadow-none'
            : wip === 'over'
              ? WIP_HEADER.over
              : wip === 'at'
                ? WIP_HEADER.at
                : 'border-slate-300 bg-white text-slate-800',
        )}
      >
        {/* Name truly centred, count and policy pinned right. The side columns are equal
            (1fr each) and the middle sizes to the name, so the centring holds whatever
            the lane's depth and whether the edge controls are present at all. */}
        <div className={HEAD_ROW}>
          <span className="flex items-center">
            {canCollapse ? (
              <button
                onClick={(e) => { e.stopPropagation(); ctx.toggleCollapse(lane.id) }}
                className="grid h-4 w-4 shrink-0 place-items-center rounded text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
                title={collapsed ? 'Expand' : `Collapse ${top ? 'column' : 'row'}`}
              >
                {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              </button>
            ) : null}
          </span>
          <span className="text-center text-[11px] font-bold uppercase leading-tight tracking-wide">{lane.name || 'Board'}</span>
          <span className="flex items-center justify-end gap-1">
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums',
                wip === 'over' ? 'bg-rose-800 text-white' : wip === 'at' ? 'bg-amber-700 text-white' : stage ? STAGE_PILL[stage] : 'bg-slate-700 text-white',
              )}
            >
              {countInLane(lane.id)}
              {lane.wipLimit !== undefined ? `/${lane.wipLimit}` : ''}
            </span>
            {lane.description && <LanePolicy policy={lane.description} />}
          </span>
        </div>

        {editMode && !isRoot && (
          <div className="mt-1 flex w-0 min-w-full flex-wrap items-center gap-1" style={{ contain: 'inline-size' }}>
            {/* Top-level columns (Backlog / Not Started / In Progress / Done) are fixed in
                place; only sub-lanes move, and only within their top-level parent. */}
            {!top && (
              <>
                {parentOrientation === 'rows' ? (
                  <>
                    <Ctl title="Move up" disabled={!canMovePrev} onClick={() => ctx.moveLane(lane.id, -1)}>▲</Ctl>
                    <Ctl title="Move down" disabled={!canMoveNext} onClick={() => ctx.moveLane(lane.id, 1)}>▼</Ctl>
                  </>
                ) : (
                  <>
                    <Ctl title="Move left" disabled={!canMovePrev} onClick={() => ctx.moveLane(lane.id, -1)}>◀</Ctl>
                    <Ctl title="Move right" disabled={!canMoveNext} onClick={() => ctx.moveLane(lane.id, 1)}>▶</Ctl>
                  </>
                )}
                <span className="mx-0.5 h-4 w-px bg-slate-300" />
              </>
            )}

            {isLeafCell ? (
              <>
                <Ctl title="Split this cell into columns" onClick={() => ctx.splitLane(lane.id, 'columns')}>▤</Ctl>
                <Ctl title="Split this cell into rows" onClick={() => ctx.splitLane(lane.id, 'rows')}>▥</Ctl>
              </>
            ) : (
              <>
                <Ctl title={`Add a ${(lane.orientation ?? 'columns') === 'rows' ? 'row' : 'column'} to this split`} onClick={() => ctx.addLane(lane.id)}>
                  ＋
                </Ctl>
                {!top && (
                  <Ctl title="Flip columns ↔ rows" onClick={() => ctx.setLaneOrientation(lane.id, (lane.orientation ?? 'columns') === 'rows' ? 'columns' : 'rows')}>
                    ⟷
                  </Ctl>
                )}
              </>
            )}
            {!top && (
              <>
                <Ctl title="Insert a new lane after this one" onClick={() => ctx.insertLaneAfter(lane.id)}>⊞</Ctl>
                <Ctl title="Duplicate this lane and its sub-lanes" onClick={() => ctx.duplicateLane(lane.id)}>
                  <CopyPlus size={11} />
                </Ctl>
              </>
            )}
            <Ctl
              btnRef={settingsBtnRef}
              active={settingsOpen}
              title="Lane settings — name, WIP limit, policy"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <Settings size={11} />
            </Ctl>
            {top && <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">typed column — split to refine</span>}
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
          />
        )}
      </div>
    )
  }

  // A collapsed top-level column: a narrow vertical strip (LeanKit style) with an
  // expand control, a card counter, and the column name reading bottom-to-top.
  if (collapsed && top) {
    const count = countInLane(lane.id)
    return (
      <div className="flex h-full min-h-0 w-full flex-col items-center gap-2 overflow-hidden rounded-lg border border-slate-300 bg-slate-100 py-2 text-slate-600">
        <button
          onClick={() => ctx.toggleCollapse(lane.id)}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
          title="Expand column"
        >
          <ChevronsRight size={13} />
        </button>
        <span
          className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-slate-700 px-1 text-[10px] font-bold tabular-nums text-white"
          title={`${count} card${count === 1 ? '' : 's'}`}
        >
          {count}
        </span>
        <button onClick={() => ctx.toggleCollapse(lane.id)} className="flex min-h-0 flex-1 items-center justify-center" title="Expand column">
          <span className="rotate-180 whitespace-nowrap text-[11px] font-bold uppercase tracking-wide [writing-mode:vertical-rl] text-slate-600">
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
    if (transposable && !collapsed) return <SwimlaneBoard lane={lane} columns={kids} ctx={ctx} />

    return (
      <div
        className={cn(
          'flex h-full min-h-0 w-full flex-1 flex-col',
          // No outer box: each top-level column is its own card, with a gap between them.
          // The stage tints the whole column, so it reads at a glance without a label.
          top && stage && STAGE_SURFACE[stage],
        )}
        style={top && stage ? { borderTop: `4px solid ${STAGE_ACCENT[stage]}` } : undefined}
      >
        {!hideHeader && (editMode || lane.name) && header(false)}
        {collapsed ? (
          <div className="px-1.5 pb-1">
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-400 bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              <ChevronsRight size={10} /> {kids.length} lane{kids.length === 1 ? '' : 's'} hidden
            </span>
          </div>
        ) : (
          <div
            className={cn(
              'flex w-full flex-1 min-h-0',
              // Stacked rows get a gap and their own outline; a nested columns split gets a
              // top gap. Without them, three levels of nested headers — a container header
              // and a row/child header are the same colour — read as one merged block.
              stacked ? 'flex-col' : cn('grid', isRoot ? 'gap-3' : 'divide-x divide-slate-400/50'),
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
                    ? cn('w-full', i === kids.length - 1 && 'grow')
                    : cn('flex-1', isRoot && 'overflow-hidden rounded-lg border border-slate-300'),
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

  const cards = boardItems
    .filter((i) => effectiveLane.get(i.id) === lane.id)
    .filter((i) => !ctx.search || i.title.toLowerCase().includes(ctx.search.toLowerCase()))
    .filter((i) => matchesFilters(i, ctx.filters, statusOf(i.id, graph).resolved, Date.now(), ctx.ageOf(i.id)))

  return (
    <div
      className={cn('flex h-full min-h-0 w-full min-w-[196px] flex-1 flex-col', wip === 'over' ? 'bg-rose-50' : wip === 'at' ? 'bg-amber-50' : stage ? STAGE_SURFACE[stage] : 'bg-slate-100')}
      style={top && stage ? { borderTop: `4px solid ${STAGE_ACCENT[stage]}` } : undefined}
    >
      {!hideHeader && header(true)}
      <DropColumn
        laneId={lane.id}
        enabled={ctx.interactive && !ctx.editMode}
        draggingId={ctx.drag.itemId}
        at={ctx.drag.laneId === lane.id ? ctx.drag.index : null}
        onIndex={ctx.drag.setIndex}
        onLeave={ctx.drag.clearIndex}
        onDrop={ctx.dropCardAt}
        items={cards.map((c) => {
          const pid = decompositionParent(c.id, graph.edges)
          const p = pid ? items.find((i) => i.id === pid) : undefined
          const parent: CardParent | undefined = p ? { id: p.id, ref_: refs.get(p.id) ?? '', title: p.title, type: typeOf(p.typeId) } : undefined
          const roll = rollupOf(c.id, graph)
          return {
            id: c.id,
            node: (
            <Card
              key={c.id}
              item={c}
              type={typeOf(c.typeId)}
              ref_={refs.get(c.id) ?? ''}
              parent={parent}
              selected={ctx.selectedItemId === c.id}
              boundary={ctx.boundaryId ? waitsOn(c.id, ctx.boundaryId, graph) : false}
              multi={ctx.multiSelect.includes(c.id)}
              dimmed={ctx.multiSelect.length > 0 && !ctx.multiSelect.includes(c.id)}
              users={ctx.users}
              onMultiSelect={ctx.toggleMultiSelect}
              onContextMenu={ctx.openCardMenu}
              drawLift
              onDragStateChange={ctx.drag.lift}
              lens={lensRole(c.id, ctx.lensId, graph)}
              draggable={ctx.interactive && !ctx.editMode}
              locked={ctx.editMode}
              onOpen={ctx.openItem}
              summary={{
                childCount: decompositionChildren(c.id, graph.edges).length,
                dependentsCount: dependentsOf(c.id, graph).filter((d) => !statusOf(d.dependent.id, graph).resolved).length,
                linksCount: dependenciesOf(c.id, graph).length + dependentsOf(c.id, graph).length,
                blockedBelow: blockedBelow(c.id, graph),
                openDescendants: openDescendants(c.id, graph).length,
                rollupPercent: decompositionChildren(c.id, graph.edges).length > 0 ? roll.percent : undefined,
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
            <button
              onClick={() => ctx.onAddCard(lane.id)}
              className="flex items-center justify-center gap-1 rounded border border-dashed border-slate-300 py-0.5 text-[10px] text-slate-400 hover:border-indigo-400 hover:text-indigo-600"
            >
              <Plus size={10} /> card
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
function SwimlaneBoard({ lane, columns, ctx }: { lane: Lane; columns: Lane[]; ctx: Ctx }) {
  const { lanes, editMode } = ctx
  const rowNames: string[] = []
  for (const col of columns) {
    for (const r of childrenOf(lanes, col.id)) if (!rowNames.includes(r.name)) rowNames.push(r.name)
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {(editMode || lane.name) && (
        <div className="border-b border-slate-300 bg-slate-100 px-2.5 py-1.5 text-center text-slate-800">
          <span className="text-[11px] font-bold uppercase tracking-wide">{lane.name || 'Board'}</span>
        </div>
      )}
      <div
        className="grid w-full flex-1 min-h-0"
        style={{ gridTemplateColumns: `160px repeat(${columns.length}, minmax(min-content, 1fr))` }}
      >
        {/* column headers */}
        <div />
        {columns.map((col) => (
          <div key={col.id} className={cn(HEAD_ROW, 'gap-1.5 border-b border-slate-300 bg-slate-100 px-2.5 py-1.5 text-slate-800')}>
            <span />
            <span className="text-center text-[11px] font-bold uppercase leading-tight tracking-wide">{col.name}</span>
            <span className="flex justify-end">
              <span className="rounded bg-slate-700 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-white">
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
                <span className="text-[11px] font-bold">{name}</span>
                <span className="mt-1 w-fit rounded bg-slate-700 px-1.5 py-px text-[9px] font-bold text-white">{railCount}</span>
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

export function BoardCanvas({ boardId, interactive, onMove }: BoardCanvasProps) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const boards = useStore((s) => s.boards)
  const issueTypes = useStore((s) => s.issueTypes)
  const users = useStore((s) => s.users)
  const search = useStore((s) => s.search)
  const filters = useStore((s) => s.filters)
  const boundaryId = useStore((s) => s.boundaryId)
  const toggleBoundary = useStore((s) => s.toggleBoundary)
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

  const graph: Graph = { items, edges, links, placements, lanes }
  const refs = buildRefs(items, issueTypes)
  const root = rootLane(lanes, boardId, 'cards')
  const editMode = storeEdit && interactive
  const rowRef = useRef<HTMLDivElement>(null)
  // Drag empty workflow space to move the board. See usePanScroll.
  const pan = usePanScroll<HTMLDivElement>()
  const cardMenu = useStore((s) => s.cardMenu)
  const openCardMenu = useStore((s) => s.openCardMenu)
  const closeCardMenu = useStore((s) => s.closeCardMenu)

  // The card in the air, and the single gap it would land in. Letting go anywhere ends the
  // drag, so nothing stays lifted or previewed. See DropColumn.
  const [lift, setLift] = useState<CardDrag | null>(null)
  const [dropAt, setDropAt] = useState<{ laneId: string; index: number } | null>(null)
  const drag = {
    itemId: lift?.itemId ?? null,
    laneId: dropAt?.laneId ?? null,
    index: dropAt?.index ?? null,
    lift: (d: CardDrag | null) => {
      setLift(d)
      if (!d) setDropAt(null)
    },
    setIndex: (laneId: string, index: number) => setDropAt({ laneId, index }),
    clearIndex: (laneId: string) => setDropAt((d) => (d?.laneId === laneId ? null : d)),
  }

  // The lifted card follows the pointer. `dragover` is the only position the browser offers
  // during a native drag and it fires on whatever is under the cursor, so listen on the
  // window — the card keeps following even out over the chrome, and never jumps back.
  const lifting = lift !== null
  useEffect(() => {
    if (!lifting) return
    const move = (e: DragEvent) => setLift((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d))
    const ended = () => setLift(null)
    // A drag holds the button down, so a mouse move with it released means the drag is over
    // however it ended. `dragend` is the normal signal, but a drag whose source has left the
    // document has no node for it to bubble from — and a card must never be left in the air,
    // so this is the net under it. The button check matters: a stray move *during* a drag must
    // not be mistaken for the end of one.
    const released = (e: MouseEvent) => {
      if (e.buttons === 0) ended()
    }
    window.addEventListener('dragover', move)
    window.addEventListener('dragend', ended)
    window.addEventListener('drop', ended)
    window.addEventListener('mousemove', released)
    return () => {
      window.removeEventListener('dragover', move)
      window.removeEventListener('dragend', ended)
      window.removeEventListener('drop', ended)
      window.removeEventListener('mousemove', released)
    }
  }, [lifting])

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

  const external = externalDependenciesOnBoard(graph, boardId)
  const typeOf = (typeId: string): IssueType => issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const ctx: Ctx = {
    lanes, items, issueTypes, refs, graph, users, editMode, search, filters, boundaryId, multiSelect, toggleMultiSelect, askConfirm, selectedItemId, boardItems, lensId, effectiveLane,
    ageOf: (itemId) => ageDays(placements.find((p) => p.itemId === itemId && p.boardId === boardId)),
    interactive,
    drag,
    dropCardAt: (itemId, laneId, index) => {
      // Changing lane goes through the move seam first — that is the path a board can
      // intercept. Landing at a position is then a plain reorder inside the target lane.
      if (effectiveLane.get(itemId) !== laneId) onMove?.(itemId, boardId, laneId)
      moveCardToIndex(itemId, boardId, laneId, index)
      // The drop is the end of the drag as far as the board is concerned; `dragend` follows
      // and is a no-op. Doing it here too means the card can never be left in the air.
      drag.lift(null)
    },
    openItem, splitLane, addLane, insertLaneAfter, duplicateLane, toggleCollapse, collapsedLanes, moveLane, setLaneOrientation, setLaneWip, setLaneDescription, removeLane, renameLane,
    onAddCard: (laneId) => {
      const typeId = boardCardTypeId(boards.find((b) => b.id === boardId), issueTypes)
      if (typeId) addCard({ boardId, typeId, laneId, title: 'New card' })
    },
    openCardMenu,
  }

  const canvas = (
    <div ref={rowRef} className="relative flex min-h-0 flex-1">
      <div
        ref={pan.ref}
        {...pan.handlers}
        className={cn(
          'min-h-0 flex-1 overflow-auto p-3',
          // The surface is draggable, so it says so — and holds the selection still while
          // it is being dragged.
          pan.panning ? 'cursor-grabbing select-none' : 'cursor-grab',
        )}
      >
        <div className="min-h-[120px] w-full min-w-min">
          {root ? <LaneBox lane={root} ctx={ctx} isRoot /> : <p className="text-[12px] text-slate-500">This board has no lanes.</p>}
        </div>
      </div>
      {external.length > 0 && (
        <div className="w-[230px] shrink-0 overflow-y-auto border-l border-slate-300 bg-slate-100 p-2">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Boundary · waiting on</div>
          <div className="flex flex-col gap-1">
            {external.map((d) => (
              <BoundaryPin
                key={d.link.id}
                dep={d}
                dependencyType={typeOf(d.dependency.typeId)}
                boardName={boards.find((b) => b.id === placements.find((p) => p.itemId === d.dependency.id)?.boardId)?.name ?? '—'}
                selected={boundaryId === d.dependency.id}
                dependentCount={boardItems.filter((i) => waitsOn(i.id, d.dependency.id, graph)).length}
                onSelect={toggleBoundary}
                onOpen={openItem}
              />
            ))}
          </div>
        </div>
      )}
      <BoundaryConnectors
        containerRef={rowRef}
        boundaryId={boundaryId}
        cardIds={boundaryId ? boardItems.filter((i) => waitsOn(i.id, boundaryId, graph)).map((i) => i.id) : []}
      />
    </div>
  )

  return (
    <>
      {canvas}
      {lift && (
        <DragLayer html={lift.html} x={lift.x} y={lift.y} grabX={lift.grabX} grabY={lift.grabY} width={lift.width} height={lift.height} />
      )}
      {cardMenu && (
        <CardMenu
          itemIds={multiSelect.includes(cardMenu.itemId) ? multiSelect : [cardMenu.itemId]}
          anchorId={cardMenu.itemId}
          x={cardMenu.x}
          y={cardMenu.y}
          onClose={closeCardMenu}
        />
      )}
    </>
  )
}
