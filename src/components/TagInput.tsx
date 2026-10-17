import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { chipColors } from '@/lib/colors'
import type { Tag } from '@/domain/types'

/**
 * Add a tag by typing.
 *
 * The select it replaces made you read a list to find a word you already knew. Here the field
 * offers the board's own vocabulary as you type — swatch and all — and Enter takes the
 * highlighted one, so a tag is a word rather than a hunt.
 *
 * It offers the tags the board *defines* and no others. A tag is this board's managed
 * vocabulary, with a colour that has to mean something; a word nobody defined is not one, and
 * the field says where to define it instead of inventing a colour for it.
 */
export function TagInput({
  tags,
  carried,
  onAdd,
  className,
}: {
  /** The tags the board offers, in the order it lists them. */
  tags: Tag[]
  /** Ids this item already carries — offered as "on", never added twice. */
  carried: string[]
  onAdd: (tagId: string) => void
  className?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const listId = 'flowline-tag-options'

  const on = new Set(carried)
  const term = query.trim().toLowerCase()
  // Prefixes first: typing "de" should reach "Debt" before "Tech-debt", the way a person expects.
  const available = tags.filter((t) => !on.has(t.id))
  const matches = !term
    ? available
    : available
        .filter((t) => t.name.toLowerCase().includes(term))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(term)) - Number(!b.name.toLowerCase().startsWith(term)))

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // The highlight never points past a list that just got shorter.
  useEffect(() => setActive(0), [term])

  const choose = (tag: Tag) => {
    onAdd(tag.id)
    setQuery('')
    setOpen(true)
  }

  // Why the list is empty. Never a blank: a word the board does not define has to say so, and a
  // word it does define but the item already wears is not a miss.
  const empty =
    tags.length === 0
      ? 'This board has no tags yet — define them in board settings.'
      : !term && available.length === 0
        ? 'Every tag this board defines is already on this item.'
        : term && tags.some((t) => on.has(t.id) && t.name.toLowerCase().includes(term))
          ? 'Already on this item.'
          : `No tag on this board matches “${query.trim()}” — define it in board settings.`

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `flowline-tag-${matches[active].id}` : undefined}
        aria-label="Add a tag"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            if (matches.length === 0) return
            setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % matches.length : (i - 1 + matches.length) % matches.length))
            return
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            if (open && matches[active]) choose(matches[active])
            return
          }
          if (e.key === 'Escape') {
            // The list is the topmost layer, so Escape closes it rather than the drawer behind
            // it — a popover is dismissed first, the way the card menu's flyout is. Only the
            // open list swallows the key; a second Escape closes the panel, as it should.
            setQuery('')
            if (!open) return
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
          }
        }}
        placeholder={tags.length === 0 ? 'No tags on this board' : 'Add a tag…'}
        title="Type to find a tag this board defines"
        autoComplete="off"
        spellCheck={false}
        className="w-full min-w-[7rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-meta outline-none focus:ring-2 focus:ring-indigo-300"
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 max-h-56 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-0.5 shadow-lg"
        >
          {matches.length === 0 ? (
            <p className="px-2.5 py-1.5 text-meta text-slate-600">{empty}</p>
          ) : (
            matches.map((t, i) => {
              const chip = chipColors(t.color)
              return (
                <button
                  key={t.id}
                  id={`flowline-tag-${t.id}`}
                  role="option"
                  aria-selected={i === active}
                  // Keep the caret in the field: a click picks a tag and you carry on typing the next.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(t)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta transition',
                    i === active ? 'bg-slate-50 font-semibold text-slate-800' : 'text-slate-700',
                  )}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: chip.background }} />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
