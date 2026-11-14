import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { useDialogFocus } from '@/lib/useDialogFocus'

/**
 * The global confirmation modal. Destructive actions (delete board / card /
 * lane, archive done) call `askConfirm`, and this renders a styled, accessible
 * dialog: Enter confirms (via the focused button), Escape or a click away
 * cancels, and focus returns to where it was.
 *
 * A request may also ask for an optional note — filing unfinished work uses it
 * to say why the work was dropped, without making the reason mandatory.
 */
export function ConfirmDialog() {
  const request = useStore((s) => s.confirm)
  const closeConfirm = useStore((s) => s.closeConfirm)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [note, setNote] = useState('')

  // A new question starts with no answer from the last one.
  useEffect(() => setNote(''), [request])

  // Escape, Tab and the return of the caret are the dialog's own — the confirm button takes the
  // focus, because a dialog that asks a question should have the answer under the fingers. When a
  // note is requested, the note has the focus: the reason is the part that cannot be guessed.
  useDialogFocus(
    dialogRef,
    closeConfirm,
    Boolean(request),
    request?.note ? '[data-confirm-note]' : '[data-confirm-yes]',
  )

  if (!request) return null

  const confirm = () => {
    request.onConfirm(note.trim() || undefined)
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
        {request.note && (
          <div className="border-t border-slate-100 px-4 py-3">
            <label htmlFor="confirm-note" className="block text-meta font-medium text-slate-700">
              {request.note.label}
            </label>
            <textarea
              id="confirm-note"
              data-confirm-note
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={request.note.placeholder}
              rows={2}
              className="mt-1 w-full resize-none rounded-md border border-slate-300 px-2 py-1.5 text-meta text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
            />
          </div>
        )}
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
