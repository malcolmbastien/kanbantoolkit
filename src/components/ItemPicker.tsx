import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Item } from '@/domain/types'

interface Props {
  /** The items that can be linked here — already sorted the way the list should read. */
  items: Item[]
  /** The board an item is carried by: the context that tells two similar titles apart. */
  boardOf: (itemId: string) => string | undefined
  /** The objective it already serves, when picking it here would move it. */
  movesFrom?: (itemId: string) => string | undefined
  onPick: (itemId: string) => void
  /** The trigger's words. */
  label?: string
  /** What the things in the list are, for the accessible names and the empty states. */
  noun?: string
  /** The sentence shown when there is nothing to pick at all. */
  emptyLabel?: string
  /** The sentence shown when a search matches nothing. */
  noMatchLabel?: string
  /** The trigger's width, when a surface needs it wider or narrower than `w-60`. */
  triggerClassName?: string
}

/** Where the panel sits, in viewport coordinates: it is fixed so no card can clip it. */
interface PanelPosition {
  left: number
  width: number
  top?: number
  bottom?: number
}

/**
 * The control that links one item to another: a compact trigger opening a searchable list, rather
 * than a select the width of a page and a column of bare titles.
 *
 * Two things are deliberate. The panel is **portalled and fixed**, because the surface that owns
 * the trigger — an objective card, or the side drawer — clips its own overflow and a dropdown
 * inside it would be cut off at the edge. And the list is **searched, not scanned**: an item is
 * found by its title or by the board that carries it, which is how someone who works across teams
 * knows the work. The same control maps an initiative to an objective and chooses what a card
 * depends on; only its words differ.
 */
export function ItemPicker({
  items,
  boardOf,
  movesFrom,
  onPick,
  label = 'Map an initiative',
  noun = 'initiative',
  emptyLabel,
  noMatchLabel,
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<PanelPosition>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const listLabel = `${noun[0]?.toUpperCase() ?? ''}${noun.slice(1)}s`

  const needle = query.trim().toLowerCase()
  const rows = needle
    ? items.filter(
        (item) => item.title.toLowerCase().includes(needle) || (boardOf(item.id) ?? '').toLowerCase().includes(needle),
      )
    : items
  // A narrowing search can leave the highlight past the end; the row under it is clamped, not lost.
  const current = rows.length === 0 ? -1 : Math.min(active, rows.length - 1)

  const close = (refocus = false) => {
    setOpen(false)
    setQuery('')
    if (refocus) triggerRef.current?.focus()
  }

  const openPanel = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.min(320, window.innerWidth - 16)
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
    // Room for the search box and a handful of rows. Open upward when the card's footer is low on
    // the screen and there is more room above it.
    const room = 300
    const below = window.innerHeight - rect.bottom
    const above = rect.top
    setPosition(
      below < room && above > below
        ? { left, width, bottom: window.innerHeight - rect.top + 6 }
        : { left, width, top: rect.bottom + 6 },
    )
    setQuery('')
    setActive(0)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close()
    }
    // A fixed panel would otherwise point at where the trigger used to be. Only a scroll that can
    // move the trigger makes that true: the document, or a scrollable ancestor of the trigger. The
    // board scrolling beside the drawer does not move a control inside the drawer, and closing on
    // it made an unrelated smooth scroll dismiss a picker the reader had just opened.
    const onScroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return
      const target = event.target
      if (!(target instanceof Node)) return
      let node: Node | null = triggerRef.current
      while (node) {
        if (node === target) {
          close()
          return
        }
        node = node.parentNode
      }
    }
    const onResize = () => close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    const focus = requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      cancelAnimationFrame(focus)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const choose = (itemId: string) => {
    onPick(itemId)
    close()
  }

  const onSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, Math.max(rows.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (current >= 0) choose(rows[current].id)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      // The picker is the topmost layer: Escape closes it, not the drawer or page beneath it.
      event.stopPropagation()
      close(true)
    } else if (event.key === 'Tab') {
      // The panel is portalled away from the trigger; put the caret back on it so Tab continues
      // from where the person was rather than from the end of the document.
      close(true)
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close(true) : openPanel())}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${label}: search by title or board`}
        className={cn(
          'flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-meta font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900',
          triggerClassName ?? 'w-60',
        )}
      >
        <Plus size={12} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDown size={13} className={cn('shrink-0 text-slate-400 transition', open && 'rotate-180')} />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            data-item-picker
            className="fixed z-[60] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
            style={{
              left: position.left,
              width: position.width,
              ...(position.top !== undefined ? { top: position.top } : { bottom: position.bottom }),
            }}
          >
            <div className="flex items-center gap-1.5 border-b border-slate-100 px-2.5 py-2">
              <Search size={13} className="shrink-0 text-slate-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActive(0)
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="Search by title or board…"
                aria-label={`Search ${noun}s`}
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={current >= 0 ? `${listId}-${rows[current].id}` : undefined}
                className="min-w-0 flex-1 bg-transparent text-meta text-slate-700 placeholder:text-slate-400 outline-none"
              />
            </div>

            <div id={listId} role="listbox" aria-label={listLabel} className="max-h-64 overflow-y-auto py-1">
              {rows.length === 0 && (
                <p className="px-3 py-2 text-meta text-slate-600">
                  {items.length === 0
                    ? (emptyLabel ?? `No ${noun} is available to map here.`)
                    : (noMatchLabel ?? `No ${noun} matches.`)}
                </p>
              )}
              {rows.map((item, index) => {
                const board = boardOf(item.id)
                const from = movesFrom?.(item.id)
                return (
                  <button
                    key={item.id}
                    id={`${listId}-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === current}
                    tabIndex={-1}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(item.id)}
                    className={cn(
                      'block w-full px-2.5 py-1.5 text-left transition',
                      index === current ? 'bg-indigo-50' : 'hover:bg-slate-100',
                    )}
                  >
                    <span className="block truncate text-meta font-medium text-slate-800">{item.title}</span>
                    <span className="mt-0.5 block truncate text-micro text-slate-600">
                      {board ?? 'Not on a board'}
                      {from && <span className="font-medium text-amber-700"> · moves from {from}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
