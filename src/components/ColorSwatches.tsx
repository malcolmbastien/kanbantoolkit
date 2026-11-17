import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { VOCABULARY_SWATCHES } from '@/lib/colors'
import { cn } from '@/lib/utils'

/** The panel's own size, so it can be kept inside the window it opens in. */
const WIDTH = 190
const HEIGHT = 88

/**
 * A vocabulary colour, chosen from the presets.
 *
 * A type, an initiative kind and a tag are read at a glance on a card, so their colour is a small
 * set of calm, distinguishable hues rather than a colour wheel. A custom RGB picker offers a range
 * the rest of the app does not use, and two arbitrary hues can sit close enough to stop being
 * tellable apart; a preset is also what `nextUnusedColor` already hands a new word.
 *
 * The panel is fixed rather than absolute: it opens inside the settings dialog's scrolling panel,
 * and a popover laid out in that flow would be clipped by it. Its buttons follow the trigger in the
 * DOM, so Tab enters the swatches and Escape leaves them.
 */
export function ColorSwatches({
  value,
  onChange,
  label,
  size = 'md',
}: {
  /** The current colour — a preset, or a custom one an older workspace already holds. */
  value: string
  onChange: (value: string) => void
  /** What the colour belongs to, for the trigger's own name and the panel's label. */
  label: string
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const current = VOCABULARY_SWATCHES.find((swatch) => swatch.value.toLowerCase() === value.toLowerCase())

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - WIDTH - 8)
    const below = rect.bottom + 4
    const top = below + HEIGHT > window.innerHeight - 8 ? Math.max(8, rect.top - HEIGHT - 4) : below
    setAt({ left, top })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      if (panelRef.current?.contains(event.target as Node) || triggerRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Escape is the panel's, not the settings dialog's: closing both would lose the user's
      // place for one key. The dialog traps Escape in the *capture* phase on the document, so this
      // listens a step earlier — on the window — and stops the event before it gets there.
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    // The panel is positioned against the viewport, so a scroll or resize would leave it pointing
    // at nothing. Closing is the honest answer; reopening is one press.
    const close = () => setOpen(false)
    document.addEventListener('mousedown', away)
    window.addEventListener('keydown', key, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  const choose = (next: string) => {
    onChange(next)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <span className="relative inline-flex shrink-0">
      <button
        ref={triggerRef}
        type="button"
        data-color={value}
        onClick={() => (open ? setOpen(false) : show())}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${label}: ${current?.name ?? value}`}
        title={label}
        className={cn(
          'flex items-center justify-center gap-0.5 rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700',
          size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
        )}
      >
        <span
          aria-hidden
          className={cn('shrink-0 rounded-full ring-1 ring-inset ring-black/10', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')}
          style={{ backgroundColor: value }}
        />
        <ChevronDown size={9} aria-hidden className={cn('shrink-0', open && 'rotate-180', size === 'sm' && 'hidden')} />
      </button>

      {open && at && (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label={`${label} presets`}
          style={{ left: at.left, top: at.top, width: WIDTH }}
          className="fixed z-[60] rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
        >
          <div className="grid grid-cols-6 gap-1.5">
            {VOCABULARY_SWATCHES.map((swatch) => {
              const chosen = swatch.value.toLowerCase() === value.toLowerCase()
              return (
                <button
                  key={swatch.value}
                  type="button"
                  aria-pressed={chosen}
                  aria-label={swatch.name}
                  title={swatch.name}
                  onClick={() => choose(swatch.value)}
                  style={{ backgroundColor: swatch.value }}
                  className={cn(
                    'grid h-6 w-6 place-items-center rounded-full transition hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900',
                    chosen && 'ring-2 ring-slate-900 ring-offset-2 ring-offset-white',
                  )}
                >
                  {chosen && <Check size={12} className="text-white drop-shadow" aria-hidden />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </span>
  )
}
