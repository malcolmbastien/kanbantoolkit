import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Plus } from 'lucide-react'
import { SCOPE_ORDER, SCOPES, describeScopes, type Scope } from '@/domain/scopes'
import { cn } from '@/lib/utils'
import { mintFor, revokeFor, scopeChoices, tokensFor, type TokenInfo } from '@/lib/tokens'

/**
 * The machine credentials of one person (task 148).
 *
 * Rendered twice, and the difference is a `userId`: in the profile it is your own, and in the
 * People drawer an administrator sees somebody else's in order to revoke one (R5) or to mint one for
 * a daemon (R9). The list is the same list, because it is the same question — which credentials
 * exist, what do they reach, when were they last used, and how does one stop?
 *
 * The secret is shown here and nowhere else, once, in the answer to the mint (R1). The warning
 * beside it is not decoration: there is no second chance, because the server keeps a hash.
 */

const FIELD =
  'w-full rounded-md border border-slate-200 px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'
const BUTTON =
  'rounded-md border border-slate-200 px-2 py-0.5 text-micro font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'

const when = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'never'

const EXPIRIES: Array<{ label: string; days: number | null }> = [
  { label: '90 days', days: 90 },
  { label: '30 days', days: 30 },
  { label: '1 year', days: 365 },
  { label: 'never', days: null },
]

export function TokenPanel({
  userId,
  role,
  instanceRole,
}: {
  /** Whose tokens: absent for your own, a person's id when an administrator is looking. */
  userId?: string
  /** The owner's role — what the scope boxes may offer, and what the server checks at mint. */
  role?: string
  instanceRole?: string
}) {
  const [tokens, setTokens] = useState<TokenInfo[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState<Scope[]>([])
  const [days, setDays] = useState<number | null>(90)
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = async () => setTokens(await tokensFor(userId))

  useEffect(() => {
    let live = true
    void tokensFor(userId).then((list) => {
      if (live) setTokens(list)
    })
    return () => {
      live = false
    }
  }, [userId])

  const choices = scopeChoices(role, instanceRole)
  const offered = SCOPE_ORDER.filter((scope) => choices.includes(scope))

  const toggle = (scope: Scope) =>
    setChosen((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]))

  const mint = async () => {
    setBusy('mint')
    setError(null)
    const answer = await mintFor(userId, { name: name.trim(), scopes: chosen, expiresInDays: days })
    setBusy(null)
    if (!answer.ok) {
      setError(answer.error)
      return
    }
    // The row first, so the list is right even if the person closes the dialog on the secret.
    setSecret(answer.secret)
    setCreating(false)
    setName('')
    setChosen([])
    await reload()
  }

  const revoke = async (token: TokenInfo) => {
    setBusy(token.id)
    const ok = await revokeFor(userId, token.id)
    setBusy(null)
    if (!ok) setError('That token could not be revoked.')
    await reload()
  }

  return (
    <div data-token-panel>
      <div className="flex items-center justify-between gap-2">
        <p className="text-micro font-semibold uppercase tracking-wide text-slate-500">Machines and agents</p>
        {!creating && (
          <button
            onClick={() => {
              setCreating(true)
              setSecret(null)
              setError(null)
            }}
            className={cn(BUTTON, 'flex items-center gap-1')}
          >
            <Plus size={11} /> New token
          </button>
        )}
      </div>

      {secret && (
        <div className="mt-1.5 rounded-md border border-amber-300 bg-amber-50 p-2">
          <p className="text-micro font-semibold text-amber-900">
            Copy it now — this is the only time it will be shown.
          </p>
          <div className="mt-1 flex items-center gap-1">
            <code
              data-token-secret
              className="min-w-0 flex-1 select-all truncate rounded bg-white px-1.5 py-1 text-micro text-slate-800 ring-1 ring-amber-200"
            >
              {secret}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(secret)
                setCopied(true)
              }}
              className={cn(BUTTON, 'shrink-0')}
              title="Copy the token"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
          </div>
          <p className="mt-1 text-micro text-amber-900">
            The server keeps only a hash, so it cannot show this again. Lost it? Revoke it and make another.
          </p>
        </div>
      )}

      {creating && (
        <div className="mt-1.5 space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-2">
          <label className="block">
            <span className="text-micro font-medium text-slate-600">What is it for?</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="nightly export"
              aria-label="Token name"
              className={cn(FIELD, 'mt-0.5')}
            />
          </label>

          <fieldset>
            <legend className="text-micro font-medium text-slate-600">What it may do</legend>
            <div className="mt-0.5 space-y-0.5">
              {offered.map((scope) => (
                <label key={scope} className="flex items-start gap-1.5 text-micro text-slate-700">
                  <input
                    type="checkbox"
                    checked={chosen.includes(scope)}
                    onChange={() => toggle(scope)}
                    aria-label={SCOPES[scope].label}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{SCOPES[scope].label}</span>
                    <span className="block text-slate-600">{SCOPES[scope].does}</span>
                  </span>
                </label>
              ))}
              {offered.length === 0 && <p className="text-micro text-slate-600">Your role can hold no token scope here.</p>}
            </div>
          </fieldset>

          <label className="block">
            <span className="text-micro font-medium text-slate-600">For how long</span>
            <select
              value={days === null ? 'never' : String(days)}
              onChange={(event) => setDays(event.target.value === 'never' ? null : Number(event.target.value))}
              aria-label="Token expiry"
              className={cn(FIELD, 'mt-0.5')}
            >
              {EXPIRIES.map((option) => (
                <option key={option.label} value={option.days === null ? 'never' : String(option.days)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {error && <p className="text-micro font-medium text-rose-700">{error}</p>}

          <div className="flex items-center justify-end gap-1.5">
            <button onClick={() => setCreating(false)} className={BUTTON}>
              Cancel
            </button>
            <button
              onClick={() => void mint()}
              disabled={busy === 'mint' || !name.trim() || chosen.length === 0}
              className="rounded-md bg-slate-900 px-2 py-0.5 text-micro font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {busy === 'mint' ? 'Making…' : 'Make the token'}
            </button>
          </div>
        </div>
      )}

      <ul className="mt-1 space-y-1">
        {tokens.map((token) => {
          const live = !token.revokedAt && (!token.expiresAt || token.expiresAt > new Date().toISOString())
          return (
            <li
              key={token.id}
              data-token-id={token.id}
              className={cn(
                'flex items-start justify-between gap-2 rounded border px-1.5 py-1 text-meta',
                live ? 'border-slate-200 text-slate-700' : 'border-slate-100 text-slate-500',
              )}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1 truncate">
                  <KeyRound size={11} className="shrink-0 text-slate-400" />
                  <span className="truncate font-medium">{token.name}</span>
                  {live ? null : <span className="shrink-0 text-micro">revoked or expired</span>}
                </span>
                <span className="block text-micro text-slate-600">
                  {describeScopes(token.scopes)} ·{' '}
                  {token.origin === 'self' ? 'you made it' : token.origin === 'admin' ? 'an administrator made it' : 'approved here'}
                </span>
                <span className="block text-micro text-slate-600">
                  {token.lastUsedAt ? `last used ${when(token.lastUsedAt)}` : 'never used'} ·{' '}
                  {token.expiresAt ? `ends ${when(token.expiresAt)}` : 'no expiry'}
                </span>
              </span>
              {live && (
                <button
                  onClick={() => void revoke(token)}
                  disabled={busy === token.id}
                  title="Revoke — the next request with it is refused"
                  className={cn(BUTTON, 'shrink-0 text-rose-700 hover:bg-rose-50')}
                >
                  {busy === token.id ? 'revoking…' : 'revoke'}
                </button>
              )}
            </li>
          )
        })}
        {tokens.length === 0 && !creating && (
          <li className="text-meta text-slate-600">No tokens. A script or an agent needs one of these.</li>
        )}
      </ul>
    </div>
  )
}
