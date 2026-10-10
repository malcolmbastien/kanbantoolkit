import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import type { LimitPolicy } from '@/domain/types'

interface Props {
  title: string
  policy: LimitPolicy
  count: number
  onSubmit: (reason: string) => void
  onCancel: () => void
}

/** Soft-block: the move is allowed, but a reason is required and recorded. */
export function ReasonDialog({ title, policy, count, onSubmit, onCancel }: Props) {
  const [reason, setReason] = useState('')
  const valid = reason.trim().length >= 4

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <AlertTriangle size={16} className="text-amber-500" />
          <span className="text-sm font-semibold text-slate-800">Limit reached — reason required</span>
          <button onClick={onCancel} className="ml-auto text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 px-4 py-3 text-[12px] text-slate-600">
          <p>
            <span className="font-medium text-slate-800">{title}</span> would exceed the limit{' '}
            <span className="font-mono">
              {policy.itemType}s · {policy.resolution}
              {policy.scopeId ? ` · ${policy.scopeId}` : ' · all scopes'}
            </span>
            .
          </p>
          <div className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 font-mono text-[12px]">
            <span className="text-slate-500">count</span>
            <span className="font-semibold text-slate-800">{count}</span>
            <span className="text-slate-400">/ limit</span>
            <span className="font-semibold text-rose-600">{policy.limit}</span>
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">
              Why is this the right call? (recorded on the item)
            </span>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Splitting the old epic; net WIP unchanged."
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </label>
          <p className="text-[11px] text-slate-400">
            Enforcement: <span className="font-medium">{policy.enforcement.replace('_', ' ')}</span> — the
            card is not blocked, but the reason is kept so the CFD can be read later.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button
            onClick={onCancel}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            disabled={!valid}
            onClick={() => onSubmit(reason.trim())}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Proceed with reason
          </button>
        </div>
      </div>
    </div>
  )
}
