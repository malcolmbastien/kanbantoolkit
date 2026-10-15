import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

/**
 * The global confirmation modal. Destructive actions (delete board / card /
 * lane, archive done) call `askConfirm`, and this renders a styled, accessible
 * dialog: Enter confirms (via the focused button), Escape or a click away
 * cancels, and focus returns to where it was.
 */
export function ConfirmDialog() {
  const request = useStore((s) => s.confirm)
  const closeConfirm = useStore((s) => s.closeConfirm)
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!request) return
    const previous = document.activeElement as HTMLElement | null
    confirmRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeConfirm()
        return
      }
      if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])')
        if (!nodes || nodes.length === 0) return
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        const active = document.activeElement
        if (e.shiftKey && active === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [request, closeConfirm])

  if (!request) return null

  const confirm = () => {
    request.onConfirm()
    closeConfirm()
  }

  return (
    <div
      data-confirm-dialog
      className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/50 p-4"
      onClick={closeConfirm}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start gap-2.5 px-4 py-3">
          {request.danger && <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-500" />}
          <div className="min-w-0">
            <div className="text-title font-semibold text-slate-800">{request.title}</div>
            {request.body && <p className="mt-1 text-meta leading-relaxed text-slate-600">{request.body}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2.5">
          <button
            onClick={closeConfirm}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-meta font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={confirm}
            className={cn(
              'rounded-md px-2.5 py-1 text-meta font-semibold text-white',
              request.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-500',
            )}
          >
            {request.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
