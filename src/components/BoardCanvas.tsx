import { Fragment, useState } from 'react'
import { Plus } from 'lucide-react'
import { BoundaryPin } from './BoundaryPin'
import { Card, type CardParent } from './Card'
import {
  blockingDeps,
  decompositionChildren,
  decompositionParent,
  depth as depthOf,
  lensRole,
  openDescendants,
  outgoingDependencies,
  rollupOf,
  statusOf,
  type Graph,
} from '@/domain/derive'
import { buildRefs, externalBlockersOnBoard } from '@/domain/board'
import { childrenOf, effectiveStage, isTopLevel, rootLane, STAGE_LABELS, subtreeIds } from '@/domain/lanes'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType, Item, Lane } from '@/domain/types'

export interface BoardCanvasProps {
  boardId: string
  /** Read-only bands (management view) set this false. */
  interactive: boolean
  onMove?: (itemId: string, boardId: string, laneId: string) => void
}

function DroppableCell({ enabled, onDropItem, children }: { enabled: boolean; onDropItem: (itemId: string) => void; children: React.ReactNode }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => {
        if (!enabled) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!enabled) return
        e.preventDefault()
        setOver(false)
        const id = e.dataTransfer.getData('text/plain')
        if (id) onDropItem(id)
      }}
      className={cn(
        'flex min-h-[48px] flex-1 flex-col gap-1 rounded-b-md p-1 transition',
        enabled && over ? 'bg-indigo-300/50 ring-1 ring-inset ring-indigo-500' : 'bg-transparent',
      )}
    >
      {children}
    </div>
  )
}

interface Ctx {
  lanes: Lane[]
  items: Item[]
  issueTypes: IssueType[]
  refs: Map<string, string>
  graph: Graph
  editMode: boolean
  search: string
  selectedItemId: string | null
  boardItems: Item[]
  effectiveLane: Map<string, string>
  lensId: string | null
  toggleLens: (id: string) => void
  interactive: boolean
  dropCard: (itemId: string, laneId: string) => void
  openItem: (id: string) => void
  splitLane: (laneId: string, orientation: 'columns' | 'rows', count?: number) => void
  addLane: (parentId: string) => void
  setLaneOrientation: (laneId: string, orientation: 'columns' | 'rows') => void
  setLaneFlags: (laneId: string, patch: { isStart?: boolean; isDone?: boolean; isCancelled?: boolean }) => void
  setLaneWip: (laneId: string, wipLimit: number | undefined) => void
  removeLane: (laneId: string) => void
  renameLane: (laneId: string, name: string) => void
  onAddCard: (laneId: string) => void
}

function Ctl({ children, onClick, title, active, danger }: { children: React.ReactNode; onClick: () => void; title: string; active?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-semibold transition',
        active ? 'bg-indigo-400 text-white' : danger ? 'bg-white/10 text-slate-200 hover:bg-rose-400/70 hover:text-white' : 'bg-white/10 text-slate-200 hover:bg-white/25',
      )}
    >
      {children}
    </button>
  )
}

function LaneBox({ lane, ctx, isRoot, hideHeader }: { lane: Lane; ctx: Ctx; isRoot: boolean; hideHeader?: boolean }) {
  const { lanes, items, issueTypes, refs, graph, editMode, boardItems, effectiveLane } = ctx
  const kids = childrenOf(lanes, lane.id)
  const typeOf = (typeId: string): IssueType =>
    issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const countInLane = (laneId: string) => {
    const ids = new Set(subtreeIds(lanes, laneId))
    return boardItems.filter((i) => {
      const lid = effectiveLane.get(i.id)
      return lid !== undefined && ids.has(lid)
    }).length
  }

  const header = (isLeafCell: boolean) => {
    const top = isTopLevel(lanes, lane.id)
    const stage = lane.stage ?? effectiveStage(lanes, lane.id)
    const stageChip =
      stage === 'done'
        ? 'bg-emerald-400/80 text-emerald-950'
        : stage === 'inProgress'
          ? 'bg-indigo-400/80 text-indigo-950'
          : stage === 'notStarted'
            ? 'bg-slate-400/80 text-slate-900'
            : ''
    return (
      <div className={cn('rounded-t-md px-2 py-1', isLeafCell ? 'bg-slate-700 text-slate-100' : 'bg-slate-800 text-white')}>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[11px] font-bold uppercase tracking-wide">{lane.name || 'Board'}</span>
          <span className="text-[10px] font-semibold tabular-nums text-slate-300/80">
            {countInLane(lane.id)}
            {lane.wipLimit !== undefined ? `/${lane.wipLimit}` : ''}
          </span>
          {top && stage && (
            <span className={cn('rounded px-1 text-[9px] font-bold', stageChip)} title="Column type — drives rollup up the hierarchy">
              {STAGE_LABELS[stage]}
            </span>
          )}
          {isLeafCell && lane.isCancelled && <span className="rounded bg-rose-400/80 px-1 text-[9px] font-bold text-rose-950">cancelled</span>}
        </div>

        {editMode && !isRoot && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {isLeafCell ? (
              <>
                <Ctl title="Split this cell into columns" onClick={() => ctx.splitLane(lane.id, 'columns')}>▤ split</Ctl>
                <Ctl title="Split this cell into rows" onClick={() => ctx.splitLane(lane.id, 'rows')}>▥ split</Ctl>
                {!top && (
                  <>
                    <Ctl title="Mark as the start column (not started)" active={lane.isStart} onClick={() => ctx.setLaneFlags(lane.id, { isStart: !lane.isStart })}>start</Ctl>
                    <Ctl title="Mark as a done column (resolved)" active={lane.isDone} onClick={() => ctx.setLaneFlags(lane.id, { isDone: !lane.isDone, isStart: false, isCancelled: false })}>done</Ctl>
                    <input
                      type="number"
                      min={0}
                      value={lane.wipLimit ?? ''}
                      onChange={(e) => ctx.setLaneWip(lane.id, e.target.value === '' ? undefined : Number(e.target.value))}
                      placeholder="WIP"
                      title="WIP limit"
                      className="w-12 rounded bg-white/10 px-1 py-0.5 text-[10px] text-white placeholder:text-slate-400"
                    />
                  </>
                )}
              </>
            ) : (
              !top && (
                <>
                  <Ctl title={`Add a ${lane.orientation === 'rows' ? 'row' : 'column'}`} onClick={() => ctx.addLane(lane.id)}>
                    ＋ {lane.orientation === 'rows' ? 'row' : 'column'}
                  </Ctl>
                  <Ctl title="Flip columns ↔ rows" onClick={() => ctx.setLaneOrientation(lane.id, lane.orientation === 'rows' ? 'columns' : 'rows')}>
                    ⟷ flip
                  </Ctl>
                </>
              )
            )}
            {!top && (
              <>
                <Ctl title="Rename lane" onClick={() => { const name = window.prompt('Lane name', lane.name); if (name !== null) ctx.renameLane(lane.id, name) }}>
                  rename
                </Ctl>
                <Ctl danger title="Remove lane" onClick={() => ctx.removeLane(lane.id)}>remove</Ctl>
              </>
            )}
            {top && <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">fixed column type — split to refine</span>}
          </div>
        )}
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
    if (transposable) return <SwimlaneBoard lane={lane} columns={kids} ctx={ctx} />

    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col rounded-md border border-slate-300/70 bg-slate-300/20">
        {!hideHeader && (editMode || lane.name) && header(false)}
        <div
          className={cn('w-full gap-1 p-1', orientation === 'rows' ? 'flex flex-col' : 'grid')}
          style={orientation === 'columns' ? { gridAutoFlow: 'column', gridAutoColumns: 'minmax(min-content, 1fr)' } : undefined}
        >
          {kids.map((k) => (
            <div key={k.id} className={cn('flex flex-col', orientation === 'rows' && 'w-full')}>
              <LaneBox lane={k} ctx={ctx} isRoot={false} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const cards = boardItems
    .filter((i) => effectiveLane.get(i.id) === lane.id)
    .filter((i) => !ctx.search || i.title.toLowerCase().includes(ctx.search.toLowerCase()))

  return (
    <div className="flex h-full min-h-0 w-full min-w-[196px] flex-1 flex-col rounded-md border border-slate-300 bg-slate-100 shadow-sm">
      {!hideHeader && header(true)}
      <DroppableCell enabled={ctx.interactive} onDropItem={(itemId) => ctx.dropCard(itemId, lane.id)}>
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
              lens={lensRole(c.id, ctx.lensId, graph)}
              onLens={ctx.toggleLens}
              draggable={ctx.interactive}
              onOpen={ctx.openItem}
              summary={{
                childCount: decompositionChildren(c.id, graph.edges).length,
                blockedCount: blockingDeps(c.id, graph).length,
                blocksCount: outgoingDependencies(c.id, graph).filter((d) => d.edge.dep?.status === 'confirmed' && !statusOf(d.dependent.id, graph).resolved).length,
                openDescendants: openDescendants(c.id, graph).length,
                rollupPercent: decompositionChildren(c.id, graph.edges).length > 0 ? roll.percent : undefined,
              }}
            />
          )
        })}
        {ctx.editMode && (
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
    <div className="flex min-h-0 w-full flex-1 flex-col rounded-md border border-slate-300/70 bg-slate-300/20">
      {(editMode || lane.name) && (
        <div className="rounded-t-md bg-slate-800 px-2 py-1 text-white">
          <span className="text-[11px] font-bold uppercase tracking-wide">{lane.name || 'Board'}</span>
        </div>
      )}
      <div
        className="grid w-full gap-1 p-1"
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
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const boards = useStore((s) => s.boards)
  const issueTypes = useStore((s) => s.issueTypes)
  const search = useStore((s) => s.search)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const storeEdit = useStore((s) => s.editMode)
  const openItem = useStore((s) => s.openItem)
  const splitLane = useStore((s) => s.splitLane)
  const addLane = useStore((s) => s.addLane)
  const setLaneOrientation = useStore((s) => s.setLaneOrientation)
  const setLaneFlags = useStore((s) => s.setLaneFlags)
  const setLaneWip = useStore((s) => s.setLaneWip)
  const removeLane = useStore((s) => s.removeLane)
  const renameLane = useStore((s) => s.renameLane)
  const addCard = useStore((s) => s.addCard)
  const lensId = useStore((s) => s.lensId)
  const toggleLens = useStore((s) => s.toggleLens)

  const graph: Graph = { items, edges, placements, lanes }
  const refs = buildRefs(items, issueTypes)
  const root = rootLane(lanes, boardId)
  const editMode = storeEdit && interactive

  const boardPlacements = placements.filter((p) => p.boardId === boardId)
  const isInitiative = (typeId: string) => issueTypes.find((t) => t.id === typeId)?.name === 'Initiative'

  // The cards workflow shows the team's cards (non-initiative items) in their lanes.
  // The board's initiatives are surfaced separately in the "Initiatives workflow" on top.
  const boardItems = boardPlacements
    .map((p) => items.find((i) => i.id === p.itemId))
    .filter((i): i is Item => Boolean(i))
    .filter((i) => !isInitiative(i.typeId))

  const effectiveLane = new Map<string, string>()
  for (const p of boardPlacements) effectiveLane.set(p.itemId, p.laneId)

  const external = externalBlockersOnBoard(graph, boardId)
  const typeOf = (typeId: string): IssueType => issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const ctx: Ctx = {
    lanes, items, issueTypes, refs, graph, editMode, search, selectedItemId, boardItems, effectiveLane,
    lensId, toggleLens, interactive,
    dropCard: (itemId, laneId) => onMove?.(itemId, boardId, laneId),
    openItem, splitLane, addLane, setLaneOrientation, setLaneFlags, setLaneWip, removeLane, renameLane,
    onAddCard: (laneId) => {
      const typeId = issueTypes[0]?.id
      if (typeId) addCard({ boardId, typeId, laneId, title: 'New card' })
    },
  }

  const canvas = (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="min-h-[120px] w-full min-w-max">
          {root ? <LaneBox lane={root} ctx={ctx} isRoot /> : <p className="text-[12px] text-slate-500">This board has no lanes.</p>}
        </div>
      </div>
      {external.length > 0 && (
        <div className="w-[230px] shrink-0 overflow-y-auto border-l border-slate-300 bg-slate-100 p-2">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Boundary · waiting on</div>
          <div className="flex flex-col gap-1">
            {external.map((d) => (
              <BoundaryPin
                key={d.edge.id}
                dep={d}
                blockerType={typeOf(d.blocker.typeId)}
                boardName={boards.find((b) => b.id === placements.find((p) => p.itemId === d.blocker.id)?.boardId)?.name ?? '—'}
                pin={d.edge.dep?.pinTo ? items.find((i) => i.id === d.edge.dep?.pinTo) : undefined}
                onOpen={openItem}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )

  return canvas
}
