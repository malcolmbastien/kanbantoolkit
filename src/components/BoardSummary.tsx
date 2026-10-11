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
import { buildRefs } from '@/domain/board'
import { STAGE_LABELS, topLevelLanes } from '@/domain/lanes'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType, Item, Stage } from '@/domain/types'

/**
 * A summary band for the management view: only the board's initiative-level work
 * (items that decompose into children), placed in the three typed columns by rollup.
 * No detailed team flow and no leaf cards.
 */
export function BoardSummary({ boardId, rootsOnly }: { boardId: string; rootsOnly?: boolean }) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const openItem = useStore((s) => s.openItem)

  const graph: Graph = { items, edges, placements, lanes }
  const refs = buildRefs(items, issueTypes)
  const typeOf = (typeId: string): IssueType =>
    issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const onBoard = placements
    .filter((p) => p.boardId === boardId)
    .map((p) => items.find((i) => i.id === p.itemId))
    .filter((i): i is Item => Boolean(i))

  // Initiative-level work only — items of the Initiative type. `rootsOnly` restricts to
  // top-level initiatives (no parent), which is what a management board shows.
  const initiativeTypeId = issueTypes.find((t) => t.name === 'Initiative')?.id
  const initiatives = (initiativeTypeId
    ? onBoard.filter((i) => i.typeId === initiativeTypeId)
    : onBoard.filter((i) => decompositionChildren(i.id, edges).length > 0)
  ).filter((i) => !rootsOnly || !decompositionParent(i.id, edges))

  const columns = topLevelLanes(lanes, boardId)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((lane) => ({
      lane,
      stage: (lane.stage ?? 'inProgress') as Stage,
      cards: initiatives.filter((i) => rollupOf(i.id, graph).bucket === (lane.stage ?? 'inProgress')),
    }))

  if (columns.length === 0) return <p className="p-3 text-[12px] text-slate-500">This board has no typed columns.</p>

  return (
    <div className="flex gap-2 p-2">
      {columns.map(({ lane, stage, cards }) => (
        <div key={lane.id} className="flex min-w-[320px] flex-1 basis-0 flex-col rounded-md border border-slate-300 bg-slate-100">
          <div className="flex items-center gap-1.5 rounded-t-md bg-slate-700 px-2 py-1 text-slate-100">
            <span className="text-[11px] font-bold uppercase tracking-wide">{lane.name}</span>
            <span
              className={cn(
                'rounded px-1 text-[9px] font-bold',
                stage === 'done'
                  ? 'bg-emerald-400/80 text-emerald-950'
                  : stage === 'inProgress'
                    ? 'bg-indigo-400/80 text-indigo-950'
                    : 'bg-slate-400/80 text-slate-900',
              )}
            >
              {STAGE_LABELS[stage]}
            </span>
            <span className="ml-auto text-[10px] font-semibold tabular-nums text-slate-300/80">{cards.length}</span>
          </div>
          <div className="flex flex-1 flex-wrap content-start gap-2 p-2">
            {cards.map((c) => {
              const pid = decompositionParent(c.id, edges)
              const p = pid ? items.find((i) => i.id === pid) : undefined
              const parent: CardParent | undefined = p
                ? { id: p.id, ref_: refs.get(p.id) ?? '', title: p.title, type: typeOf(p.typeId) }
                : undefined
              const childItems = decompositionChildren(c.id, edges)
                .map((id) => items.find((i) => i.id === id))
                .filter((i): i is Item => Boolean(i))
              // Symbols summarise the direct children — team initiatives for a top-level
              // initiative, cards for a team-level one — coloured by their status.
              const symbols = childItems.map((ci) => ({ bucket: rollupOf(ci.id, graph).bucket, title: ci.title }))
              return (
                <Card
                  key={c.id}
                  item={c}
                  type={typeOf(c.typeId)}
                  ref_={refs.get(c.id) ?? ''}
                  depth={depthOf(c.id, graph)}
                  parent={parent}
                  wide
                  symbols={symbols}
                  selected={selectedItemId === c.id}
                  onOpen={openItem}
                  summary={{
                    childCount: decompositionChildren(c.id, edges).length,
                    blockedCount: blockingDeps(c.id, graph).length,
                    blocksCount: outgoingDependencies(c.id, graph).filter(
                      (d) => d.edge.dep?.status === 'confirmed' && !statusOf(d.dependent.id, graph).resolved,
                    ).length,
                    openDescendants: openDescendants(c.id, graph).length,
                    rollupPercent: rollupOf(c.id, graph).percent,
                  }}
                />
              )
            })}
            {cards.length === 0 && <p className="px-1 py-2 text-[10px] text-slate-400">No initiatives</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
