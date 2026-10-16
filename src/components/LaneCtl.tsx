import { cn } from '@/lib/utils'

/**
 * The lane-editing controls, shared by both workflows.
 *
 * They used to be two implementations with two icon sets — the cards workflow on glyphs and the
 * initiatives workflow on different ones — so the same action looked like two different actions
 * depending on which workflow you happened to be editing. One component, one set of icons.
 *
 * They are also joined rather than separate: these are one toolbar over one lane, and a row of
 * individually-boxed buttons reads as a row of unrelated things.
 */
export function CtlGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center overflow-hidden rounded-md bg-slate-200 ring-1 ring-slate-300/70">{children}</div>
  )
}

/** A hairline between one run of controls and the next — moving a lane is not splitting it. */
export function CtlDivider() {
  return <span className="h-5 w-px shrink-0 bg-slate-300" aria-hidden />
}

export function LaneCtl({
  children,
  onClick,
  title,
  active,
  disabled,
  btnRef,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  active?: boolean
  disabled?: boolean
  btnRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={btnRef}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        'grid h-5 w-5 place-items-center transition',
        disabled
          ? 'cursor-not-allowed text-slate-400'
          : active
            ? 'bg-indigo-600 text-white'
            : 'text-slate-600 hover:bg-slate-300 hover:text-slate-900',
      )}
    >
      {children}
    </button>
  )
}
