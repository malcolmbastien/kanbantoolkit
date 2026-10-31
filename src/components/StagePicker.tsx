import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { STAGE_LABELS } from '@/domain/lanes'
import { STAGE_PILL } from '@/lib/colors'
import { cn } from '@/lib/utils'
import type { Stage } from '@/domain/types'

const STAGES: Stage[] = ['backlog', 'notStarted', 'inProgress', 'done']

interface Props {
  value: Stage
  onChange: (stage: Stage) => void
  /** The control's name, e.g. “Stage for To Do”. */
  label: string
}

/** Where the menu sits, in viewport coordinates: it is fixed so the dialog's scroll cannot clip it. */
interface PanelPosition {
  left: number
  width: number
  top?: number
  bottom?: number
}

/**
 * A stage picker that says which stage it is in colour.
 *
 * The four stages already have a vocabulary in the board — slate, blue, violet, green — and a native
 * select cannot show it: its options are the operating system's, one shade of grey. This is the same
 * reading, as a pill: the stage's own tint on the trigger and on every choice, so the mapping step
 * uses the language the board uses. The menu is portalled and fixed because the import dialog is a
 * scrolling panel that would otherwise clip it.
 */
export function StagePicker({ value, onChange, label }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(STAGES.indexOf(value))
  const [position, setPosition] = useState<PanelPosition>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = (refocus = false) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  const openPanel = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.max(rect.width, 144)
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)
    // Room for four pills. Open upward when the row is low on the screen and there is more room above.
    const room = 190
    const below = window.innerHeight - rect.bottom
    const above = rect.top
    setPosition(
      below < room && above > below
        ? { left, width, bottom: window.innerHeight - rect.top + 4 }
        : { left, width, top: rect.bottom + 4 },
    )
    setActive(STAGES.indexOf(value))
    setOpen(true)
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

  const choose = (stage: Stage) => {
    onChange(stage)
    close(true)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) openPanel()
      else setActive((index) => Math.min(index + 1, STAGES.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openPanel()
      else setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (open) choose(STAGES[active])
      else openPanel()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') {
      close()
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close(true) : openPanel())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className="flex w-36 items-center justify-between gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-left transition hover:border-slate-300"
      >
        <span className={cn('rounded px-1.5 py-0.5 text-micro font-semibold', STAGE_PILL[value])}>{STAGE_LABELS[value]}</span>
        <ChevronDown size={13} className={cn('shrink-0 text-slate-400 transition', open && 'rotate-180')} />
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
            {STAGES.map((stage, index) => (
              <button
                key={stage}
                type="button"
                role="option"
                aria-selected={stage === value}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(stage)}
                className={cn(
                  'flex w-full items-center gap-2 px-2 py-1.5 text-left transition',
                  index === active ? 'bg-slate-100' : 'hover:bg-slate-50',
                )}
              >
                <span className={cn('rounded px-1.5 py-0.5 text-micro font-semibold', STAGE_PILL[stage])}>
                  {STAGE_LABELS[stage]}
                </span>
                {stage === value && <Check size={12} className="ml-auto shrink-0 text-slate-600" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
