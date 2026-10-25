import { useEffect, useRef, useState } from 'react'
import { KeyRound, X } from 'lucide-react'
import { SCOPES, describeScopes } from '@/domain/scopes'
import { approvalOf, approveDevice, type Approval } from '@/lib/tokens'
import { useAuth } from '@/lib/auth'
import { useDialogFocus } from '@/lib/useDialogFocus'
import { cn } from '@/lib/utils'

/**
 * The consent screen for a tool that asked for a code (task 148, R10).
 *
 * A tool prints eight characters and a URL; the person opens the URL in the browser they are already
 * signed in to, and this is what they see: the tool's own name, the scopes in words, how long the
 * credential will last. Approving is a press; refusing is a press. The code is single-use and dies in
 * ten minutes, so a link somebody forwards is nothing.
 *
 * It lives in the URL (`?approve=…`) rather than in a view, because the tool's link has to be one
 * address a person can open. When the question is answered the parameter goes, so a refresh does not
 * ask a second time — and the answer never becomes a place in history.
 */

function codeFromUrl(): string | undefined {
  try {
    return new URLSearchParams(window.location.search).get('approve') ?? undefined
  } catch {
    return undefined
  }
}

/** Remove the parameter without adding a history entry: the question was not a step forward. */
function forget() {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('approve')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  } catch {
    // A URL that cannot be rewritten only means the parameter stays; the code is spent anyway.
  }
}

export function ApprovalPrompt({ code: given }: { code?: string }) {
  const account = useAuth((state) => state.user)
  // The caller read the address before the app rewrote it; the fallback is for a surface that was
  // opened while the parameter was still there.
  const [code, setCode] = useState<string | undefined>(given ?? codeFromUrl)
  const [approval, setApproval] = useState<Approval | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  // A dialog is a place: the caret starts in it, Tab stays in it, Escape leaves it.
  const dialogRef = useRef<HTMLDivElement>(null)
  const close = () => {
    forget()
    setCode(undefined)
  }
  useDialogFocus(dialogRef, close)

  useEffect(() => {
    if (!code || !account) return
    let live = true
    void approvalOf(code).then((answer) => {
      if (!live) return
      if ('error' in answer) setError(answer.error)
      else setApproval(answer)
    })
    return () => {
      live = false
    }
  }, [code, account])

  if (!code || !account) return null

  const grantable = approval ? approval.scopes.filter((scope) => !approval.refused.includes(scope)) : []

  const approve = async () => {
    if (!approval) return
    setBusy(true)
    setError(null)
    // Narrowing is the person's to do: a tool may ask for more than this person may grant, and the
    // answer is the part they can, said out loud rather than refused as a whole.
    const answer = await approveDevice(code, approval.refused.length ? grantable : undefined)
    setBusy(false)
    if (answer.ok) setDone(true)
    else setError(answer.error)
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label="Approve a tool">
      <div ref={dialogRef} className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700">
            <KeyRound size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-title font-semibold text-slate-900">Connect a tool</p>
            <p className="mt-0.5 text-meta text-slate-600">
              {approval ? (
                <>
                  <span className="font-medium text-slate-800">{approval.name}</span> asked for a credential to act as you.
                </>
              ) : (
                'Reading the code…'
              )}
            </p>
          </div>
          <button onClick={close} aria-label="Close" className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100">
            <X size={15} />
          </button>
        </div>

        <div className="px-4 py-3">
          {done ? (
            <p className="text-meta text-slate-700">
              Approved. You can close this tab and go back to the tool — it has the credential now, and it
              will show up under <span className="font-medium">Machines and agents</span> in your profile.
            </p>
          ) : (
            <>
              {approval && (
                <>
                  <p className="text-meta text-slate-700">
                    It will be able to <span className="font-medium">{describeScopes(grantable)}</span>, for{' '}
                    {approval.expiresInDays === null ? 'as long as it is not revoked' : `${approval.expiresInDays} days`}.
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {grantable.map((scope) => (
                      <li key={scope} className="text-meta text-slate-700">
                        <span className="font-medium">{SCOPES[scope].label}</span> — {SCOPES[scope].does}
                      </li>
                    ))}
                  </ul>
                  {approval.refused.length > 0 && (
                    <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-micro text-amber-900 ring-1 ring-amber-200">
                      Your role cannot grant {approval.refused.map((scope) => SCOPES[scope].label).join(', ')}, so
                      approving gives the tool only the rest.
                    </p>
                  )}
                  <p className="mt-2 text-micro text-slate-600">
                    Saying no changes nothing; the tool simply cannot connect. You can revoke this credential at any
                    time, from the same place.
                  </p>
                </>
              )}
              {error && <p className="mt-2 text-meta font-medium text-rose-700">{error}</p>}
            </>
          )}
        </div>

        {!done && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2.5">
            <button
              onClick={close}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-meta font-medium text-slate-700 hover:bg-slate-100"
            >
              Not now
            </button>
            <button
              onClick={() => void approve()}
              disabled={busy || !approval || grantable.length === 0}
              className={cn(
                'rounded-md bg-indigo-600 px-2.5 py-1 text-meta font-semibold text-white hover:bg-indigo-500',
                'disabled:opacity-40',
              )}
            >
              {busy ? 'Approving…' : 'Approve'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
