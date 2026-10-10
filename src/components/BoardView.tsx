import { DndContext, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { Layers, Plus, SplitSquareHorizontal, SplitSquareVertical } from 'lucide-react'
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
} from '@/domain/derive'
import { buildRefs } from '@/domain/board'
import {
  laneCardCount,
  lanesAtDepth,
  leafCount,
  leafLanes,
  leafStartIndex,
  maxDepth,
} from '@/domain/lanes'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType, Item, Lane } from '@/domain/types'

interface Props {
  requestMove: (itemId: string, boardId: string, columnLaneId: string, rowLaneId: string | null) => void
  onAddCard: (columnLaneId: string, rowLaneId: string | null) => void
}

function DroppableCell({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[70px] flex-col gap-1 rounded-md p-1 transition',
        isOver ? 'bg-indigo-300/50 ring-1 ring-inset ring-indigo-500' : 'bg-transparent',
      )}
    >
      {children}
    </div>
  )
}

const ROOT = 'ROOT'

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
  const openItem = useStore((s) => s.openItem)
  const splitLane = useStore((s) => s.splitLane)
  const renameLane = useStore((s) => s.renameLane)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const graph = { items, edges, placements, lanes }
  const board = boards.find((b) => b.id === boardId)
  const refs = buildRefs(items, issueTypes)

  const typeOf = (typeId: string): IssueType =>
    issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const vLeaves = leafLanes(lanes, boardId, 'vertical')
  const hLeaves = leafLanes(lanes, boardId, 'horizontal')
  const hasRows = hLeaves.length > 0
  const rowKeys: (Lane | null)[] = hasRows ? hLeaves : [null]

  const vMax = maxDepth(lanes, boardId, 'vertical')
  const hMax = maxDepth(lanes, boardId, 'horizontal')
  const railCols = hasRows ? hMax + 1 : 0

  const placementOf = (itemId: string) =>
    placements.find((p) => p.itemId === itemId && p.boardId === boardId)

  const onBoardIds = new Set(placements.filter((p) => p.boardId === boardId).map((p) => p.itemId))

  const cardsIn = (columnLaneId: string, rowLaneId: string | null) =>
    items.filter((i) => {
      if (search && !i.title.toLowerCase().includes(search.toLowerCase())) return false
      const p = placementOf(i.id)
      return p && p.columnLaneId === columnLaneId && (p.rowLaneId ?? null) === rowLaneId
    })

  // External blockers → boundary lane.
  const external: DependencyInfo[] = []
  const seenExternal = new Set<string>()
  for (const p of placements.filter((p) => p.boardId === boardId)) {
    for (const dep of blockingDeps(p.itemId, graph)) {
      if (!onBoardIds.has(dep.blocker.id) && !seenExternal.has(dep.blocker.id)) {
        seenExternal.add(dep.blocker.id)
        external.push(dep)
      }
    }
  }

  const railAt = new Map<string, Lane>()
  if (hasRows) {
    for (let hd = 0; hd <= hMax; hd++) {
      for (const lane of lanesAtDepth(lanes, boardId, 'horizontal', hd)) {
        railAt.set(`${leafStartIndex(hLeaves, lanes, lane.id)}:${hd}`, lane)
      }
    }
  }

  // Rail cells per row/depth: a lane, an 'empty' filler, or covered by a rowSpan above.
  const railRows: ('covered' | 'empty' | Lane)[][] = []
  if (hasRows) {
    const remaining = Array(hMax + 1).fill(0)
    for (let hi = 0; hi < rowKeys.length; hi++) {
      const cells: ('covered' | 'empty' | Lane)[] = []
      for (let hd = 0; hd <= hMax; hd++) {
        if (remaining[hd] > 0) {
          remaining[hd] -= 1
          cells.push('covered')
        } else {
          const lane = railAt.get(`${hi}:${hd}`)
          if (lane) {
            remaining[hd] = leafCount(lanes, lane.id) - 1
            cells.push(lane)
          } else {
            cells.push('empty')
          }
        }
      }
      railRows.push(cells)
    }
  }

  const onDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id
    if (!overId || typeof overId !== 'string' || !overId.startsWith('cell:')) return
    const [, rowKey, colLaneId] = overId.split(':')
    requestMove(String(e.active.id), boardId, colLaneId, rowKey === ROOT ? null : rowKey)
  }

  const parentOf = (c: Item): CardParent | undefined => {
    const pid = decompositionParent(c.id, edges)
    if (!pid) return undefined
    const p = items.find((i) => i.id === pid)
    return p ? { id: p.id, ref_: refs.get(p.id) ?? '', title: p.title, type: typeOf(p.typeId) } : undefined
  }

  const laneHeaderClass = (axis: 'vertical' | 'horizontal') =>
    axis === 'vertical'
      ? 'bg-slate-700 text-slate-100 border-slate-900/30'
      : 'bg-slate-800 text-white border-slate-900/30'

  const LaneHeader = ({ lane, axis, colSpan, rowSpan }: { lane: Lane; axis: 'vertical' | 'horizontal'; colSpan?: number; rowSpan?: number }) => {
    const count = laneCardCount(lanes, placements, lane.id, axis)
    const over = lane.wipLimit !== undefined && count > lane.wipLimit
    return (
      <th
        colSpan={colSpan}
        rowSpan={rowSpan}
        className={cn('border border-l-0 border-t-0 px-2 py-1 text-left align-top', laneHeaderClass(axis))}
      >
        <div className="flex items-center gap-1.5">
          <button
            onDoubleClick={() => {
              const name = window.prompt('Lane name', lane.name)
              if (name) renameLane(lane.id, name)
            }}
            className="truncate text-[11px] font-bold uppercase tracking-wide"
            title="Double-click to rename"
          >
            {lane.name}
          </button>
          <span className={cn('text-[10px] font-semibold tabular-nums', over ? 'text-rose-300' : 'text-slate-300/80')}>
            {count}
            {lane.wipLimit !== undefined ? `/${lane.wipLimit}` : ''}
          </span>
          <button
            onClick={() => splitLane(lane.id)}
            title="Split into sub-lanes"
            className="ml-auto text-slate-300/60 hover:text-white"
          >
            {axis === 'vertical' ? <SplitSquareVertical size={12} /> : <SplitSquareHorizontal size={12} />}
          </button>
        </div>
      </th>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-950/40 bg-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
        <span className="font-semibold text-white">{board?.name}</span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-400">
          leanlane board · {vLeaves.length} column{vLeaves.length === 1 ? '' : 's'}
          {hasRows ? ` × ${hLeaves.length} row${hLeaves.length === 1 ? '' : 's'}` : ''}
        </span>
        {external.length > 0 && (
          <span className="ml-auto flex items-center gap-1 rounded bg-slate-700 px-1.5 py-px font-medium text-slate-200">
            <Layers size={11} /> {external.length} external blocker{external.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <table className="border-separate border-spacing-0">
            <thead>
              {Array.from({ length: vMax + 1 }).map((_, d) => (
                <tr key={d}>
                  {d === 0 && railCols > 0 && (
                    <th rowSpan={vMax + 1} className="border border-l-0 border-t-0 bg-slate-900/60" />
                  )}
                  {lanesAtDepth(lanes, boardId, 'vertical', d).map((lane) => {
                    const hasKids = lanes.some((l) => l.parentId === lane.id)
                    return (
                      <LaneHeader
                        key={lane.id}
                        lane={lane}
                        axis="vertical"
                        colSpan={hasKids ? leafCount(lanes, lane.id) : undefined}
                        rowSpan={hasKids ? undefined : vMax + 1 - d}
                      />
                    )
                  })}
                  {d === 0 && external.length > 0 && (
                    <th
                      rowSpan={vMax + 1}
                      className="border border-l-0 border-t-0 bg-slate-600 px-2 py-1 text-left text-[11px] font-bold uppercase tracking-wide text-white"
                    >
                      Boundary · waiting on
                    </th>
                  )}
                </tr>
              ))}
            </thead>
            <tbody>
              {rowKeys.map((row, hi) => {
                const rowKey = row?.id ?? ROOT
                return (
                  <tr key={rowKey}>
                    {hasRows &&
                      railRows[hi].map((cell, hd) => {
                        if (cell === 'covered') return null
                        if (cell === 'empty')
                          return <td key={`empty-${hd}`} className="border border-l-0 border-t-0 bg-slate-900/40" />
                        return (
                          <LaneHeader
                            key={cell.id}
                            lane={cell}
                            axis="horizontal"
                            rowSpan={leafCount(lanes, cell.id)}
                          />
                        )
                      })}
                    {vLeaves.map((col) => (
                      <td key={col.id} className="border border-l-0 border-t-0 bg-slate-100 p-1 align-top">
                        <div className="group/cell">
                          <DroppableCell id={`cell:${rowKey}:${col.id}`}>
                            {cardsIn(col.id, row?.id ?? null).map((c) => {
                              const blocksCount = outgoingDependencies(c.id, graph).filter(
                                (d) => d.edge.dep?.status === 'confirmed' && !statusOf(d.dependent.id, graph).resolved,
                              ).length
                              return (
                                <Card
                                  key={c.id}
                                  item={c}
                                  type={typeOf(c.typeId)}
                                  ref_={refs.get(c.id) ?? ''}
                                  depth={depthOf(c.id, graph)}
                                  parent={parentOf(c)}
                                  selected={selectedItemId === c.id}
                                  onOpen={openItem}
                                  summary={{
                                    childCount: decompositionChildren(c.id, edges).length,
                                    blockedCount: blockingDeps(c.id, graph).length,
                                    blocksCount,
                                    openDescendants: openDescendants(c.id, graph).length,
                                  }}
                                />
                              )
                            })}
                          </DroppableCell>
                          <button
                            onClick={() => onAddCard(col.id, row?.id ?? null)}
                            className="flex w-full items-center justify-center gap-1 rounded py-0.5 text-[10px] text-slate-400 opacity-0 transition group-hover/cell:opacity-100 hover:text-indigo-600"
                          >
                            <Plus size={10} /> card
                          </button>
                        </div>
                      </td>
                    ))}
                    {external.length > 0 && (
                      <td className="border border-l-0 border-t-0 bg-slate-100 p-1 align-top">
                        <div className="flex min-h-[70px] flex-col gap-1">
                          {external
                            .filter((d) => (placementOf(d.dependent.id)?.rowLaneId ?? null) === (row?.id ?? null))
                            .map((d) => (
                              <BoundaryPin
                                key={d.edge.id}
                                dep={d}
                                blockerType={typeOf(d.blocker.typeId)}
                                boardName={boards.find((b) => b.id === placementOf(d.blocker.id)?.boardId)?.name ?? '—'}
                                pin={d.edge.dep?.pinTo ? items.find((i) => i.id === d.edge.dep?.pinTo) : undefined}
                                onOpen={openItem}
                              />
                            ))}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </DndContext>
    </div>
  )
}
