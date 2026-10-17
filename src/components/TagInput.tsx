import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { chipColors } from '@/lib/colors'
import type { Tag } from '@/domain/types'

/**
 * Add a tag by typing.
 *
 * The select it replaced made you read a list to find a word you already knew. Here the field
 * offers the board's own vocabulary as you type — swatch and all — and Enter takes the
 * highlighted one, so a tag is a word rather than a hunt.
 *
 * A word the board does not define yet is offered as a new tag rather than refused: the person
 * typing it is mid-thought, and sending them to board settings to define a word they have just
 * written is the sort of detour that stops people labelling anything. The board's settings stay
 * where tags are managed — renamed, recoloured, removed — and the created tag arrives there.
 */
export function TagInput({
  tags,
  carried,
  onAdd,
  onCreate,
  className,
}: {
  /** The tags the board offers, in the order it lists them. */
  tags: Tag[]
  /** Ids this item already carries — offered as "on", never added twice. */
  carried: string[]
  onAdd: (tagId: string) => void
  /** A name the board does not define yet, to be defined and applied in one gesture. */
  onCreate: (name: string) => void
  className?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const listId = 'flowline-tag-options'

  const on = new Set(carried)
  const term = query.trim()
  const needle = term.toLowerCase()
  // Prefixes first: typing "de" should reach "Debt" before "Tech-debt", the way a person expects.
  const available = tags.filter((t) => !on.has(t.id))
  const matches = !needle
    ? available
    : available
        .filter((t) => t.name.toLowerCase().includes(needle))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)))

  // A name the board already defines — carried here or not — is that tag, never a second one
  // differing only in case. So the only thing to create is a word it has never heard.
  const create = term && !tags.some((t) => t.name.toLowerCase() === needle) ? term : null
  const options: ({ kind: 'tag'; tag: Tag } | { kind: 'create'; name: string })[] = [
    ...matches.map((tag) => ({ kind: 'tag' as const, tag })),
    ...(create ? [{ kind: 'create' as const, name: create }] : []),
  ]

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // The highlight never points past a list that just got shorter.
  useEffect(() => setActive(0), [needle])

  const choose = (option: (typeof options)[number]) => {
    if (option.kind === 'tag') onAdd(option.tag.id)
    else onCreate(option.name)
    setQuery('')
    setOpen(true)
  }

  // Why the list is empty. Never a blank, and never a lie: a word the board defines but the item
  // already wears is not a miss, and a word nobody has used yet is a tag waiting to be made.
  const empty =
    tags.length === 0
      ? 'This board has no tags yet — type a name to create one.'
      : !term && available.length === 0
        ? 'Every tag this board defines is already on this item.'
        : 'Already on this item.'

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `flowline-tag-option-${active}` : undefined}
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
            if (options.length === 0) return
            setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % options.length : (i - 1 + options.length) % options.length))
            return
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            if (open && options[active]) choose(options[active])
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
        placeholder={tags.length === 0 ? 'Add or create a tag…' : 'Add a tag…'}
        title="Type to find a tag this board defines — or to create one it does not"
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
          {options.length === 0 ? (
            <p className="px-2.5 py-1.5 text-meta text-slate-600">{empty}</p>
          ) : (
            options.map((option, i) => (
              <button
                key={option.kind === 'tag' ? option.tag.id : 'create'}
                id={`flowline-tag-option-${i}`}
                role="option"
                aria-selected={i === active}
                // Keep the caret in the field: a pick and you carry on typing the next one.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option)}
                onMouseEnter={() => setActive(i)}
                title={
                  option.kind === 'create'
                    ? `Create “${option.name}” on this board — recolour it any time in board settings`
                    : undefined
                }
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta transition',
                  i === active ? 'bg-slate-50 font-semibold text-slate-800' : 'text-slate-700',
                )}
              >
                {option.kind === 'tag' ? (
                  <>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: chipColors(option.tag.color).background }} />
                    <span className="min-w-0 flex-1 truncate">{option.tag.name}</span>
                  </>
                ) : (
                  <>
                    <Plus size={12} className="shrink-0 text-indigo-500" />
                    <span className="min-w-0 flex-1 truncate">
                      Create <span className="font-semibold">“{option.name}”</span>
                    </span>
                  </>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
