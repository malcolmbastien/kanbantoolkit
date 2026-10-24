import { useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { useDialogFocus } from '@/lib/useDialogFocus'

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

  // Escape, Tab and the return of the caret are the dialog's own — the confirm button takes the
  // focus, because a dialog that asks a question should have the answer under the fingers.
  useDialogFocus(dialogRef, closeConfirm, Boolean(request), '[data-confirm-yes]')

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
            data-confirm-yes
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
