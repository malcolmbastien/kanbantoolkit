import { DndContext, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { Layers } from 'lucide-react'
import { BoundaryPin } from './BoundaryPin'
import { Card, type CardParent } from './Card'
import {
  applicableLimit,
  blockingDeps,
  blockingSummary,
  decompositionChildren,
  decompositionParent,
  limitLevel,
  openDescendants,
  outgoingDependencies,
  resolved,
} from '@/domain/derive'
import { buildRefs, buildRows, boardItems, externalBlockers, homeScopeId } from '@/domain/board'
import { LIFECYCLES } from '@/domain/lifecycles'
import { streamColor } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Item, Scope } from '@/domain/types'

interface Props {
  requestMove: (itemId: string, toScopeId: string, toState: string) => void
}

function DroppableCell({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[64px] flex-col gap-1 rounded-md p-1 transition',
        isOver ? 'bg-indigo-300/50 ring-1 ring-inset ring-indigo-500' : 'bg-transparent',
      )}
    >
      {children}
    </div>
  )
}

export function BoardView({ requestMove }: Props) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const scopes = useStore((s) => s.scopes)
  const limits = useStore((s) => s.limits)
  const resolution = useStore((s) => s.resolution)
  const scopeId = useStore((s) => s.scopeId)
  const search = useStore((s) => s.search)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const openItem = useStore((s) => s.openItem)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const lifecycle = LIFECYCLES[resolution]
  const graph = { items, edges }
  const refs = buildRefs(items)

  const rows = buildRows(scopeId, scopes, resolution)
  const all = boardItems(items, edges, scopeId, resolution, scopes)
  const shown = search
    ? all.filter((i) => i.title.toLowerCase().includes(search.toLowerCase()))
    : all
  const external = externalBlockers(items, edges, scopeId, resolution, scopes)

  const scope = scopes.find((s) => s.id === scopeId)
  const itemType = lifecycle.itemTypes[0]

  const cardsForRow = (row: Scope) =>
    shown.filter((i) => homeScopeId(i, resolution) === row.id)

  const columnTotal = (state: string) => shown.filter((i) => i.state === state).length

  // Lineage label: a story shows its parent epic; an epic shows its parent initiative.
  const parentOf = (c: Item): CardParent | undefined => {
    const pid = decompositionParent(c.id, edges)
    if (!pid) return undefined
    const p = items.find((i) => i.id === pid)
    return p ? { id: p.id, ref_: refs.get(p.id) ?? '', title: p.title, type: p.type } : undefined
  }

  const scopeLimit = applicableLimit(limits, resolution, itemType, scopeId)
  const scopeCount = all.filter((i) => i.valueStreamId === scopeId).length

  const pinsForRow = (row: Scope) =>
    external.filter((d) => homeScopeId(d.dependent, resolution) === row.id)

  const onDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id
    if (!overId || typeof overId !== 'string' || !overId.startsWith('cell:')) return
    const [, targetScope, targetState] = overId.split(':')
    requestMove(String(e.active.id), targetScope, targetState)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-200">
      {/* Board subheader: scope · resolution · limits · pressure */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-950/40 bg-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
        <span className="font-semibold text-white">{scope?.name}</span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-400">
          {lifecycle.label} resolution ({resolution}) — counting unit: {lifecycle.itemTypes.join(' / ')}
        </span>
        {scope?.kind === 'value_stream' && scopeLimit && (
          <span
            className={cn(
              'ml-1 rounded px-1.5 py-px font-semibold',
              limitLevel(scopeCount, scopeLimit) === 'over'
                ? 'bg-rose-500 text-white'
                : limitLevel(scopeCount, scopeLimit) === 'red'
                  ? 'bg-rose-500/80 text-white'
                  : limitLevel(scopeCount, scopeLimit) === 'yellow'
                    ? 'bg-amber-400 text-amber-950'
                    : 'bg-slate-700 text-slate-200',
            )}
            title={`Policy ${scopeLimit.id} · ${scopeLimit.enforcement.replace('_', ' ')}`}
          >
            {itemType}s per stream {scopeCount}/{scopeLimit.limit}
          </span>
        )}
        {external.length > 0 && (
          <span className="ml-auto flex items-center gap-1 rounded bg-slate-700 px-1.5 py-px font-medium text-slate-200">
            <Layers size={11} /> {external.length} external blocker{external.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div
            className="grid min-w-max gap-px"
            style={{
              gridTemplateColumns: `160px repeat(${lifecycle.states.length}, minmax(210px, 1fr))${
                external.length > 0 ? ' 220px' : ''
              }`,
            }}
          >
            {/* Header row */}
            <div />
            {lifecycle.states.map((state) => {
              const policy = applicableLimit(limits, resolution, itemType, scopeId, state)
              const count = columnTotal(state)
              const lvl = policy ? limitLevel(count, policy) : 'ok'
              return (
                <div
                  key={state}
                  className="mb-1 overflow-hidden rounded-t-md border border-slate-900/30 border-b-2 border-b-slate-900/50 bg-slate-700 shadow-sm"
                >
                  <div className={cn('h-1 w-full', lifecycle.accents[state])} />
                  <div className="flex items-center gap-1.5 px-2 py-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-100">
                      {state}
                    </span>
                    <span className="ml-auto text-[10px] font-semibold tabular-nums text-slate-300">
                      {count}
                      {policy ? ` / ${policy.limit}` : ''}
                    </span>
                    {policy && lvl !== 'ok' && (
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full shadow',
                          lvl === 'over' || lvl === 'red' ? 'bg-rose-400' : 'bg-amber-300',
                        )}
                        title={`Column limit ${policy.limit} (${policy.enforcement})`}
                      />
                    )}
                  </div>
                </div>
              )
            })}
            {external.length > 0 && (
              <div className="mb-1 overflow-hidden rounded-t-md border border-slate-900/30 border-b-2 border-dashed border-b-slate-900/50 bg-slate-600 shadow-sm">
                <div className="h-1 w-full bg-slate-400" />
                <div className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white">
                  Boundary · waiting on
                </div>
              </div>
            )}

            {/* Rows */}
            {rows.map((row) => {
              const cards = cardsForRow(row.scope)
              const rowLimit =
                row.scope.kind === 'value_stream'
                  ? applicableLimit(limits, resolution, itemType, row.scope.id)
                  : undefined
              const rowCount =
                row.scope.kind === 'value_stream'
                  ? all.filter((i) => i.valueStreamId === row.scope.id).length
                  : cards.length
              const pins = pinsForRow(row.scope)
              return (
                <RowFragment key={row.scope.id}>
                  {/* rail */}
                  <div
                    className={cn(
                      'flex items-start gap-2 rounded-l-md border-y border-slate-900/30 p-2',
                      row.scope.kind === 'value_stream' ? 'bg-slate-800' : 'bg-slate-600',
                      row.depth === 1 && 'pl-4',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-bold text-white">
                        {row.depth === 1 && <span className="text-slate-300/70">↳ </span>}
                        {row.scope.name}
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        {rowLimit ? (
                          <span
                            className={cn(
                              'rounded px-1 py-px text-[9px] font-bold',
                              limitLevel(rowCount, rowLimit) === 'over' ||
                                limitLevel(rowCount, rowLimit) === 'red'
                                ? 'bg-rose-500 text-white'
                                : limitLevel(rowCount, rowLimit) === 'yellow'
                                  ? 'bg-amber-400 text-amber-950'
                                  : 'bg-white/15 text-slate-100',
                            )}
                          >
                            {rowCount}/{rowLimit.limit}
                          </span>
                        ) : (
                          <span className="rounded bg-white/15 px-1 py-px text-[9px] font-bold text-slate-100">
                            {rowCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* cells */}
                  {lifecycle.states.map((state) => (
                    <div key={state} className="border-y border-slate-300/70 bg-slate-100 px-1">
                      <DroppableCell id={`cell:${row.scope.id}:${state}`}>
                        {cards
                          .filter((c) => c.state === state)
                          .map((c) => (
                            <Card
                              key={c.id}
                              item={c}
                              ref_={refs.get(c.id) ?? ''}
                              stripe={streamColor(c.valueStreamId, scopes)}
                              parent={parentOf(c)}
                              selected={selectedItemId === c.id}
                              onOpen={openItem}
                              summary={{
                                childCount: decompositionChildren(c.id, edges).length,
                                blockedCount: blockingDeps(c.id, graph).length,
                                blocksCount: outgoingDependencies(c.id, graph).filter(
                                  (d) => d.edge.dep?.status === 'confirmed' && !resolved(d.dependent),
                                ).length,
                                blocksStreams: blockingSummary(c.id, graph, scopes).streams,
                                openDescendants: openDescendants(c.id, graph).length,
                              }}
                            />
                          ))}
                      </DroppableCell>
                    </div>
                  ))}

                  {/* boundary column */}
                  {external.length > 0 && (
                    <div className="border-y border-slate-300/70 bg-slate-100 px-1">
                      <div className="flex min-h-[64px] flex-col gap-1 p-1">
                        {pins.map((d) => {
                          const pin = d.edge.dep?.pinTo
                            ? items.find((i) => i.id === d.edge.dep?.pinTo)
                            : undefined
                          return (
                            <BoundaryPin
                              key={d.edge.id}
                              dep={d}
                              pin={pin}
                              scopes={scopes}
                              onOpen={openItem}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )}
                </RowFragment>
              )
            })}
          </div>
        </div>
      </DndContext>
    </div>
  )
}

/** Fragment wrapper so each row returns rail + cells as siblings in the grid. */
function RowFragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
