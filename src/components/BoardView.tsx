import { DndContext, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { Layers } from 'lucide-react'
import { BoundaryPin } from './BoundaryPin'
import { Card } from './Card'
import {
  applicableLimit,
  blockingDeps,
  blockingSummary,
  decompositionChildren,
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
import type { Scope } from '@/domain/types'

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
        isOver ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-300' : 'bg-transparent',
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
    <div className="flex h-full min-h-0 flex-col">
      {/* Board subheader: scope · resolution · limits · pressure */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-3 py-1.5 text-[11px]">
        <span className="font-semibold text-slate-700">{scope?.name}</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-500">
          {lifecycle.label} resolution ({resolution}) — counting unit: {lifecycle.itemTypes.join(' / ')}
        </span>
        {scope?.kind === 'value_stream' && scopeLimit && (
          <span
            className={cn(
              'ml-1 rounded px-1.5 py-px font-semibold ring-1',
              limitLevel(scopeCount, scopeLimit) === 'over'
                ? 'bg-rose-50 text-rose-700 ring-rose-200'
                : limitLevel(scopeCount, scopeLimit) === 'red'
                  ? 'bg-rose-50 text-rose-600 ring-rose-200'
                  : limitLevel(scopeCount, scopeLimit) === 'yellow'
                    ? 'bg-amber-50 text-amber-700 ring-amber-200'
                    : 'bg-white text-slate-500 ring-slate-200',
            )}
            title={`Policy ${scopeLimit.id} · ${scopeLimit.enforcement.replace('_', ' ')}`}
          >
            {itemType}s per stream {scopeCount}/{scopeLimit.limit}
          </span>
        )}
        {external.length > 0 && (
          <span className="ml-auto flex items-center gap-1 rounded bg-slate-200/70 px-1.5 py-px font-medium text-slate-600">
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
                  className="mb-1 flex items-center gap-1.5 rounded-t-md border-b-2 border-slate-200 bg-white px-2 py-1.5"
                >
                  <span className={cn('h-2 w-2 rounded-full', lifecycle.accents[state])} />
                  <span className="text-[11px] font-semibold text-slate-600">{state}</span>
                  <span className="ml-auto text-[10px] tabular-nums text-slate-400">
                    {count}
                    {policy ? ` / ${policy.limit}` : ''}
                  </span>
                  {policy && lvl !== 'ok' && (
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        lvl === 'over' || lvl === 'red' ? 'bg-rose-500' : 'bg-amber-400',
                      )}
                      title={`Column limit ${policy.limit} (${policy.enforcement})`}
                    />
                  )}
                </div>
              )
            })}
            {external.length > 0 && (
              <div className="mb-1 rounded-t-md border-b-2 border-dashed border-slate-300 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-500">
                Boundary · waiting on
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
                      'flex items-start gap-2 rounded-l-md border-y border-l border-slate-200 bg-white p-2',
                      row.depth === 1 && 'pl-4',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-semibold text-slate-600">
                        {row.depth === 1 && <span className="text-slate-300">↳ </span>}
                        {row.scope.name}
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        {rowLimit ? (
                          <span
                            className={cn(
                              'rounded px-1 py-px text-[9px] font-bold ring-1',
                              limitLevel(rowCount, rowLimit) === 'over' ||
                                limitLevel(rowCount, rowLimit) === 'red'
                                ? 'bg-rose-50 text-rose-700 ring-rose-200'
                                : limitLevel(rowCount, rowLimit) === 'yellow'
                                  ? 'bg-amber-50 text-amber-700 ring-amber-200'
                                  : 'bg-slate-100 text-slate-500 ring-slate-200',
                            )}
                          >
                            {rowCount}/{rowLimit.limit}
                          </span>
                        ) : (
                          <span className="rounded bg-slate-100 px-1 py-px text-[9px] font-bold text-slate-500">
                            {rowCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* cells */}
                  {lifecycle.states.map((state) => (
                    <div key={state} className="border-y border-slate-200 bg-white/60 px-1">
                      <DroppableCell id={`cell:${row.scope.id}:${state}`}>
                        {cards
                          .filter((c) => c.state === state)
                          .map((c) => (
                            <Card
                              key={c.id}
                              item={c}
                              ref_={refs.get(c.id) ?? ''}
                              stripe={streamColor(c.valueStreamId, scopes)}
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
                    <div className="border-y border-slate-200 bg-slate-50/60 px-1">
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
