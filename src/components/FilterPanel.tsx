import { X } from 'lucide-react'
import { cardTypes, initiativeTypeId } from '@/domain/board'
import { statusOf, type Graph } from '@/domain/derive'
import { activeFilterCount, ageDays, hasActiveFilters, matchesFilters } from '@/domain/filters'
import { PRIORITY_META, PRIORITY_ORDER, type Priority } from './PriorityBadge'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Item } from '@/domain/types'

/**
 * The board filter panel — a right-side panel (like the item panel) with a few
 * basic filters: one per card type, plus blocked / overdue / unassigned.
 */
export function FilterPanel() {
  const boardId = useStore((s) => s.boardId)
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)
  const filters = useStore((s) => s.filters)
  const toggleFilters = useStore((s) => s.toggleFilters)
  const toggleFilterType = useStore((s) => s.toggleFilterType)
  const setFilters = useStore((s) => s.setFilters)
  const clearFilters = useStore((s) => s.clearFilters)

  const graph: Graph = { items, edges, links, placements, lanes }
  const types = cardTypes(issueTypes)
  const active = activeFilterCount(filters)
  const initiativeId = initiativeTypeId(issueTypes)

  // The cards this board shows (same set the cards workflow renders).
  const boardCards = placements
    .filter((p) => p.boardId === boardId)
    .map((p) => items.find((i) => i.id === p.itemId))
    .filter((i): i is Item => Boolean(i))
    .filter((i) => !i.archived && i.typeId !== initiativeId)
  const placementOf = (id: string) => placements.find((p) => p.itemId === id && p.boardId === boardId)
  const matched = boardCards.filter((i) =>
    matchesFilters(i, filters, statusOf(i.id, graph).resolved, Date.now(), ageDays(placementOf(i.id))),
  ).length
  const users = useStore((s) => s.users)
  // Only the people who actually hold work here: a filter list of the whole org is noise.
  const assignedHere = users.filter((u) => boardCards.some((c) => (c.assignees ?? []).includes(u.id)))

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-slate-300 bg-slate-50">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-slate-800">Filters</div>
          <div className="text-[11px] text-slate-400">Narrow the cards shown on this board</div>
        </div>
        <button onClick={toggleFilters} className="text-slate-400 hover:text-slate-600" title="Close filters">
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-[12px]">
        <div
          className={cn(
            'rounded-md px-2.5 py-1.5 text-[11px]',
            hasActiveFilters(filters) ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500',
          )}
        >
          {hasActiveFilters(filters)
            ? `Showing ${matched} of ${boardCards.length} cards · ${active} filter${active === 1 ? '' : 's'} active`
            : `${boardCards.length} cards on this board`}
        </div>

        <section>
          <SectionLabel>Card type</SectionLabel>
          <div className="space-y-1">
            {types.map((t) => {
              const on = filters.typeIds.includes(t.id)
              return (
                <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50">
                  <input type="checkbox" checked={on} onChange={() => toggleFilterType(t.id)} />
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                  <span className="flex-1 text-slate-700">{t.name}</span>
                </label>
              )
            })}
          </div>
          <p className="mt-1 text-[10px] text-slate-400">No type checked shows every type.</p>
        </section>

        <section>
          <SectionLabel>Assignee</SectionLabel>
          {assignedHere.length === 0 ? (
            <p className="text-[11px] text-slate-400">No one is assigned on this board.</p>
          ) : (
            <div className="space-y-1">
              {assignedHere.map((u) => {
                const on = filters.assigneeIds.includes(u.id)
                return (
                  <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setFilters({
                          assigneeIds: on ? filters.assigneeIds.filter((x) => x !== u.id) : [...filters.assigneeIds, u.id],
                        })
                      }
                    />
                    <span className="flex-1 text-slate-700">{u.name}</span>
                  </label>
                )
              })}
            </div>
          )}
          <p className="mt-1 text-[10px] text-slate-400">No one checked shows every card.</p>
        </section>

        <section>
          <SectionLabel>Priority</SectionLabel>
          <div className="space-y-1">
            {PRIORITY_ORDER.map((p) => {
              const on = filters.priorities.includes(p)
              const { label, icon: Icon, dot } = PRIORITY_META[p as Priority]
              return (
                <label key={p} className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setFilters({ priorities: on ? filters.priorities.filter((x) => x !== p) : [...filters.priorities, p] })
                    }
                  />
                  <Icon size={12} className={cn('shrink-0', dot)} />
                  <span className="flex-1 text-slate-700">{label}</span>
                </label>
              )
            })}
          </div>
          <p className="mt-1 text-[10px] text-slate-400">Cards with no priority are shown by any selection.</p>
        </section>

        <section>
          <SectionLabel>Time in lane</SectionLabel>
          <div className="flex flex-wrap gap-1">
            {[undefined, 7, 14, 30].map((d) => {
              const on = filters.minAgeDays === d
              return (
                <button
                  key={String(d)}
                  onClick={() => setFilters({ minAgeDays: d })}
                  className={cn(
                    'rounded-lg border px-2 py-1 text-[11px] font-medium transition',
                    on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
                  )}
                >
                  {d === undefined ? 'Any age' : `${d}+ days`}
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-[10px] text-slate-400">
            Age is time in the card's current lane. Cards that predate the clock have no age, so an age filter excludes them.
          </p>
        </section>

        <section>
          <SectionLabel>Status</SectionLabel>
          <div className="space-y-1">
            <ToggleRow
              label="Blocked"
              hint="explicitly blocked cards"
              checked={filters.blocked}
              onChange={(v) => setFilters({ blocked: v })}
            />
            <ToggleRow
              label="Overdue"
              hint="past target date, not done"
              checked={filters.overdue}
              onChange={(v) => setFilters({ overdue: v })}
            />
            <ToggleRow
              label="Unassigned"
              hint="no assignee"
              checked={filters.unassigned}
              onChange={(v) => setFilters({ unassigned: v })}
            />
          </div>
        </section>

        {hasActiveFilters(filters) && (
          <button
            onClick={clearFilters}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-100"
          >
            Clear all filters
          </button>
        )}
      </div>
    </aside>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex-1 text-slate-700">
        {label}
        <span className="ml-1 text-[10px] text-slate-400">{hint}</span>
      </span>
    </label>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</div>
}
