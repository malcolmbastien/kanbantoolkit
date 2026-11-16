import { Minus, Plus, X } from 'lucide-react'
import { boardInitiatives, boardTags, cardTypes, initiativeTypeId, NONE_TYPE_ID, tagsOf } from '@/domain/board'
import { lineageOf, statusOf, type Graph } from '@/domain/derive'
import { effectiveStage } from '@/domain/lanes'
import { lateStartDay } from '@/domain/due'
import { cardsFlows } from '@/domain/flows'
import { ageDays, hasActiveFilters, initiativeScope, isDueSoon, isOverdue, matchesFilters, sameFilters, type SavedFilter } from '@/domain/filters'
import { PRIORITY_META, PRIORITY_ORDER, type Priority } from './PriorityBadge'
import { chipColors } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { announce } from '@/lib/announce'
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
  const boards = useStore((s) => s.boards)
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)
  const filters = useStore((s) => s.filters)
  const filterDisplay = useStore((s) => s.filterDisplay)
  const setFilterDisplay = useStore((s) => s.setFilterDisplay)
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
  const initiativeId = initiativeTypeId(issueTypes)

  // The cards this board shows (same set the cards workflow renders).
  const boardCards = placements
    .filter((p) => p.boardId === boardId)
    .map((p) => items.find((i) => i.id === p.itemId))
    .filter((i): i is Item => Boolean(i))
    .filter((i) => !i.archived && i.typeId !== initiativeId)
  const placementOf = (id: string) => placements.find((p) => p.itemId === id && p.boardId === boardId)
  const stageOfCard = (id: string) => {
    const placement = placementOf(id)
    return placement ? effectiveStage(lanes, placement.laneId) : undefined
  }
  const now = Date.now()
  const cardInfo = boardCards.map((item) => ({
    item,
    stage: stageOfCard(item.id),
    resolved: statusOf(item.id, graph).resolved,
    age: ageDays(placementOf(item.id), now),
  }))
  const scope = initiativeScope(filters, graph)
  const matched = cardInfo.filter((info) =>
    matchesFilters(info.item, filters, info.resolved, now, info.age, scope, info.stage),
  ).length
  const users = useStore((s) => s.users)

  // What each choice would find among the cards this board actually carries. A choice with no
  // active card stays visible but dimmed, so a reader can see the vocabulary without being offered
  // a filter that can only empty the board. Assignees are the exception: only people already on
  // this board's work are listed, because the whole directory would be noise.
  const typeCounts = new Map<string, number>()
  const priorityCounts = new Map<string, number>()
  const tagCounts = new Map<string, number>()
  const assigneeCounts = new Map<string, number>()
  const ageCounts = new Map<number, number>()
  let blockedCount = 0
  let overdueCount = 0
  let dueSoonCount = 0
  let lateStartCount = 0
  let unassignedCount = 0
  let unownedCount = 0
  for (const info of cardInfo) {
    const { item } = info
    typeCounts.set(item.typeId, (typeCounts.get(item.typeId) ?? 0) + 1)
    if (item.priority) priorityCounts.set(item.priority, (priorityCounts.get(item.priority) ?? 0) + 1)
    for (const tagId of item.tagIds ?? []) tagCounts.set(tagId, (tagCounts.get(tagId) ?? 0) + 1)
    const assignees = item.assignees ?? []
    if (assignees.length === 0) unassignedCount += 1
    for (const id of assignees) assigneeCounts.set(id, (assigneeCounts.get(id) ?? 0) + 1)
    if (item.blocked) blockedCount += 1
    if (isOverdue(item, info.resolved, now)) overdueCount += 1
    if (isDueSoon(item, info.resolved, now)) dueSoonCount += 1
    if (lateStartDay(item.targetStartDate, info.stage, now)) lateStartCount += 1
    if (info.stage === 'inProgress' && assignees.length === 0) unownedCount += 1
    if (info.age !== undefined) {
      for (const days of [7, 14, 30]) if (info.age >= days) ageCounts.set(days, (ageCounts.get(days) ?? 0) + 1)
    }
  }
  const assignedHere = users.filter((u) => (assigneeCounts.get(u.id) ?? 0) > 0)
  const optionCls = (available: boolean) =>
    cn(
      'flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1',
      available ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed opacity-40',
    )

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
    // The board's own initiatives appear even when nothing under them is on this board: the
    // choice is part of the vocabulary, and a zero count says it would find nothing today.
    for (const initiative of boardInitiatives(graph, boardId, issueTypes)) {
      if (!counts.has(initiative.id)) counts.set(initiative.id, 0)
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ id, count, name: items.find((i) => i.id === id)?.title ?? 'Initiative' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })()

  // A board's own tags are the vocabulary; tags carried by its work are included too, so a tag
  // defined elsewhere but worn here can still narrow. Zero-use tags stay visible and dimmed.
  const tagsHere = (() => {
    const found = new Map<string, { id: string; name: string; color: string }>()
    for (const tag of boardTags(boards.find((b) => b.id === boardId))) found.set(tag.id, tag)
    for (const c of boardCards) for (const tag of tagsOf(boards, c)) found.set(tag.id, tag)
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
  })()

  const [saveName, setSaveName] = useState('')
  const flows = useStore((s) => s.flows)
  const flowsHere = cardsFlows(flows, boardId)

  return (
    <aside data-filters-panel className="flex h-full w-full max-w-[460px] shrink-0 flex-col border-l border-slate-300 bg-slate-50">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-title font-semibold text-slate-800">Card filters</div>
          <div className="text-meta text-slate-600">
            Narrow the cards workflow; initiatives and external work stay as context
            {flowsHere.length > 1 ? ' — every cards flow' : ''}.
          </div>
        </div>
        <button onClick={toggleFilters} className="text-slate-600 hover:text-slate-600" title="Close filters">
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-meta">
        <div
          role="group"
          aria-label="Filter mode"
          title="What happens to cards that do not match the filter"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-meta text-slate-700"
        >
          <span>Filter mode</span>
          <span className="flex overflow-hidden rounded border border-slate-200 bg-slate-50 p-0.5">
            {(['dim', 'hide'] as const).map((display) => (
              <button
                key={display}
                type="button"
                aria-pressed={filterDisplay === display}
                onClick={() => {
                  setFilterDisplay(display)
                  if (hasActiveFilters(filters)) {
                    announce(
                      display === 'dim'
                        ? `${boardCards.length - matched} non-matching card${boardCards.length - matched === 1 ? '' : 's'} dimmed.`
                        : `${boardCards.length - matched} non-matching card${boardCards.length - matched === 1 ? '' : 's'} hidden.`,
                    )
                  }
                }}
                className={cn(
                  'rounded px-2 py-0.5 text-micro font-medium transition',
                  filterDisplay === display ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-white',
                )}
              >
                {display === 'dim' ? 'Dim' : 'Hide'}
              </button>
            ))}
          </span>
        </div>

        <div
          data-filter-summary
          className={cn(
            'rounded-md px-2.5 py-1.5 text-meta',
            hasActiveFilters(filters) ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600',
          )}
        >
          {hasActiveFilters(filters)
            ? filterDisplay === 'dim'
              ? `${matched} of ${boardCards.length} cards match · ${boardCards.length - matched} dimmed`
              : `Showing ${matched} of ${boardCards.length} cards`
            : `${boardCards.length} cards on this board${flowsHere.length > 1 ? `, across ${flowsHere.length} flows` : ''}`}
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
            placeholder="Title or description contains…"
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-meta text-slate-700 placeholder:text-slate-400"
          />
        </section>

        <section>
          <SectionLabel>Card type</SectionLabel>
          <div className="space-y-1">
            {types.map((t) => {
              const on = filters.typeIds.includes(t.id)
              const count = typeCounts.get(t.id) ?? 0
              const available = count > 0 || on
              return (
                <label
                  key={t.id}
                  title={available ? undefined : 'No active card has this type'}
                  className={optionCls(available)}
                >
                  <input type="checkbox" checked={on} disabled={!available} onChange={() => toggleFilterType(t.id)} />
                  {t.id === NONE_TYPE_ID ? (
                    <Minus size={13} className="shrink-0 text-slate-400" />
                  ) : (
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                  )}
                  <span className="flex-1 text-slate-700">{t.name}</span>
                </label>
              )
            })}
          </div>
        </section>

        <section>
          <SectionLabel>Initiative</SectionLabel>
          {initiativesHere.length === 0 ? (
            <p className="text-micro text-slate-600">No card here sits under an initiative yet.</p>
          ) : (
            <>
              <select
                value={filters.initiativeId ?? ''}
                onChange={(e) => setFilters({ initiativeId: e.target.value || undefined })}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-meta text-slate-700"
              >
                <option value="">Any initiative</option>
                {initiativesHere.map((i) => (
                  <option key={i.id} value={i.id} disabled={i.count === 0 && filters.initiativeId !== i.id}>
                    {i.name} ({i.count})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-micro text-slate-600">The work under one initiative, however deep.</p>
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
            <label
              title={unassignedCount > 0 || filters.unassigned ? undefined : 'Every active card has an owner'}
              className={optionCls(unassignedCount > 0 || filters.unassigned)}
            >
              <input
                type="checkbox"
                checked={filters.unassigned}
                disabled={unassignedCount === 0 && !filters.unassigned}
                onChange={(e) => setFilters({ unassigned: e.target.checked })}
              />
              <span className="flex-1 italic text-slate-600">Unassigned</span>
            </label>
          </div>
          <p className="mt-1 text-micro text-slate-600">Only people already on this board are listed. Unassigned adds to the people picked.</p>
        </section>

        <section>
          <SectionLabel>Priority</SectionLabel>
          <div className="space-y-1">
            {PRIORITY_ORDER.map((p) => {
              const on = filters.priorities.includes(p)
              const count = priorityCounts.get(p) ?? 0
              const available = count > 0 || on
              const { label, icon: Icon, dot } = PRIORITY_META[p as Priority]
              return (
                <label
                  key={p}
                  title={available ? undefined : 'No active card has this priority'}
                  className={optionCls(available)}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!available}
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
          <p className="mt-1 text-micro text-slate-600">Cards without a priority always show.</p>
        </section>

        <section>
          <SectionLabel>Tag</SectionLabel>
          {tagsHere.length === 0 ? (
            <p className="text-micro text-slate-600">No tags on this board yet.</p>
          ) : (
            <div className="space-y-1">
              {tagsHere.map((t) => {
                const on = filters.tagIds.includes(t.id)
                const count = tagCounts.get(t.id) ?? 0
                const available = count > 0 || on
                return (
                  <label
                    key={t.id}
                    title={available ? undefined : 'No active card carries this tag'}
                    className={optionCls(available)}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!available}
                      onChange={() =>
                        setFilters({ tagIds: on ? filters.tagIds.filter((x) => x !== t.id) : [...filters.tagIds, t.id] })
                      }
                    />
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: chipColors(t.color).background }} />
                    <span className="flex-1 text-slate-700">{t.name}</span>
                  </label>
                )
              })}
            </div>
          )}
          <p className="mt-1 text-micro text-slate-600">Nothing checked shows every card. Several combine as any of them.</p>
        </section>

        <section>
          <SectionLabel>Time in lane</SectionLabel>
          <div className="flex flex-wrap gap-1">
            {[undefined, 7, 14, 30].map((d) => {
              const on = filters.minAgeDays === d
              const available = d === undefined || (ageCounts.get(d) ?? 0) > 0 || on
              return (
                <button
                  key={String(d)}
                  disabled={!available}
                  title={available ? undefined : 'No active card is that old in its lane'}
                  onClick={() => setFilters({ minAgeDays: d })}
                  className={cn(
                    'rounded-lg border px-2 py-1 text-meta font-medium transition',
                    available ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
                    on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
                  )}
                >
                  {d === undefined ? 'Any age' : `${d}+ days`}
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-micro text-slate-600">
            Age is time in the card's current lane. Cards older than the clock have no age.
          </p>
        </section>

        <section>
          <SectionLabel>Status</SectionLabel>
          <div className="space-y-1">
            <ToggleRow
              label="Blocked"
              hint="explicitly blocked cards"
              checked={filters.blocked}
              disabled={blockedCount === 0 && !filters.blocked}
              onChange={(v) => setFilters({ blocked: v })}
            />
            <ToggleRow
              label="Overdue"
              hint="past due date, not done"
              checked={filters.overdue}
              disabled={overdueCount === 0 && !filters.overdue}
              onChange={(v) => setFilters({ overdue: v })}
            />
            <ToggleRow
              label="Due soon"
              hint="due date within a week, not done"
              checked={filters.dueSoon}
              disabled={dueSoonCount === 0 && !filters.dueSoon}
              onChange={(v) => setFilters({ dueSoon: v })}
            />
            <ToggleRow
              label="Late start"
              hint="planned start passed, not begun"
              checked={filters.lateStart}
              disabled={lateStartCount === 0 && !filters.lateStart}
              onChange={(v) => setFilters({ lateStart: v })}
            />
            <ToggleRow
              label="Unowned"
              hint="in progress with no owner"
              checked={filters.unowned}
              disabled={unownedCount === 0 && !filters.unowned}
              onChange={(v) => setFilters({ unowned: v })}
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
  disabled = false,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label
      title={disabled ? 'No active card carries this state' : undefined}
      className={cn(
        'flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-slate-50',
      )}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
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
        <p className="text-micro text-slate-600">Nothing saved yet. Name a set of filters to keep it here.</p>
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
                  title="Saved before presets were per board, so it shows on every board"
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
