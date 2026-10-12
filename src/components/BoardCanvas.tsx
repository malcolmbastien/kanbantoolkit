import { Fragment, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronsRight, Plus } from 'lucide-react'
import { BoundaryPin } from './BoundaryPin'
import { BoundaryConnectors } from './BoundaryConnectors'
import { Card, type CardParent } from './Card'
import { CardMenu } from './CardMenu'
import { DroppableCell } from './DroppableCell'
import { LanePolicy, LaneSettings } from './LaneSettings'
import {
  blockedBelow,
  checklistProgress,
  decompositionChildren,
  decompositionParent,
  dependenciesOf,
  dependentsOf,
  depth as depthOf,
  lensScope,
  openDescendants,
  rollupOf,
  statusOf,
  waitsOn,
  type Graph,
} from '@/domain/derive'
import { boardCardTypeId, buildRefs, externalDependenciesOnBoard } from '@/domain/board'
import { childrenOf, effectiveStage, isTopLevel, leavesUnder, rootLane, subtreeIds, wipState } from '@/domain/lanes'
import { matchesFilters, type CardFilters } from '@/domain/filters'
import { STAGE_ACCENT } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
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
  boardItems: Item[]
  effectiveLane: Map<string, string>
  /** A focus is active, so every card shown is part of the focused initiative's work. */
  focused: boolean
  interactive: boolean
  dropCard: (itemId: string, laneId: string) => void
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
        'rounded px-1.5 py-0.5 text-[10px] font-semibold transition',
        disabled
          ? 'cursor-not-allowed bg-white/5 text-slate-500'
          : active
            ? 'bg-indigo-400 text-white'
            : danger
              ? 'bg-white/10 text-slate-200 hover:bg-rose-400/70 hover:text-white'
              : 'bg-white/10 text-slate-200 hover:bg-white/25',
      )}
    >
      {children}
    </button>
  )
}

function LaneBox({ lane, ctx, isRoot, hideHeader }: { lane: Lane; ctx: Ctx; isRoot: boolean; hideHeader?: boolean }) {
  const { lanes, items, issueTypes, refs, graph, editMode, boardItems, effectiveLane } = ctx
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)
  const kids = childrenOf(lanes, lane.id)
  const top = isTopLevel(lanes, lane.id)
  const stage = lane.stage ?? effectiveStage(lanes, lane.id)
  // Only top-level columns (Backlog / Not Started / In Progress / Done) can collapse.
  const collapsed = ctx.collapsedLanes[lane.id] === true && top
  const parent = lane.parentId ? lanes.find((l) => l.id === lane.parentId) : undefined
  const siblings = lane.parentId ? childrenOf(lanes, lane.parentId) : []
  const sibIdx = siblings.findIndex((s) => s.id === lane.id)
  const canMovePrev = sibIdx > 0
  const canMoveNext = sibIdx >= 0 && sibIdx < siblings.length - 1
  const parentOrientation = parent?.orientation ?? 'columns'
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
    return (
      <div className={cn('px-2 py-1', wip === 'over' ? 'bg-rose-700 text-white' : wip === 'at' ? 'bg-amber-600 text-white' : isLeafCell ? 'bg-slate-700 text-slate-100' : 'bg-slate-800 text-white')}>
        <div className="flex items-center gap-1.5">
          {top && (
            <button
              onClick={(e) => { e.stopPropagation(); ctx.toggleCollapse(lane.id) }}
              className="grid h-4 w-4 shrink-0 place-items-center rounded text-slate-200 hover:bg-white/15 hover:text-white"
              title={collapsed ? 'Expand column' : 'Collapse column'}
            >
              {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
            </button>
          )}
          <span className="truncate text-[11px] font-bold uppercase tracking-wide">{lane.name || 'Board'}</span>
          <span className="text-[10px] font-semibold tabular-nums text-slate-300/80">
            {countInLane(lane.id)}
            {lane.wipLimit !== undefined ? `/${lane.wipLimit}` : ''}
          </span>
          {lane.description && (
            <span className="ml-auto flex shrink-0 items-center">
              <LanePolicy policy={lane.description} />
            </span>
          )}
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
                <span className="mx-0.5 h-4 w-px bg-white/20" />
              </>
            )}

            {isLeafCell ? (
              <>
                <Ctl title="Split this cell into columns" onClick={() => ctx.splitLane(lane.id, 'columns')}>▤ split col</Ctl>
                <Ctl title="Split this cell into rows" onClick={() => ctx.splitLane(lane.id, 'rows')}>▥ split row</Ctl>
              </>
            ) : (
              <>
                <Ctl title={`Add a ${(lane.orientation ?? 'columns') === 'rows' ? 'row' : 'column'} to this split`} onClick={() => ctx.addLane(lane.id)}>
                  ＋ add {(lane.orientation ?? 'columns') === 'rows' ? 'row' : 'column'}
                </Ctl>
                {!top && (
                  <Ctl title="Flip columns ↔ rows" onClick={() => ctx.setLaneOrientation(lane.id, (lane.orientation ?? 'columns') === 'rows' ? 'columns' : 'rows')}>
                    ⟷ flip
                  </Ctl>
                )}
              </>
            )}
            {!top && (
              <>
                <Ctl title="Insert a new lane after this one" onClick={() => ctx.insertLaneAfter(lane.id)}>＋ insert</Ctl>
                <Ctl title="Duplicate this lane and its sub-lanes" onClick={() => ctx.duplicateLane(lane.id)}>duplicate</Ctl>
              </>
            )}
            <Ctl
              btnRef={settingsBtnRef}
              active={settingsOpen}
              title="Lane settings — name, WIP limit, policy"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              ⚙ settings
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
      <div className="flex h-full min-h-0 w-full flex-col items-center gap-2 overflow-hidden bg-slate-700 py-2 text-slate-100">
        <button
          onClick={() => ctx.toggleCollapse(lane.id)}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-300 hover:bg-white/15 hover:text-white"
          title="Expand column"
        >
          <ChevronsRight size={13} />
        </button>
        <span
          className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-white/20 px-1 text-[10px] font-bold tabular-nums"
          title={`${count} card${count === 1 ? '' : 's'}`}
        >
          {count}
        </span>
        <button onClick={() => ctx.toggleCollapse(lane.id)} className="flex min-h-0 flex-1 items-center justify-center" title="Expand column">
          <span className="rotate-180 whitespace-nowrap text-[11px] font-bold uppercase tracking-wide [writing-mode:vertical-rl]">
            {lane.name}
          </span>
        </button>
      </div>
    )
  }

  if (kids.length > 0) {
    const orientation = lane.orientation ?? 'columns'

    // Columns-of-rows (leanKit swimlanes): render one shared grid so lanes span the
    // columns and every cell in a lane stretches to the lane's height.
    const transposable =
      orientation === 'columns' &&
      kids.length >= 2 &&
      kids.every((k) => (k.orientation ?? 'columns') === 'rows' && childrenOf(lanes, k.id).length > 0)
    if (transposable && !collapsed) return <SwimlaneBoard lane={lane} columns={kids} ctx={ctx} />

    return (
      <div
        className={cn('flex h-full min-h-0 w-full flex-1 flex-col', isRoot && 'overflow-hidden rounded-md border border-slate-300/70')}
        style={top && stage ? { borderTop: `4px solid ${STAGE_ACCENT[stage]}` } : undefined}
      >
        {!hideHeader && (editMode || lane.name) && header(false)}
        {collapsed ? (
          <div className="px-2 py-1 text-[10px] italic text-slate-400">{kids.length} hidden</div>
        ) : (
          <div
            className={cn(
              'flex w-full flex-1 min-h-0',
              orientation === 'rows' ? 'flex-col divide-y divide-slate-400/50' : 'grid divide-x divide-slate-400/50',
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
                  orientation === 'rows' ? (i === kids.length - 1 ? 'w-full grow' : 'w-full') : 'flex-1',
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
    .filter((i) => matchesFilters(i, ctx.filters, statusOf(i.id, graph).resolved))

  return (
    <div
      className={cn('flex h-full min-h-0 w-full min-w-[196px] flex-1 flex-col', wip === 'over' ? 'bg-rose-50' : wip === 'at' ? 'bg-amber-50' : 'bg-slate-100')}
      style={top && stage ? { borderTop: `4px solid ${STAGE_ACCENT[stage]}` } : undefined}
    >
      {!hideHeader && header(true)}
      <DroppableCell laneId={lane.id} enabled={ctx.interactive && !ctx.editMode} onDropItem={(itemId) => ctx.dropCard(itemId, lane.id)}>
        {cards.map((c) => {
          const pid = decompositionParent(c.id, graph.edges)
          const p = pid ? items.find((i) => i.id === pid) : undefined
          const parent: CardParent | undefined = p ? { id: p.id, ref_: refs.get(p.id) ?? '', title: p.title, type: typeOf(p.typeId) } : undefined
          const roll = rollupOf(c.id, graph)
          return (
            <Card
              key={c.id}
              item={c}
              type={typeOf(c.typeId)}
              ref_={refs.get(c.id) ?? ''}
              depth={depthOf(c.id, graph)}
              parent={parent}
              selected={ctx.selectedItemId === c.id}
              boundary={ctx.boundaryId ? waitsOn(c.id, ctx.boundaryId, graph) : false}
              multi={ctx.multiSelect.includes(c.id)}
              dimmed={ctx.multiSelect.length > 0 && !ctx.multiSelect.includes(c.id)}
              users={ctx.users}
              onMultiSelect={ctx.toggleMultiSelect}
              onContextMenu={ctx.openCardMenu}
              focused={ctx.focused}
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
                checklist: checklistProgress(c),
              }}
            />
          )
        })}
        {ctx.interactive && !ctx.editMode && (
          <button
            onClick={() => ctx.onAddCard(lane.id)}
            className="flex items-center justify-center gap-1 rounded border border-dashed border-slate-300 py-0.5 text-[10px] text-slate-400 hover:border-indigo-400 hover:text-indigo-600"
          >
            <Plus size={10} /> card
          </button>
        )}
      </DroppableCell>
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
        <div className="bg-slate-800 px-2 py-1 text-white">
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
          <div key={col.id} className="flex items-center gap-1.5 rounded-md bg-slate-700 px-2 py-1 text-slate-100">
            <span className="text-[11px] font-bold uppercase tracking-wide">{col.name}</span>
            <span className="ml-auto text-[10px] font-semibold tabular-nums text-slate-300/80">{countInLane(col.id, ctx)}</span>
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
              <div className="flex flex-col justify-start rounded-md bg-slate-800 px-2 py-2 text-white">
                <span className="text-[11px] font-bold">{name}</span>
                <span className="mt-1 w-fit rounded bg-white/15 px-1 py-px text-[9px] font-bold text-slate-100">{railCount}</span>
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
  const lensId = useStore((s) => s.lensId)

  const graph: Graph = { items, edges, links, placements, lanes }
  const refs = buildRefs(items, issueTypes)
  const root = rootLane(lanes, boardId)
  const editMode = storeEdit && interactive
  const rowRef = useRef<HTMLDivElement>(null)
  const cardMenu = useStore((s) => s.cardMenu)
  const openCardMenu = useStore((s) => s.openCardMenu)
  const closeCardMenu = useStore((s) => s.closeCardMenu)

  const boardPlacements = placements.filter((p) => p.boardId === boardId)
  const isInitiative = (typeId: string) => issueTypes.find((t) => t.id === typeId)?.name === 'Initiative'

  // The cards workflow shows the team's cards (non-initiative items) in their lanes.
  // The board's initiatives are surfaced separately in the "Initiatives workflow" on top.
  // A focus narrows this to one initiative's work — the lens is a filter here, not a tint.
  const lens = lensScope(lensId, graph)
  const boardItems = boardPlacements
    .map((p) => items.find((i) => i.id === p.itemId))
    .filter((i): i is Item => Boolean(i))
    .filter((i) => !isInitiative(i.typeId) && !i.archived)
    .filter((i) => !lens || lens.has(i.id))

  const effectiveLane = new Map<string, string>()
  for (const p of boardPlacements) effectiveLane.set(p.itemId, p.laneId)

  const external = externalDependenciesOnBoard(graph, boardId)
  const typeOf = (typeId: string): IssueType => issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const ctx: Ctx = {
    lanes, items, issueTypes, refs, graph, users, editMode, search, filters, boundaryId, multiSelect, toggleMultiSelect, askConfirm, selectedItemId, boardItems, effectiveLane,
    focused: Boolean(lens), interactive,
    dropCard: (itemId, laneId) => onMove?.(itemId, boardId, laneId),
    openItem, splitLane, addLane, insertLaneAfter, duplicateLane, toggleCollapse, collapsedLanes, moveLane, setLaneOrientation, setLaneWip, setLaneDescription, removeLane, renameLane,
    onAddCard: (laneId) => {
      const typeId = boardCardTypeId(boards.find((b) => b.id === boardId), issueTypes)
      if (typeId) addCard({ boardId, typeId, laneId, title: 'New card' })
    },
    openCardMenu,
  }

  const canvas = (
    <div ref={rowRef} className="relative flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-auto p-3">
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
