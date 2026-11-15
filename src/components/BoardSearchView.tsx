import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react'
import { boardInitiatives, itemsOnBoard, NONE_TYPE_ID, tagsOf } from '@/domain/board'
import {
  BOARD_SEARCH_PAGE_SIZE,
  pageOf,
  searchBoard,
  sortBoardSearchHits,
  type BoardSearchHit,
  type BoardSearchNote,
  type BoardSearchSort,
} from '@/domain/boardSearch'
import { activeFilterCount } from '@/domain/filters'
import { STAGES, STAGE_LABELS } from '@/domain/lanes'
import { fetchNoteHits } from '@/lib/history'
import { chipColors, STAGE_PILL } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Stage } from '@/domain/types'
import { DueChip } from './DueChip'
import { PersonAvatar } from './PersonAvatar'
import { PriorityBadge } from './PriorityBadge'

/** What the sort control says, and what the result summary announces. */
const SORT_LABEL: Record<BoardSearchSort, string> = {
  relevance: 'Relevance',
  title: 'Title',
  newest: 'Newest',
}

const SEARCH_FIELD_LABEL: Record<BoardSearchHit['match']['field'], string> = {
  title: 'Title',
  description: 'Description',
  link: 'Link',
  note: 'Comment',
}

const NO_STAGE: Stage | 'all' = 'all'

/**
 * Search this board's live work.
 *
 * The top-bar finder is a jump; this is the review surface. One query over the board's own cards
 * and initiatives, the board's filters alongside it, and a table of the metadata a reader needs to
 * judge a result without opening it. A row is a way into the card; the search stays behind the
 * drawer, so a reader can come back to the set.
 */
export function BoardSearchView({ boardId }: { boardId: string }) {
  const boards = useStore((s) => s.boards)
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)
  const users = useStore((s) => s.users)
  const filters = useStore((s) => s.filters)
  const setFilters = useStore((s) => s.setFilters)
  const clearFilters = useStore((s) => s.clearFilters)
  const query = useStore((s) => s.boardSearch)
  const setBoardSearch = useStore((s) => s.setBoardSearch)
  const openItem = useStore((s) => s.openItem)

  const board = boards.find((b) => b.id === boardId)
  const graph = useMemo(() => ({ items, edges, links, placements, lanes }), [items, edges, links, placements, lanes])
  const boardItems = useMemo(
    () => itemsOnBoard(boardId, placements, items).filter((item) => !item.archived),
    [boardId, placements, items],
  )
  // Search reads initiatives as well as cards, so its type filter offers the workspace's whole
  // vocabulary — None first, then the order the workspace keeps.
  const types = [...issueTypes].sort((a, b) =>
    a.id === NONE_TYPE_ID ? -1 : b.id === NONE_TYPE_ID ? 1 : 0,
  )
  const typeOf = (typeId: string) => issueTypes.find((type) => type.id === typeId) ?? { id: typeId, name: 'No type', color: '#64748b' }
  const initiativesHere = useMemo(
    () => boardInitiatives(graph, boardId, issueTypes).sort((a, b) => a.title.localeCompare(b.title)),
    [boardId, graph, issueTypes],
  )
  const assignedHere = users.filter((user) => boardItems.some((item) => (item.assignees ?? []).includes(user.id)))
  const tagsHere = [...new Map(boardItems.flatMap((item) => tagsOf(boards, item)).map((tag) => [tag.id, tag])).values()].sort(
    (a, b) => a.name.localeCompare(b.name),
  )

  const [stage, setStage] = useState<Stage | 'all'>(NO_STAGE)
  const [sort, setSort] = useState<BoardSearchSort>('relevance')
  const [page, setPage] = useState(0)
  const [active, setActive] = useState(-1)
  const [notes, setNotes] = useState<BoardSearchNote[]>([])
  const [notesState, setNotesState] = useState<'idle' | 'loading' | 'ready'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)
  const filtersKey = JSON.stringify(filters)

  // A new reading starts at the top: a page number from the previous words is not a place in these.
  useEffect(() => {
    setPage(0)
    setActive(-1)
  }, [query, filtersKey, stage, sort, boardId])

  // A page is a new set of rows; a highlighted row from the previous page is not on this one.
  useEffect(() => setActive(-1), [page])

  // "/" focuses the board search, the same habit the global finder has. The global finder leaves
  // the key alone while this view is open, so the two cannot fight over the caret.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const element = document.activeElement as HTMLElement | null
      if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable)) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Notes are the one field the browser may not hold. The server answers the notes on this board's
  // work; a static deployment answers nothing, and the local logs remain the whole search.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setNotes([])
      setNotesState('idle')
      return
    }
    let live = true
    setNotes([])
    setNotesState('loading')
    const timer = setTimeout(() => {
      void fetchNoteHits(q, boardId).then((answer) => {
        if (!live) return
        setNotes(answer ?? [])
        setNotesState('ready')
      })
    }, 180)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, boardId])

  const hits = useMemo(
    () => searchBoard({ boardId, query, items, placements, lanes, edges, links, issueTypes, filters, notes, stage }),
    [boardId, query, items, placements, lanes, edges, links, issueTypes, filters, notes, stage],
  )
  const ordered = useMemo(() => sortBoardSearchHits(hits, sort), [hits, sort])
  const shown = useMemo(() => pageOf(ordered, page, BOARD_SEARCH_PAGE_SIZE), [ordered, page])
  const now = Date.now()

  useEffect(() => {
    if (!shown.rows[active]) return
    document.getElementById(`board-search-row-${shown.rows[active].item.id}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, shown.rows])

  const open = (id: string) => openItem(id)

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (shown.rows.length) setActive((current) => Math.min(current + 1, shown.rows.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      const hit = shown.rows[active]
      if (hit) {
        event.preventDefault()
        open(hit.item.id)
      }
    }
  }

  const filtersOn = activeFilterCount({ ...filters, text: undefined }) > 0 || stage !== 'all'
  const clearEverything = () => {
    clearFilters()
    setStage(NO_STAGE)
  }

  const summary =
    query.trim().length === 0
      ? `${boardItems.length} live item${boardItems.length === 1 ? '' : 's'} on this board`
      : `${shown.total} result${shown.total === 1 ? '' : 's'} for “${query.trim()}” · Sorted by ${SORT_LABEL[sort]}${
          notesState === 'loading' ? ' · searching comments…' : ''
        }`

  return (
    <div data-board-search className="h-full min-h-0 overflow-auto bg-slate-200 p-4" data-board-id={boardId}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
        <section className="rounded-lg border border-slate-300 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex min-w-[260px] flex-1 items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-indigo-50 text-indigo-700">
                <Search size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <label htmlFor="board-search-field" className="text-meta font-semibold text-slate-800">
                  Search {board?.name ?? 'this board'}
                </label>
                <input
                  id="board-search-field"
                  ref={inputRef}
                  data-board-search-input
                  type="search"
                  value={query}
                  onChange={(event) => setBoardSearch(event.target.value)}
                  onKeyDown={onKeyDown}
                  aria-describedby="board-search-summary"
                  placeholder="Title, description, link or comment…"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-body text-slate-800 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-meta text-slate-600">
              Sort
              <select
                aria-label="Sort search results"
                value={sort}
                onChange={(event) => setSort(event.target.value as BoardSearchSort)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-meta text-slate-700"
              >
                <option value="relevance">Relevance</option>
                <option value="title">Title</option>
                <option value="newest">Newest</option>
              </select>
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-slate-600">
            <p id="board-search-summary" role="status" aria-live="polite" data-board-search-summary className="min-w-0 flex-1">
              {summary}
            </p>
            <span className="text-micro text-slate-500">Press / to search · ↑↓ to move · Enter to open</span>
          </div>
        </section>

        <section aria-label="Search filters" className="rounded-lg border border-slate-300 bg-white px-3 py-2 shadow-sm">
          <div className="flex flex-wrap items-end gap-2">
            <FilterSelect
              label="Type"
              value={filters.typeIds.length > 1 ? '__many__' : filters.typeIds[0] ?? ''}
              onValue={(value) => setFilters({ typeIds: value && value !== '__many__' ? [value] : [] })}
              options={[
                { value: '', label: 'All types' },
                ...(filters.typeIds.length > 1 ? [{ value: '__many__', label: `${filters.typeIds.length} types` }] : []),
                ...types.map((type) => ({ value: type.id, label: type.name })),
              ]}
            />
            <FilterSelect
              label="Person"
              value={filters.assigneeIds.length > 1 ? '__many__' : filters.unassigned ? '__unassigned__' : filters.assigneeIds[0] ?? ''}
              onValue={(value) =>
                setFilters(
                  value === '__unassigned__'
                    ? { unassigned: true, assigneeIds: [] }
                    : { unassigned: false, assigneeIds: value && value !== '__many__' ? [value] : [] },
                )
              }
              options={[
                { value: '', label: 'Anyone' },
                ...(filters.assigneeIds.length > 1 ? [{ value: '__many__', label: `${filters.assigneeIds.length} people` }] : []),
                { value: '__unassigned__', label: 'Unassigned' },
                ...assignedHere.map((user) => ({ value: user.id, label: user.name })),
              ]}
            />
            <FilterSelect
              label="Priority"
              value={filters.priorities.length > 1 ? '__many__' : filters.priorities[0] ?? ''}
              onValue={(value) => setFilters({ priorities: value && value !== '__many__' ? [value] : [] })}
              options={[
                { value: '', label: 'Any priority' },
                ...(filters.priorities.length > 1 ? [{ value: '__many__', label: `${filters.priorities.length} priorities` }] : []),
                { value: 'urgent', label: 'Urgent' },
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'low', label: 'Low' },
              ]}
            />
            <FilterSelect
              label="Tag"
              value={filters.tagIds.length > 1 ? '__many__' : filters.tagIds[0] ?? ''}
              onValue={(value) => setFilters({ tagIds: value && value !== '__many__' ? [value] : [] })}
              options={[
                { value: '', label: 'Any tag' },
                ...(filters.tagIds.length > 1 ? [{ value: '__many__', label: `${filters.tagIds.length} tags` }] : []),
                ...tagsHere.map((tag) => ({ value: tag.id, label: tag.name })),
              ]}
            />
            <FilterSelect
              label="Initiative"
              value={filters.initiativeId ?? ''}
              onValue={(value) => setFilters({ initiativeId: value || undefined })}
              options={[
                { value: '', label: 'Any initiative' },
                ...initiativesHere.map((initiative) => ({ value: initiative.id, label: initiative.title })),
              ]}
            />
            <FilterSelect
              label="Age"
              value={filters.minAgeDays === undefined ? '' : String(filters.minAgeDays)}
              onValue={(value) => setFilters({ minAgeDays: value ? Number(value) : undefined })}
              options={[
                { value: '', label: 'Any age' },
                { value: '7', label: '7+ days' },
                { value: '14', label: '14+ days' },
                { value: '30', label: '30+ days' },
              ]}
            />
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Stage">
              <span className="mr-1 text-micro font-semibold uppercase tracking-wide text-slate-500">Stage</span>
              {(['all', ...STAGES] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={stage === value}
                  onClick={() => setStage(value)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-micro font-medium transition',
                    stage === value
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  {value === 'all' ? 'All' : STAGE_LABELS[value]}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusToggle label="Blocked" checked={filters.blocked} onChange={(blocked) => setFilters({ blocked })} />
            <StatusToggle label="Overdue" checked={filters.overdue} onChange={(overdue) => setFilters({ overdue })} />
            <StatusToggle label="Due soon" checked={filters.dueSoon} onChange={(dueSoon) => setFilters({ dueSoon })} />
            <span className="ml-auto flex items-center gap-1.5 text-micro text-slate-500">
              <SlidersHorizontal size={12} />
              {filtersOn ? 'Filters narrow the results' : 'No filters'}
            </span>
            {filtersOn && (
              <button
                type="button"
                onClick={clearEverything}
                className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-micro font-medium text-slate-600 hover:bg-slate-50"
              >
                <X size={11} /> Clear filters
              </button>
            )}
          </div>
        </section>

        {query.trim().length === 0 ? (
          <EmptyState
            title="Search this board’s live work"
            body="Type a word from a title, description, external link or comment. The board’s filters can narrow the set; archived work lives in the Archive."
          />
        ) : boardItems.length === 0 ? (
          <EmptyState title="Nothing live to search here" body="This board has no cards or initiatives in play. Filed-away work is in the Archive." />
        ) : shown.total === 0 ? (
          notesState === 'loading' ? (
            <EmptyState title="Searching comments…" body={`Looking for “${query.trim()}” beyond this browser’s copy of the cards.`} />
          ) : (
            <EmptyState
              title={`No results for “${query.trim()}”`}
              body={
                filtersOn
                  ? 'Nothing on this board matches both the query and the filters. Try clearing a filter.'
                  : query.trim().length < 2
                    ? 'Try a longer word: comments are searched from two characters.'
                    : 'Nothing on this board has those words in a title, description, link or comment.'
              }
            />
          )
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left">
                <caption className="sr-only">
                  Search results for {query.trim()} on {board?.name ?? 'this board'}
                </caption>
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100 text-micro uppercase tracking-wide text-slate-600">
                    <th scope="col" className="px-4 py-2 font-semibold">Item</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                    <th scope="col" className="px-3 py-2 font-semibold">People</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Priority</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Due</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Created</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.rows.map((hit, index) => {
                    const assignees = (hit.item.assignees ?? []).map((id) => users.find((user) => user.id === id))
                    const tags = tagsOf(boards, hit.item)
                    const type = typeOf(hit.item.typeId)
                    return (
                      <tr
                        key={hit.item.id}
                        id={`board-search-row-${hit.item.id}`}
                        data-search-row={hit.item.id}
                        data-search-match={hit.match.field}
                        data-search-active={index === active ? '' : undefined}
                        onClick={() => open(hit.item.id)}
                        className={cn(
                          'cursor-pointer border-b border-slate-100 align-top last:border-0 transition',
                          index === active ? 'bg-indigo-50' : 'hover:bg-slate-50',
                        )}
                      >
                        <td className="max-w-[420px] px-4 py-2.5">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span
                              className="shrink-0 rounded px-1 py-px text-micro font-bold uppercase tracking-wide"
                              style={{ backgroundColor: chipColors(type.color).background, color: chipColors(type.color).color }}
                            >
                              {type.name}
                            </span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                open(hit.item.id)
                              }}
                              data-search-open={hit.item.id}
                              className="min-w-0 truncate text-left text-body font-semibold text-slate-800 hover:text-indigo-600"
                            >
                              {hit.item.title}
                            </button>
                            {hit.item.blocked && <span className="rounded bg-rose-100 px-1 py-px text-micro font-bold text-rose-700">Blocked</span>}
                          </div>
                          {hit.match.field !== 'title' && (
                            <p data-search-match-text className="mt-1 line-clamp-2 text-meta leading-snug text-slate-600">
                              <span className="font-semibold uppercase tracking-wide text-slate-500">
                                {SEARCH_FIELD_LABEL[hit.match.field]}
                              </span>{' '}
                              {hit.match.before}
                              <mark className="rounded-sm bg-amber-100 px-px font-semibold text-slate-900">{hit.match.matched}</mark>
                              {hit.match.after}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={cn(
                              'inline-block max-w-[150px] truncate rounded px-1.5 py-0.5 text-micro font-semibold',
                              hit.stage ? STAGE_PILL[hit.stage] : 'bg-slate-100 text-slate-600',
                            )}
                            title={hit.status}
                          >
                            {hit.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          {assignees.length === 0 ? (
                            <span className="text-meta text-slate-500">—</span>
                          ) : (
                            <span className="flex items-center -space-x-1">
                              {assignees.slice(0, 4).map((user, position) =>
                                user ? (
                                  <PersonAvatar key={user.id} user={user} small />
                                ) : (
                                  <span
                                    key={`gone-${position}`}
                                    title="Former member"
                                    className="grid h-4 w-4 place-items-center rounded-full bg-slate-200 text-micro font-bold text-slate-600"
                                  >
                                    ?
                                  </span>
                                ),
                              )}
                              {assignees.length > 4 && (
                                <span className="ml-1 text-micro text-slate-500" title={assignees.map((user) => user?.name ?? 'Former member').join(', ')}>
                                  +{assignees.length - 4}
                                </span>
                              )}
                              <span className="sr-only">
                                {assignees.map((user) => user?.name ?? 'Former member').join(', ')}
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {hit.item.priority ? (
                            <PriorityBadge priority={hit.item.priority} />
                          ) : (
                            <span className="text-meta text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <DueChip item={hit.item} complete={hit.resolved} />
                          {!hit.resolved && !hit.item.dueDate && hit.placement?.laneEnteredAt && (
                            <span className="text-micro text-slate-600">{Math.max(0, Math.floor((now - hit.placement.laneEnteredAt) / 86_400_000))}d in lane</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-meta text-slate-600">
                          {new Date(hit.item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td className="px-3 py-2.5">
                          {tags.length === 0 ? (
                            <span className="text-meta text-slate-500">—</span>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              {tags.slice(0, 3).map((tag) => {
                                const colors = chipColors(tag.color)
                                return (
                                  <span
                                    key={tag.id}
                                    title={tag.name}
                                    className="max-w-[120px] truncate rounded px-1 py-px text-micro font-semibold"
                                    style={{ backgroundColor: colors.background, color: colors.color }}
                                  >
                                    {tag.name}
                                  </span>
                                )
                              })}
                              {tags.length > 3 && (
                                <span className="text-micro text-slate-500" title={tags.map((tag) => tag.name).join(', ')}>
                                  +{tags.length - 3}
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {(shown.pages > 1 || shown.total > 0) && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 text-meta text-slate-600">
                <span data-search-page role="status" aria-live="polite">
                  {shown.total} result{shown.total === 1 ? '' : 's'} · Page {shown.page} of {shown.pages}
                </span>
                <nav aria-label="Search result pages" className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(0, current - 1))}
                    disabled={shown.page <= 1}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-meta font-medium text-slate-600 disabled:opacity-40"
                  >
                    <ChevronLeft size={12} /> Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(shown.pages - 1, current + 1))}
                    disabled={shown.page >= shown.pages}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-meta font-medium text-slate-600 disabled:opacity-40"
                  >
                    Next <ChevronRight size={12} />
                  </button>
                </nav>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div data-search-empty className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm">
      <Search size={24} className="mx-auto text-slate-400" />
      <div className="mt-2 text-heading font-semibold text-slate-800">{title}</div>
      <p className="mx-auto mt-1 max-w-xl text-meta text-slate-600">{body}</p>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onValue,
  options,
}: {
  label: string
  value: string
  onValue: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="flex flex-col gap-0.5 text-micro font-semibold uppercase tracking-wide text-slate-500">
      {label}
      <select
        aria-label={`Filter by ${label.toLowerCase()}`}
        value={value}
        onChange={(event) => onValue(event.target.value)}
        className="min-w-[110px] rounded border border-slate-300 bg-white px-2 py-1 text-meta font-normal normal-case tracking-normal text-slate-700"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function StatusToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'rounded-full border px-2 py-0.5 text-micro font-medium transition',
        checked ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
      )}
    >
      {label}
    </button>
  )
}
