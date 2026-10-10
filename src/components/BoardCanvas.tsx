import { DndContext, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import { BoundaryPin } from './BoundaryPin'
import { Card, type CardParent } from './Card'
import {
  blockingDeps,
  decompositionChildren,
  decompositionParent,
  depth as depthOf,
  openDescendants,
  outgoingDependencies,
  rollupOf,
  statusOf,
  type Graph,
} from '@/domain/derive'
import { buildRefs, externalBlockersOnBoard } from '@/domain/board'
import { bucketLaneId, childrenOf, rootLane, subtreeIds } from '@/domain/lanes'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType, Item, Lane } from '@/domain/types'

export interface BoardCanvasProps {
  boardId: string
  /** Read-only bands (management view) set this false. */
  interactive: boolean
  onMove?: (itemId: string, boardId: string, laneId: string) => void
}

function DroppableCell({ id, enabled, children }: { id: string; enabled: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !enabled })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[48px] flex-1 flex-col gap-1 rounded-b-md p-1 transition',
        enabled && isOver ? 'bg-indigo-300/50 ring-1 ring-inset ring-indigo-500' : 'bg-transparent',
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

function LaneBox({ lane, ctx, isRoot }: { lane: Lane; ctx: Ctx; isRoot: boolean }) {
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

  const header = (isLeafCell: boolean) => (
    <div className={cn('rounded-t-md px-2 py-1', isLeafCell ? 'bg-slate-700 text-slate-100' : 'bg-slate-800 text-white')}>
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[11px] font-bold uppercase tracking-wide">{lane.name || 'Board'}</span>
        <span className="text-[10px] font-semibold tabular-nums text-slate-300/80">
          {countInLane(lane.id)}
          {lane.wipLimit !== undefined ? `/${lane.wipLimit}` : ''}
        </span>
        {isLeafCell && lane.isStart && <span className="rounded bg-white/15 px-1 text-[9px] font-bold">start</span>}
        {isLeafCell && lane.isDone && <span className="rounded bg-emerald-400/80 px-1 text-[9px] font-bold text-emerald-950">done</span>}
        {isLeafCell && lane.isCancelled && <span className="rounded bg-rose-400/80 px-1 text-[9px] font-bold text-rose-950">cancelled</span>}
      </div>

      {editMode && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {isLeafCell ? (
            <>
              <Ctl title="Split this cell into columns" onClick={() => ctx.splitLane(lane.id, 'columns')}>▤ split</Ctl>
              <Ctl title="Split this cell into rows" onClick={() => ctx.splitLane(lane.id, 'rows')}>▥ split</Ctl>
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
          ) : (
            <>
              <Ctl title={`Add a ${lane.orientation === 'rows' ? 'row' : 'column'}`} onClick={() => ctx.addLane(lane.id)}>
                ＋ {lane.orientation === 'rows' ? 'row' : 'column'}
              </Ctl>
              <Ctl title="Flip columns ↔ rows" onClick={() => ctx.setLaneOrientation(lane.id, lane.orientation === 'rows' ? 'columns' : 'rows')}>
                ⟷ flip
              </Ctl>
            </>
          )}
          <Ctl title="Rename lane" onClick={() => { const name = window.prompt('Lane name', lane.name); if (name !== null) ctx.renameLane(lane.id, name) }}>
            rename
          </Ctl>
          {!isRoot && <Ctl danger title="Remove lane" onClick={() => ctx.removeLane(lane.id)}>remove</Ctl>}
        </div>
      )}
    </div>
  )

  if (kids.length > 0) {
    const orientation = lane.orientation ?? 'columns'
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col rounded-md border border-slate-300/70 bg-slate-300/20">
        {(editMode || lane.name) && header(false)}
        <div className={cn('flex min-h-0 w-full flex-1 gap-1 p-1', orientation === 'rows' ? 'flex-col' : 'flex-row items-stretch')}>
          {kids.map((k) => (
            <div
              key={k.id}
              className={orientation === 'columns' ? 'flex min-w-[196px] shrink-0 grow basis-auto flex-col' : 'flex w-full shrink-0 basis-auto flex-col'}
            >
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
    <div className="flex min-h-0 w-full flex-1 flex-col rounded-md border border-slate-300 bg-slate-100 shadow-sm">
      {header(true)}
      <DroppableCell id={`lane:${lane.id}`} enabled={ctx.editMode}>
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const graph: Graph = { items, edges, placements, lanes }
  const board = boards.find((b) => b.id === boardId)
  const refs = buildRefs(items, issueTypes)
  const root = rootLane(lanes, boardId)
  const derived = Boolean(board?.derived)
  const editMode = storeEdit && interactive
  const canDrag = interactive && !derived && Boolean(onMove)

  const boardPlacements = placements.filter((p) => p.boardId === boardId)
  const boardItems = boardPlacements
    .map((p) => items.find((i) => i.id === p.itemId))
    .filter((i): i is Item => Boolean(i))

  // Effective lane per item: stored placement, or derived from leaf rollup on rollup boards.
  const effectiveLane = new Map<string, string>()
  for (const p of boardPlacements) {
    if (derived) {
      const b = rollupOf(p.itemId, graph).bucket
      const laneId = bucketLaneId(lanes, boardId, b)
      if (laneId) effectiveLane.set(p.itemId, laneId)
    } else {
      effectiveLane.set(p.itemId, p.laneId)
    }
  }

  const external = externalBlockersOnBoard(graph, boardId)
  const typeOf = (typeId: string): IssueType => issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const onDragEnd = (e: DragEndEvent) => {
    if (!onMove) return
    const overId = e.over?.id
    if (!overId || typeof overId !== 'string' || !overId.startsWith('lane:')) return
    onMove(String(e.active.id), boardId, overId.slice('lane:'.length))
  }

  const ctx: Ctx = {
    lanes, items, issueTypes, refs, graph, editMode, search, selectedItemId, boardItems, effectiveLane,
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

  return canDrag ? (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>{canvas}</DndContext>
  ) : (
    canvas
  )
}
