import { Layers, ListTree, Users, X } from 'lucide-react'
import { initiativeTypeById } from '@/domain/board'
import { rollupOf, type Graph } from '@/domain/derive'
import { softChipColors } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { PersonAvatar } from './PersonAvatar'
import type { Item } from '@/domain/types'

/**
 * The initiatives mapped to one objective, with the details a reader needs beside the map.
 *
 * The strategy map's columns already draw the work; this is the editorial view of the same
 * relation — kind, progress, carrying board, direct children and people — shown while the board is
 * in **Edit objectives** so a mapping can be checked and removed without opening the drawer.
 */
export function MappedInitiativeDetails({ objectiveId }: { objectiveId: string }) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const links = useStore((s) => s.links)
  const boards = useStore((s) => s.boards)
  const users = useStore((s) => s.users)
  const setAttribution = useStore((s) => s.setAttribution)
  const openItem = useStore((s) => s.openItem)

  const graph: Graph = { items, edges, links, placements, lanes }
  const work = edges
    .filter((e) => e.kind === 'attribution' && e.from === objectiveId)
    .map((e) => items.find((i) => i.id === e.to))
    .filter((i): i is Item => i !== undefined && !i.archived)

  if (work.length === 0) return null

  const boardOf = (itemId: string) => {
    const placement = placements.find((p) => p.itemId === itemId)
    return placement ? boards.find((b) => b.id === placement.boardId) : undefined
  }
  const bandLabel = (band: string | undefined) =>
    band === 'team' ? 'Team' : band === 'program' ? 'Program' : band === 'portfolio' ? 'Portfolio' : 'Board'
  const childCount = (itemId: string) => edges.filter((e) => e.kind === 'decomposition' && e.from === itemId).length
  const assigneesOf = (item: Item) =>
    (item.assignees ?? []).flatMap((id) => {
      const user = users.find((candidate) => candidate.id === id)
      return user ? [user] : []
    })

  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-micro font-bold uppercase tracking-wide text-slate-600">
        Initiatives mapping here <span className="rounded bg-slate-100 px-1 text-slate-600">{work.length}</span>
      </div>
      <div className="space-y-1">
        {work.map((item) => {
          const roll = rollupOf(item.id, graph)
          const kind = initiativeTypeById(boards, item.initiativeTypeId)
          const chip = kind ? softChipColors(kind.color) : undefined
          const board = boardOf(item.id)
          const children = childCount(item.id)
          const assignees = assigneesOf(item)
          return (
            <div key={item.id} className="rounded-md border border-slate-200 bg-slate-50/60 p-2">
              <div className="flex items-start gap-1.5">
                <span
                  className={cn(
                    'shrink-0 rounded px-1 py-px text-micro font-bold uppercase tracking-wide',
                    !chip && 'bg-slate-200 text-slate-600',
                  )}
                  style={chip ? { backgroundColor: chip.background, color: chip.color } : undefined}
                >
                  {kind ? kind.name : 'No kind'}
                </span>
                <button
                  onClick={() => openItem(item.id)}
                  className="min-w-0 flex-1 truncate text-left text-meta font-medium text-slate-800 hover:text-indigo-600"
                  title={item.title}
                >
                  {item.title}
                </button>
                <span className="shrink-0 text-micro font-semibold tabular-nums text-slate-600" title={`${roll.done} of ${roll.total} done`}>
                  {roll.percent}%
                </span>
                <button
                  onClick={() => setAttribution(item.id, objectiveId, false)}
                  className="shrink-0 text-slate-600 hover:text-rose-500"
                  title="Remove from this objective"
                >
                  <X size={12} />
                </button>
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${roll.percent}%` }} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-slate-600">
                <span className="flex min-w-0 items-center gap-1" title={board ? board.name : 'No board carries this initiative'}>
                  <Layers size={11} className="shrink-0 text-slate-400" />
                  <span className="truncate">{board ? `${bandLabel(board.band)} · ${board.name}` : 'No board'}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1" title="Direct children below this initiative">
                  <ListTree size={11} className="shrink-0 text-slate-400" />
                  {children === 0 ? 'No children' : `${children} child${children === 1 ? '' : 'ren'}`}
                </span>
                <span className="flex min-w-0 items-center gap-1" title={assignees.length ? assignees.map((u) => u.name).join(', ') : 'Unassigned'}>
                  <Users size={11} className="shrink-0 text-slate-400" />
                  {assignees.length === 0 ? (
                    <span>Unassigned</span>
                  ) : (
                    <>
                      <span className="flex shrink-0 -space-x-1">
                        {assignees.slice(0, 3).map((user) => (
                          <PersonAvatar key={user.id} user={user} small className="ring-2 ring-white" />
                        ))}
                      </span>
                      <span className="min-w-0 truncate">{assignees.map((u) => u.name).join(', ')}</span>
                    </>
                  )}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
