import { useId, useRef, useState } from 'react'
import { PersonAvatar } from './PersonAvatar'
import { cn } from '@/lib/utils'
import type { User } from '@/domain/types'

interface Props {
  users: User[]
  /** People already carrying the item (or cards); they are not offered again. */
  exclude?: readonly string[]
  onPick: (user: User) => void
  /** What the field is for, for a screen reader. */
  label: string
  placeholder?: string
  /** Said when there is no query and nobody is left to add. */
  emptyLabel?: string
  /** The search field's wrapper: `flex-1` beside chips, or the field's own width. */
  className?: string
  /**
   * Draw the input without a border or ground because it sits *inside* a well that already has
   * them. A person is added into a field, not into a control of its own that competes with it.
   */
  bare?: boolean
}

/**
 * Choose a person **who already exists** in this workspace.
 *
 * Typing is a search, never a create: an unknown name has no row and Enter adds nothing. The list
 * opens on focus so the mouse is a first-class way in — a row is clicked, not selected and then
 * confirmed — and every row carries the person's face, photo or initials, because a name is a label
 * and a face is recognition.
 */
export function PersonPicker({ users, exclude = [], onPick, label, placeholder = 'Add a person…', emptyLabel, className, bare = false }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const excluded = new Set(exclude)
  const needle = query.trim().toLowerCase()
  const matches = users
    .filter((user) => !excluded.has(user.id) && (!needle || user.name.toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name))
  const current = matches.length === 0 ? -1 : Math.min(active, matches.length - 1)

  const pick = (user: User) => {
    onPick(user)
    setQuery('')
    setActive(0)
    // The field keeps focus: adding a second person is the common case, and the list is still open.
    inputRef.current?.focus()
  }

  return (
    <div className={cn('relative min-w-[6rem]', className ?? 'w-full')}>
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) {
              setOpen(true)
              return
            }
            const step = event.key === 'ArrowDown' ? 1 : -1
            setActive((index) => {
              const count = matches.length
              if (count === 0) return 0
              return (Math.min(index, count - 1) + step + count) % count
            })
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            const user = open ? matches[current] : undefined
            if (user) pick(user)
            return
          }
          if (event.key === 'Escape' && open) {
            // The suggestion list is the topmost thing here: Escape closes it, not the drawer.
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && current >= 0 ? `${listId}-${matches[current].id}` : undefined}
        className={cn(
          'w-full text-meta outline-none transition',
          bare
            ? 'bg-transparent px-0.5 py-0.5 focus:ring-0'
            : 'rounded-lg border border-slate-200 bg-white px-2 py-1 focus:ring-2 focus:ring-indigo-400',
        )}
      />

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="People in this workspace"
          className="absolute left-0 top-full z-20 mt-1 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-300 bg-white py-1 shadow-xl"
        >
          {matches.map((user, index) => (
            <button
              key={user.id}
              id={`${listId}-${user.id}`}
              type="button"
              role="option"
              aria-selected={index === current}
              onMouseDown={(event) => {
                // The press chooses a person; it does not leave the field, so the list can be used
                // again for the next one. Stopped here because the row leaves the DOM as it is
                // chosen — an outside-press guard must not read a detached row as a press elsewhere.
                event.preventDefault()
                event.stopPropagation()
                pick(user)
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta transition',
                index === current ? 'bg-indigo-50 text-indigo-800' : 'text-slate-700 hover:bg-slate-50',
              )}
            >
              <PersonAvatar user={user} />
              <span className="min-w-0 flex-1 truncate">{user.name}</span>
            </button>
          ))}
          {matches.length === 0 && (
            <p className="px-2.5 py-1.5 text-meta text-slate-600">
              {needle ? `No one in this workspace matches “${query.trim()}”.` : (emptyLabel ?? 'No one left to add.')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
