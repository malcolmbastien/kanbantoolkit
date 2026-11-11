import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { OBJECTIVE_STATUS_LABELS, OBJECTIVE_STATUSES } from '@/domain/objectives'
import { OBJECTIVE_STATUS_DOT, OBJECTIVE_STATUS_STYLES } from '@/lib/colors'
import { cn } from '@/lib/utils'
import type { ObjectiveStatus } from '@/domain/types'

interface Props {
  value: ObjectiveStatus
  onChange: (status: ObjectiveStatus) => void
  /** The control's name, e.g. “Status of Grow activation”. */
  label: string
}

/** Where the menu sits, in viewport coordinates: fixed so the card's overflow cannot clip it. */
interface PanelPosition {
  left: number
  width: number
  top?: number
  bottom?: number
}

/**
 * The objective's lifecycle as a picker that names each state in colour.
 *
 * A native select cannot colour its options — they are the operating system's, one shade of grey —
 * and the four states were therefore identical until the menu was open. Each state now wears its
 * own dot on the trigger and on every choice, using the same vocabulary as its status chip.
 */
export function ObjectiveStatusPicker({ value, onChange, label }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(OBJECTIVE_STATUSES.indexOf(value))
  const [position, setPosition] = useState<PanelPosition>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // A picker deep in the map is scrolled into view as it is clicked; that scroll must not close the
  // menu the click just opened.
  const openedAt = useRef(0)

  const close = (refocus = false) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  const openPanel = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.max(rect.width, 148)
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)
    // Room for four options. Open upward when the trigger is low and there is more room above.
    const room = 180
    const below = window.innerHeight - rect.bottom
    const above = rect.top
    setPosition(
      below < room && above > below
        ? { left, width, bottom: window.innerHeight - rect.top + 4 }
        : { left, width, top: rect.bottom + 4 },
    )
    setActive(OBJECTIVE_STATUSES.indexOf(value))
    setOpen(true)
    openedAt.current = Date.now()
  }

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close()
    }
    // A fixed menu would otherwise point at where the trigger used to be.
    const onScroll = (event: Event) => {
      if (Date.now() - openedAt.current < 200) return
      if (panelRef.current?.contains(event.target as Node)) return
      close()
    }
    const onResize = () => close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const choose = (status: ObjectiveStatus) => {
    onChange(status)
    close(true)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) openPanel()
      else setActive((index) => Math.min(index + 1, OBJECTIVE_STATUSES.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openPanel()
      else setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (open) choose(OBJECTIVE_STATUSES[active])
      else openPanel()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') {
      close()
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close(true) : openPanel())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className={cn(
          'flex items-center gap-1 rounded px-1 py-px text-micro font-semibold ring-1 outline-none transition hover:brightness-95',
          OBJECTIVE_STATUS_STYLES[value],
        )}
      >
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', OBJECTIVE_STATUS_DOT[value])} aria-hidden="true" />
        <span>{OBJECTIVE_STATUS_LABELS[value]}</span>
        <ChevronDown size={11} className={cn('shrink-0 opacity-70 transition', open && 'rotate-180')} />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={label}
            className="fixed z-[60] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
            style={{
              left: position.left,
              width: position.width,
              ...(position.top !== undefined ? { top: position.top } : { bottom: position.bottom }),
            }}
          >
            {OBJECTIVE_STATUSES.map((status, index) => (
              <button
                key={status}
                type="button"
                role="option"
                aria-selected={status === value}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(status)}
                className={cn(
                  'flex w-full items-center gap-2 px-2 py-1.5 text-left text-meta transition',
                  index === active ? 'bg-slate-100' : 'hover:bg-slate-50',
                )}
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', OBJECTIVE_STATUS_DOT[status])} aria-hidden="true" />
                <span className="flex-1 text-slate-700">{OBJECTIVE_STATUS_LABELS[status]}</span>
                {status === value && <Check size={12} className="shrink-0 text-slate-600" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
