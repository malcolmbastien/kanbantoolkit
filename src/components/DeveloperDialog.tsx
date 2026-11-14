import { useRef } from 'react'
import { X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDialogFocus } from '@/lib/useDialogFocus'
import { ConnectAgent } from './ConnectAgent'
import { TokenPanel } from './TokenPanel'

/**
 * The personal developer surface.
 *
 * Tokens and agent configuration act as the signed-in person, so they belong here rather than in
 * Admin — a member who is not an administrator has no Admin at all. The dialog shows the person's
 * own tokens and the one-click MCP configuration; it never lists another person's credentials.
 */
export function DeveloperDialog({ onClose }: { onClose: () => void }) {
  const account = useAuth((state) => state.user)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, onClose)
  if (!account) return null

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Developer"
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-4 shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-body font-semibold text-slate-900">Developer</h2>
            <p className="mt-0.5 text-meta text-slate-600">
              Credentials for scripts and agents. A token acts as you, within its scopes.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="mt-3 space-y-3">
          <div data-developer-tokens>
            <TokenPanel role={account.role} instanceRole={account.instanceRole} />
          </div>
          <ConnectAgent />
        </div>
      </div>
    </div>
  )
}
