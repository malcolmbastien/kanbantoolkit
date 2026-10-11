import { Card, type CardParent } from './Card'
import {
  blockedBelow,
  checklistProgress,
  decompositionChildren,
  decompositionParent,
  dependenciesOf,
  dependentsOf,
  depth as depthOf,
  lensRole,
  openDescendants,
  rollupOf,
  statusOf,
  type Graph,
} from '@/domain/derive'
import { buildRefs } from '@/domain/board'
import { topLevelLanes } from '@/domain/lanes'
import { STAGE_ACCENT } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType, Item, Stage } from '@/domain/types'

/**
 * A summary band for the management view: only the board's initiative-level work
 * (items that decompose into children), placed in the three typed columns by rollup.
 * No detailed team flow and no leaf cards.
 */
export function BoardSummary({ boardId, rootsOnly, variant = 'team' }: { boardId: string; rootsOnly?: boolean; variant?: 'initiatives' | 'team' }) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)
  const links = useStore((s) => s.links)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const openItem = useStore((s) => s.openItem)
  const lensId = useStore((s) => s.lensId)
  const toggleLens = useStore((s) => s.toggleLens)
  const editMode = useStore((s) => s.editMode)

  const graph: Graph = { items, edges, links, placements, lanes }
  const refs = buildRefs(items, issueTypes)
  const typeOf = (typeId: string): IssueType =>
    issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const onBoard = placements
    .filter((p) => p.boardId === boardId)
    .map((p) => items.find((i) => i.id === p.itemId))
    .filter((i): i is Item => Boolean(i))

  // Initiative-level work only — items of the Initiative type. `rootsOnly` restricts to a
  // board's *local* top-level initiatives: ones whose parent is not on this same board, so
  // an initiative can roll up to a top-level initiative on another management board and
  // still appear as top-level on its own board.
  const onBoardIds = new Set(onBoard.map((i) => i.id))
  const initiativeTypeId = issueTypes.find((t) => t.name === 'Initiative')?.id
  const initiatives = (initiativeTypeId
    ? onBoard.filter((i) => i.typeId === initiativeTypeId)
    : onBoard.filter((i) => decompositionChildren(i.id, edges).length > 0)
  ).filter((i) => !i.archived).filter((i) => {
    if (!rootsOnly) return true
    const parent = decompositionParent(i.id, edges)
    return !parent || !onBoardIds.has(parent)
  })

  const columns = topLevelLanes(lanes, boardId)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((lane) => ({
      lane,
      stage: (lane.stage ?? 'inProgress') as Stage,
      cards: initiatives.filter((i) => rollupOf(i.id, graph).bucket === (lane.stage ?? 'inProgress')),
    }))

  if (columns.length === 0) return <p className="p-3 text-[12px] text-slate-500">This board has no typed columns.</p>

  const isInitiatives = variant === 'initiatives'

  return (
    <div className="flex gap-2 p-2">
      {columns.map(({ lane, stage, cards }) => (
        <div
          key={lane.id}
          className={cn(
            'flex min-w-[320px] flex-1 basis-0 flex-col overflow-hidden rounded-md border',
            isInitiatives ? 'border-violet-200 bg-violet-50/70' : 'border-slate-300 bg-slate-100',
          )}
          style={{ borderTop: `4px solid ${STAGE_ACCENT[stage]}` }}
        >
          <div className={cn('flex items-center gap-1.5 px-2 py-1', isInitiatives ? 'bg-violet-700 text-white' : 'bg-slate-700 text-slate-100')}>
            <span className="text-[11px] font-bold uppercase tracking-wide">{lane.name}</span>
            <span className={cn('ml-auto text-[10px] font-semibold tabular-nums', isInitiatives ? 'text-violet-200' : 'text-slate-300/80')}>{cards.length}</span>
          </div>
          <div className="flex flex-1 flex-col gap-2 p-2">
            {cards.map((c) => {
              const pid = decompositionParent(c.id, edges)
              const p = pid ? items.find((i) => i.id === pid) : undefined
              const parent: CardParent | undefined = p
                ? { id: p.id, ref_: refs.get(p.id) ?? '', title: p.title, type: typeOf(p.typeId) }
                : undefined
              const childItems = decompositionChildren(c.id, edges)
                .map((id) => items.find((i) => i.id === id))
                .filter((i): i is Item => Boolean(i))
                .filter((i) => !i.archived)
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
                  blockedTone={isInitiatives ? 'aggregate' : 'detail'}
                  selected={selectedItemId === c.id}
                  lens={lensRole(c.id, lensId, graph)}
                  onLens={toggleLens}
                  locked={editMode}
                  onOpen={openItem}
                  summary={{
                    childCount: decompositionChildren(c.id, edges).length,
                    dependentsCount: dependentsOf(c.id, graph).filter(
                      (d) => d.link.status === 'confirmed' && !statusOf(d.dependent.id, graph).resolved,
                    ).length,
                    linksCount: dependenciesOf(c.id, graph).length + dependentsOf(c.id, graph).length,
                    blockedBelow: blockedBelow(c.id, graph),
                    openDescendants: openDescendants(c.id, graph).length,
                    rollupPercent: rollupOf(c.id, graph).percent,
                    checklist: checklistProgress(c),
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
