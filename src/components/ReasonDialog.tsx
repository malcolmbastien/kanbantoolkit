import { useEffect, useRef, useState } from 'react'
import { Gauge } from 'lucide-react'
import { useStore } from '@/store'

/**
 * Asks for a reason when a move would exceed a WIP limit on a `justify` board.
 * The reason is recorded on the card (and in its log); cancelling drops the move.
 */
export function ReasonDialog() {
  const prompt = useStore((s) => s.wipPrompt)
  const confirm = useStore((s) => s.confirmWipPrompt)
  const cancel = useStore((s) => s.cancelWipPrompt)
  const [reason, setReason] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!prompt) return
    setReason('')
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prompt, cancel])

  if (!prompt) return null

  const submit = () => {
    if (!reason.trim()) return
    confirm(reason)
  }

  return (
    <div data-reason-dialog className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/50 p-4" onClick={cancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="WIP limit exceeded"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start gap-2.5 px-4 py-3">
          <Gauge size={16} className="mt-0.5 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-slate-800">WIP limit exceeded</div>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
              Moving this card into “{prompt.laneName}” takes it over its limit of {prompt.limit}. Give a reason to continue — it is
              recorded on the card.
            </p>
          </div>
        </div>
        <div className="px-4 pb-3">
          <textarea
            ref={inputRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is this overrun OK?"
            className="w-full resize-y rounded border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2.5">
          <button
            onClick={cancel}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            disabled={!reason.trim()}
            onClick={submit}
            className="rounded-md bg-amber-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
          >
            Move with reason
          </button>
        </div>
      </div>
    </div>
  )
}
