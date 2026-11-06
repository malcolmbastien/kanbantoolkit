import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { noteMatch, searchHits, type SearchHit } from '@/domain/search'
import { effectiveStage } from '@/domain/lanes'
import { fetchNoteHits, type NoteEntry } from '@/lib/history'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { DueChip } from './DueChip'

/** What the second line is telling the reader: where the word was found. */
const SEARCH_FIELD_LABEL: Record<SearchHit['match']['field'], string> = {
  title: 'Title',
  description: 'Description',
  link: 'Link',
  note: 'Comment',
}

/**
 * Global search across every board. Typing shows matches grouped by board;
 * choosing one opens that board and the item panel. Keyboard: ↑/↓ to move,
 * Enter to open, Esc to dismiss.
 */
export function GlobalSearch() {
  const items = useStore((s) => s.items)
  const boards = useStore((s) => s.boards)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const search = useStore((s) => s.search)
  const setSearch = useStore((s) => s.setSearch)
  const selectBoard = useStore((s) => s.selectBoard)
  const openItem = useStore((s) => s.openItem)

  const [open, setOpen] = useState(true)
  const [active, setActive] = useState(0)
  // Notes the server holds that this browser's cards may not: the workspace document no longer
  // carries history, so a note search asks for the matching notes instead of walking every card.
  // A deployment with no server answers nothing and the local cards remain the whole search.
  const [remoteNotes, setRemoteNotes] = useState<NoteEntry[]>([])
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // "/" focuses the box, for anyone who does not know ⌘K yet. It never steals a keystroke
  // from a field — typing a slash into a title stays typing a slash into a title.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      inputRef.current?.focus()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])


  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) {
      setRemoteNotes([])
      return
    }
    let live = true
    const timer = setTimeout(() => {
      void fetchNoteHits(q).then((notes) => {
        if (live) setRemoteNotes(notes ?? [])
      })
    }, 180)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [search])

  // Group matches by the board the item sits on (first placement).
  const groups = useMemo(() => {
    const local = searchHits(items, search)
    const matched = new Set(local.map((hit) => hit.item.id))
    const byId = new Map(items.map((item) => [item.id, item]))
    const fromNotes: SearchHit[] = []
    for (const note of remoteNotes) {
      if (matched.has(note.itemId)) continue
      const item = byId.get(note.itemId)
      const match = item ? noteMatch(note.entry, search) : undefined
      if (item && match) {
        fromNotes.push({ item, match })
        matched.add(item.id)
      }
    }
    const matches = [...local, ...fromNotes]
    const byBoard = new Map<string, { boardId: string; name: string; items: SearchHit[] }>()
    for (const hit of matches) {
      const boardId = placements.find((p) => p.itemId === hit.item.id)?.boardId ?? '__none__'
      if (!byBoard.has(boardId)) {
        byBoard.set(boardId, { boardId, name: boards.find((b) => b.id === boardId)?.name ?? 'Not on a board', items: [] })
      }
      byBoard.get(boardId)!.items.push(hit)
    }
    return [...byBoard.values()]
  }, [search, items, placements, boards, remoteNotes])

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  useEffect(() => setActive(0), [search])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const choose = (id: string) => {
    const boardId = placements.find((p) => p.itemId === id)?.boardId
    if (boardId && boards.some((b) => b.id === boardId)) selectBoard(boardId)
    openItem(id)
    setSearch('')
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(0, flat.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (flat[active]) choose(flat[active].item.id)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showResults = open && search.trim().length > 0

  return (
    <div className="relative" ref={boxRef}>
      <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search all boards…"
        title="Search every board. ⌘K opens the command palette."
        className="w-44 rounded-md border border-slate-200 bg-white py-1 pl-7 pr-2 text-meta text-slate-800 placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-indigo-400"
      />
      {showResults && (
        <div className="absolute right-0 z-50 mt-1 max-h-[70vh] w-80 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-xl">
          {flat.length === 0 && <div className="px-3 py-2 text-meta text-slate-600">No matches.</div>}
          {groups.map((g) => (
            <div key={g.boardId}>
              <div className="sticky top-0 bg-white/95 px-3 py-1 text-micro font-bold uppercase tracking-wide text-slate-600">
                {g.name}
              </div>
              {g.items.map((hit) => {
                const idx = flat.indexOf(hit)
                // The same reading a card gets: a hit that is already in Done keeps its date and
                // stops speaking in rose, so a search cannot call finished work late.
                const placement = placements.find((p) => p.itemId === hit.item.id)
                const complete = placement ? effectiveStage(lanes, placement.laneId) === 'done' : false
                return (
                  <button
                    key={hit.item.id}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => choose(hit.item.id)}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left transition',
                      idx === active ? 'bg-indigo-50' : 'hover:bg-slate-50',
                    )}
                  >
                    <span className="flex w-full min-w-0 items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-meta text-slate-800">{hit.item.title}</span>
                      <DueChip item={hit.item} complete={complete} />
                    </span>
                    {hit.match.field !== 'title' && (
                      <span data-search-match className="line-clamp-2 text-micro leading-snug text-slate-600">
                        <span className="font-semibold uppercase tracking-wide text-slate-500">
                          {SEARCH_FIELD_LABEL[hit.match.field]}
                        </span>{' '}
                        {hit.match.before}
                        <mark className="rounded-sm bg-amber-100 px-px font-semibold text-slate-900">{hit.match.matched}</mark>
                        {hit.match.after}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
