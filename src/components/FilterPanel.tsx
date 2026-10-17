import { X, Plus } from 'lucide-react'
import { cardTypes, initiativeTypeId } from '@/domain/board'
import { lineageOf, statusOf, type Graph } from '@/domain/derive'
import { activeFilterCount, ageDays, hasActiveFilters, initiativeScope, matchesFilters, sameFilters, type SavedFilter } from '@/domain/filters'
import { PRIORITY_META, PRIORITY_ORDER, type Priority } from './PriorityBadge'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { useState } from 'react'
import type { Item } from '@/domain/types'

/**
 * The board filter panel — a right-side panel (like the item panel) with a few
 * basic filters: a text query, one per card type, plus blocked / overdue / due soon,
 * and the named filter sets a board can re-apply.
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
  const savedFilters = useStore((s) => s.savedFilters)
  const saveFilter = useStore((s) => s.saveFilter)
  const applySavedFilter = useStore((s) => s.applySavedFilter)
  const removeSavedFilter = useStore((s) => s.removeSavedFilter)

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
  const scope = initiativeScope(filters, graph)
  const matched = boardCards.filter((i) =>
    matchesFilters(i, filters, statusOf(i.id, graph).resolved, Date.now(), ageDays(placementOf(i.id)), scope),
  ).length
  const users = useStore((s) => s.users)
  // Only the people who actually hold work here: a filter list of the whole org is noise.
  const assignedHere = users.filter((u) => boardCards.some((c) => (c.assignees ?? []).includes(u.id)))

  // A board's own presets, plus any saved before presets belonged to a board — those stay
  // available everywhere rather than being claimed for one board after the fact.
  const presets = savedFilters.filter((s) => !s.boardId || s.boardId === boardId)

  // The initiatives this board's cards roll up to, with how many cards each holds, so the
  // choice shows what it will narrow to before it is made.
  const initiativesHere = (() => {
    const counts = new Map<string, number>()
    for (const c of boardCards) {
      for (const ancestor of lineageOf(c.id, graph)) {
        if (ancestor.typeId !== initiativeId) continue
        counts.set(ancestor.id, (counts.get(ancestor.id) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ id, count, name: items.find((i) => i.id === id)?.title ?? 'Initiative' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })()

  const [saveName, setSaveName] = useState('')

  return (
    <aside className="flex h-full w-full max-w-[340px] shrink-0 flex-col border-l border-slate-300 bg-slate-50">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-title font-semibold text-slate-800">Filters</div>
          <div className="text-meta text-slate-600">Narrow the cards shown on this board</div>
        </div>
        <button onClick={toggleFilters} className="text-slate-600 hover:text-slate-600" title="Close filters">
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-meta">
        <div
          className={cn(
            'rounded-md px-2.5 py-1.5 text-meta',
            hasActiveFilters(filters) ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600',
          )}
        >
          {hasActiveFilters(filters)
            ? `Showing ${matched} of ${boardCards.length} cards · ${active} filter${active === 1 ? '' : 's'} active`
            : `${boardCards.length} cards on this board`}
        </div>

        <SavedSection
          saved={presets}
          activeId={presets.find((s) => sameFilters(s.filters, filters))?.id}
          onApply={applySavedFilter}
          onRemove={removeSavedFilter}
          name={saveName}
          onName={setSaveName}
          onSave={() => {
            saveFilter(saveName)
            setSaveName('')
          }}
          canSave={saveName.trim().length > 0 && hasActiveFilters(filters)}
        />
        <section>
          <SectionLabel>Text</SectionLabel>
          <input
            type="search"
            value={filters.text ?? ''}
            onChange={(e) => setFilters({ text: e.target.value })}
            placeholder="Contains — title or description"
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-meta text-slate-700 placeholder:text-slate-400"
          />
          <p className="mt-1 text-micro text-slate-600">
            Case doesn't matter. Clearing the field shows every card again.
          </p>
        </section>

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
          <p className="mt-1 text-micro text-slate-600">No type checked shows every type.</p>
        </section>

        <section>
          <SectionLabel>Initiative</SectionLabel>
          {initiativesHere.length === 0 ? (
            <p className="text-micro text-slate-600">
              No cards on this board sit under an initiative yet — connect a card to one and it appears here.
            </p>
          ) : (
            <>
              <select
                value={filters.initiativeId ?? ''}
                onChange={(e) => setFilters({ initiativeId: e.target.value || undefined })}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-meta text-slate-700"
              >
                <option value="">Any initiative</option>
                {initiativesHere.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.count})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-micro text-slate-600">
                Narrows to the work under one initiative, however deep. Cards that roll up to no initiative are
                excluded.
              </p>
            </>
          )}
        </section>

        <section>
          <SectionLabel>Assignee</SectionLabel>
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
            {/* "No one" is a pseudo-entry in the same list, not a separate switch: one concept,
                one control — and it composes, so picking a person and it shows both. */}
            <label className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50">
              <input type="checkbox" checked={filters.unassigned} onChange={(e) => setFilters({ unassigned: e.target.checked })} />
              <span className="flex-1 italic text-slate-600">Unassigned</span>
            </label>
          </div>
          <p className="mt-1 text-micro text-slate-600">Nothing checked shows every card; the picked people and "Unassigned" combine.</p>
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
          <p className="mt-1 text-micro text-slate-600">Cards with no priority are shown by any selection.</p>
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
                    'rounded-lg border px-2 py-1 text-meta font-medium transition',
                    on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
                  )}
                >
                  {d === undefined ? 'Any age' : `${d}+ days`}
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-micro text-slate-600">
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
              label="Due soon"
              hint="target date within a week, not done"
              checked={filters.dueSoon}
              onChange={(v) => setFilters({ dueSoon: v })}
            />
          </div>
        </section>

        {hasActiveFilters(filters) && (
          <button
            onClick={clearFilters}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-meta font-medium text-slate-600 hover:bg-slate-100"
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
        <span className="ml-1 text-micro text-slate-600">{hint}</span>
      </span>
    </label>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-meta font-semibold uppercase tracking-wide text-slate-600">{children}</div>
}

function SavedSection({
  saved,
  activeId,
  onApply,
  onRemove,
  name,
  onName,
  onSave,
  canSave,
}: {
  saved: SavedFilter[]
  /** The saved set that matches what is currently active, if any. */
  activeId?: string
  onApply: (id: string) => void
  onRemove: (id: string) => void
  name: string
  onName: (n: string) => void
  onSave: () => void
  canSave: boolean
}) {
  return (
    <section>
      <SectionLabel>Saved filters</SectionLabel>
      {saved.length === 0 ? (
        <p className="text-micro text-slate-600">Nothing saved yet. Set some filters below, then name and save them here.</p>
      ) : (
        <div className="space-y-1">
          {saved.map((s) => (
            <div key={s.id} className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1">
              <button
                onClick={() => onApply(s.id)}
                className={cn(
                  'min-w-0 flex-1 truncate text-left text-slate-700',
                  s.id === activeId && 'font-semibold text-indigo-700',
                )}
                title={`Apply the ${s.name} filters`}
              >
                {s.name}
              </button>
              {!s.boardId && (
                <span
                  className="shrink-0 rounded bg-slate-100 px-1 text-micro text-slate-600"
                  title="Saved before presets belonged to a board, so it stays available on every board"
                >
                  shared
                </span>
              )}
              <button onClick={() => onRemove(s.id)} className="shrink-0 text-slate-400 hover:text-slate-700" title={`Forget ${s.name}`}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-1">
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSave) onSave()
          }}
          placeholder="Name these filters"
          className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-meta text-slate-700 placeholder:text-slate-400"
        />
        <button
          onClick={onSave}
          disabled={!canSave}
          className="flex shrink-0 items-center gap-1 rounded-md border border-indigo-300 bg-white px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-50 disabled:pointer-events-none disabled:opacity-40"
          title="Save the active filters under this name"
        >
          <Plus size={12} /> Save
        </button>
      </div>
    </section>
  )
}
