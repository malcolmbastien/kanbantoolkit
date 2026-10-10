import { DndContext, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { Layers, Plus, SplitSquareHorizontal, SplitSquareVertical, Trash2 } from 'lucide-react'
import { BoundaryPin } from './BoundaryPin'
import { Card, type CardParent } from './Card'
import {
  blockingDeps,
  decompositionChildren,
  decompositionParent,
  depth as depthOf,
  openDescendants,
  outgoingDependencies,
  statusOf,
  type DependencyInfo,
  type Graph,
} from '@/domain/derive'
import { buildRefs } from '@/domain/board'
import { childrenOf, laneCardCount, rootLane } from '@/domain/lanes'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType, Item, Lane, Placement } from '@/domain/types'

interface Props {
  requestMove: (itemId: string, boardId: string, laneId: string) => void
  onAddCard: (laneId: string) => void
}

function DroppableCell({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[54px] flex-1 flex-col gap-1 overflow-y-auto rounded-b-md p-1 transition',
        isOver ? 'bg-indigo-300/50 ring-1 ring-inset ring-indigo-500' : 'bg-transparent',
      )}
    >
      {children}
    </div>
  )
}

interface Ctx {
  lanes: Lane[]
  placements: Placement[]
  items: Item[]
  issueTypes: IssueType[]
  refs: Map<string, string>
  graph: Graph
  editMode: boolean
  search: string
  selectedItemId: string | null
  openItem: (id: string) => void
  splitLane: (laneId: string, orientation: 'columns' | 'rows') => void
  addLane: (parentId: string) => void
  removeLane: (laneId: string) => void
  renameLane: (laneId: string, name: string) => void
  onAddCard: (laneId: string) => void
}

function LaneBox({ lane, ctx, isRoot }: { lane: Lane; ctx: Ctx; isRoot: boolean }) {
  const { lanes, placements, items, issueTypes, refs, graph, editMode } = ctx
  const kids = childrenOf(lanes, lane.id)
  const typeOf = (typeId: string): IssueType =>
    issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const header = (isLeafCell: boolean) => (
    <div className={cn('flex items-center gap-1.5 rounded-t-md px-2 py-1', isLeafCell ? 'bg-slate-700 text-slate-100' : 'bg-slate-800 text-white')}>
      <span className="truncate text-[11px] font-bold uppercase tracking-wide">{lane.name || 'Board'}</span>
      <span className="text-[10px] font-semibold tabular-nums text-slate-300/80">
        {laneCardCount(lanes, placements, lane.id)}
        {lane.wipLimit !== undefined ? `/${lane.wipLimit}` : ''}
      </span>
      {editMode && (
        <span className="ml-auto flex items-center gap-1">
          {isLeafCell ? (
            <>
              <button onClick={() => ctx.splitLane(lane.id, 'columns')} title="Split into columns" className="text-slate-300/70 hover:text-white">
                <SplitSquareHorizontal size={12} />
              </button>
              <button onClick={() => ctx.splitLane(lane.id, 'rows')} title="Split into rows" className="text-slate-300/70 hover:text-white">
                <SplitSquareVertical size={12} />
              </button>
            </>
          ) : (
            <button onClick={() => ctx.addLane(lane.id)} title="Add sub-lane" className="text-slate-300/70 hover:text-white">
              <Plus size={12} />
            </button>
          )}
          <button
            onClick={() => {
              const name = window.prompt('Lane name', lane.name)
              if (name !== null) ctx.renameLane(lane.id, name)
            }}
            title="Rename lane"
            className="text-slate-300/70 hover:text-white"
          >
            ✎
          </button>
          {!isRoot && (
            <button onClick={() => ctx.removeLane(lane.id)} title="Remove lane" className="text-slate-300/70 hover:text-rose-300">
              <Trash2 size={12} />
            </button>
          )}
        </span>
      )}
    </div>
  )

  if (kids.length > 0) {
    const orientation = lane.orientation ?? 'columns'
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {(editMode || lane.name) && header(false)}
        <div className={cn('flex min-h-0 min-w-0 flex-1 gap-1 p-1', orientation === 'rows' ? 'flex-col' : 'flex-row')}>
          {kids.map((k) => (
            <LaneBox key={k.id} lane={k} ctx={ctx} isRoot={false} />
          ))}
        </div>
      </div>
    )
  }

  const cards = placements
    .filter((p) => p.laneId === lane.id)
    .map((p) => items.find((i) => i.id === p.itemId))
    .filter((i): i is Item => Boolean(i))
    .filter((i) => !ctx.search || i.title.toLowerCase().includes(ctx.search.toLowerCase()))

  return (
    <div className="flex min-h-[120px] min-w-[170px] flex-1 flex-col rounded-md border border-slate-300 bg-slate-100 shadow-sm">
      {header(true)}
      <DroppableCell id={`lane:${lane.id}`}>
        {cards.map((c) => {
          const pid = decompositionParent(c.id, ctx.graph.edges)
          const p = pid ? items.find((i) => i.id === pid) : undefined
          const parent: CardParent | undefined = p
            ? { id: p.id, ref_: refs.get(p.id) ?? '', title: p.title, type: typeOf(p.typeId) }
            : undefined
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
                blocksCount: outgoingDependencies(c.id, graph).filter(
                  (d) => d.edge.dep?.status === 'confirmed' && !statusOf(d.dependent.id, graph).resolved,
                ).length,
                openDescendants: openDescendants(c.id, graph).length,
              }}
            />
          )
        })}
        {editMode && (
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

export function BoardView({ requestMove, onAddCard }: Props) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const boards = useStore((s) => s.boards)
  const issueTypes = useStore((s) => s.issueTypes)
  const boardId = useStore((s) => s.boardId)
  const search = useStore((s) => s.search)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const editMode = useStore((s) => s.editMode)
  const openItem = useStore((s) => s.openItem)
  const splitLane = useStore((s) => s.splitLane)
  const addLane = useStore((s) => s.addLane)
  const removeLane = useStore((s) => s.removeLane)
  const renameLane = useStore((s) => s.renameLane)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const graph: Graph = { items, edges, placements, lanes }
  const board = boards.find((b) => b.id === boardId)
  const refs = buildRefs(items, issueTypes)
  const root = rootLane(lanes, boardId)

  const typeOf = (typeId: string): IssueType =>
    issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const onBoardIds = new Set(placements.filter((p) => p.boardId === boardId).map((p) => p.itemId))
  const external: DependencyInfo[] = []
  const seen = new Set<string>()
  for (const p of placements.filter((p) => p.boardId === boardId)) {
    for (const dep of blockingDeps(p.itemId, graph)) {
      if (!onBoardIds.has(dep.blocker.id) && !seen.has(dep.blocker.id)) {
        seen.add(dep.blocker.id)
        external.push(dep)
      }
    }
  }

  const onDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id
    if (!overId || typeof overId !== 'string' || !overId.startsWith('lane:')) return
    requestMove(String(e.active.id), boardId, overId.slice('lane:'.length))
  }

  const ctx: Ctx = {
    lanes, placements, items, issueTypes, refs, graph, editMode, search, selectedItemId,
    openItem, splitLane, addLane, removeLane, renameLane, onAddCard,
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-950/40 bg-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
        <span className="font-semibold text-white">{board?.name}</span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-400">leanlane board</span>
        {editMode && <span className="rounded bg-amber-400/20 px-1.5 py-px font-semibold text-amber-200">edit mode</span>}
        {external.length > 0 && (
          <span className="ml-auto flex items-center gap-1 rounded bg-slate-700 px-1.5 py-px font-medium text-slate-200">
            <Layers size={11} /> {external.length} external blocker{external.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div className="flex h-full min-h-[200px] w-max min-w-full">
              {root ? (
                <LaneBox lane={root} ctx={ctx} isRoot />
              ) : (
                <p className="text-[12px] text-slate-500">This board has no lanes.</p>
              )}
            </div>
          </div>

          {external.length > 0 && (
            <div className="w-[230px] shrink-0 overflow-y-auto border-l border-slate-300 bg-slate-100 p-2">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Boundary · waiting on
              </div>
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
      </DndContext>
    </div>
  )
}
