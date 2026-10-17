import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { buildRefs, searchItems } from '@/domain/board'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Item } from '@/domain/types'

/**
 * Global search across every board. Typing shows matches grouped by board;
 * choosing one opens that board and the item panel. Keyboard: ↑/↓ to move,
 * Enter to open, Esc to dismiss.
 */
export function GlobalSearch() {
  const items = useStore((s) => s.items)
  const boards = useStore((s) => s.boards)
  const placements = useStore((s) => s.placements)
  const issueTypes = useStore((s) => s.issueTypes)
  const search = useStore((s) => s.search)
  const setSearch = useStore((s) => s.setSearch)
  const selectBoard = useStore((s) => s.selectBoard)
  const openItem = useStore((s) => s.openItem)

  const [open, setOpen] = useState(true)
  const [active, setActive] = useState(0)
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

  const refs = useMemo(() => buildRefs(items, issueTypes), [items, issueTypes])

  // Group matches by the board the item sits on (first placement).
  const groups = useMemo(() => {
    const matches = searchItems(items, refs, search)
    const byBoard = new Map<string, { boardId: string; name: string; items: Item[] }>()
    for (const i of matches) {
      const boardId = placements.find((p) => p.itemId === i.id)?.boardId ?? '__none__'
      if (!byBoard.has(boardId)) {
        byBoard.set(boardId, { boardId, name: boards.find((b) => b.id === boardId)?.name ?? 'Not on a board', items: [] })
      }
      byBoard.get(boardId)!.items.push(i)
    }
    return [...byBoard.values()]
  }, [search, items, placements, boards, refs])

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
      if (flat[active]) choose(flat[active].id)
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
        title="Search every board by title or ref — or press ⌘K for the command palette"
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
              {g.items.map((i) => {
                const idx = flat.indexOf(i)
                return (
                  <button
                    key={i.id}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => choose(i.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left transition',
                      idx === active ? 'bg-indigo-50' : 'hover:bg-slate-50',
                    )}
                  >
                    <span className="shrink-0 text-micro font-semibold tabular-nums text-slate-600">{refs.get(i.id)}</span>
                    <span className="min-w-0 flex-1 truncate text-meta text-slate-800">{i.title}</span>
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
