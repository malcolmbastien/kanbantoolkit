import { useEffect, useState } from 'react'
import { Check, Copy, Network } from 'lucide-react'
import { ROLES } from '@/domain/roles'
import { mintScim, revokeScim, scimTokens, type ScimToken } from '@/lib/scim'
import { cn } from '@/lib/utils'

/**
 * Directory provisioning (task 168): the token an identity provider calls `/scim/v2` with.
 *
 * Instance administrators only, because the token is a door into the deployment rather than into a
 * board: it can create accounts and give them a **workspace** role, and it can never administer the
 * instance. Minting chooses one thing — the role a provisioned person gets — and the panel says what
 * the directory can and cannot decide.
 *
 * The secret is shown once. The endpoint list beside it is what an IdP's "provisioning" screen asks
 * for: the base URL and the token.
 */

const when = (value: string | null) => (value ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never')

const ROLE_LABEL: Record<string, string> = { viewer: 'Viewer', editor: 'Editor', admin: 'Workspace administrator' }

export function ScimPanel() {
  const [tokens, setTokens] = useState<ScimToken[]>([])
  const [name, setName] = useState('our directory')
  const [role, setRole] = useState('editor')
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const base = `${origin}/scim/v2`

  const reload = async () => setTokens(await scimTokens())
  useEffect(() => {
    void reload()
  }, [])

  const mint = async () => {
    setBusy('mint')
    setError(null)
    const answer = await mintScim(name.trim(), role as 'viewer' | 'editor' | 'admin')
    setBusy(null)
    if (!answer.ok) {
      setError(answer.error)
      return
    }
    setSecret(answer.secret)
    await reload()
  }

  const revoke = async (token: ScimToken) => {
    setBusy(token.id)
    const ok = await revokeScim(token.id)
    setBusy(null)
    if (!ok) setError('That token could not be revoked.')
    await reload()
  }

  const copy = (what: string, value: string) => {
    void navigator.clipboard?.writeText(value)
    setCopied(what)
  }

  return (
    <section data-scim className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-slate-600">
        <Network size={12} /> Directory provisioning
      </div>
      <p className="mt-0.5 text-meta text-slate-600">
        Your identity provider can create accounts and take them away through SCIM 2.0. It decides who is on the team and
        which groups they are in; the role a group carries is still yours to grant here.
      </p>

      <p className="mt-1 text-micro text-slate-600">
        SCIM base URL: <code className="select-all rounded bg-slate-100 px-1 py-0.5">{base}</code>{' '}
        <button onClick={() => copy('base', base)} className="font-medium text-indigo-700 hover:underline">
          {copied === 'base' ? 'copied' : 'copy'}
        </button>
      </p>

      {/* ...the secret, once. */}
      {secret && (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2">
          <p className="text-micro font-semibold text-amber-900">Paste this into your provider once — it is not shown again.</p>
          <div className="mt-1 flex items-center gap-1">
            <code data-scim-secret className="min-w-0 flex-1 select-all truncate rounded bg-white px-1.5 py-1 text-micro text-slate-800 ring-1 ring-amber-200">
              {secret}
            </code>
            <button onClick={() => copy('secret', secret)} className="shrink-0 rounded border border-amber-300 bg-white px-2 py-0.5 text-micro font-medium text-amber-900">
              {copied === 'secret' ? <Check size={11} /> : <Copy size={11} />}
            </button>
          </div>
          <p className="mt-1 text-micro text-amber-900">
            A provisioned person arrives with no password: their directory is the door. They can also ask for a sign-in link.
          </p>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="min-w-0">
          <span className="block text-micro font-medium text-slate-600">Which provider is this?</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="SCIM token name"
            className="mt-0.5 w-52 rounded-md border border-slate-200 px-2 py-1 text-meta text-slate-800 outline-none focus:border-indigo-400"
          />
        </label>
        <label>
          <span className="block text-micro font-medium text-slate-600">People it provisions become</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            aria-label="Provisioned role"
            className="mt-0.5 rounded-md border border-slate-200 px-2 py-1 text-meta text-slate-800 outline-none focus:border-indigo-400"
          >
            {ROLES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {ROLE_LABEL[entry.id] ?? entry.label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => void mint()}
          disabled={busy === 'mint' || !name.trim()}
          className="rounded-md bg-slate-900 px-2.5 py-1 text-meta font-medium text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {busy === 'mint' ? 'Making…' : 'Make a token'}
        </button>
        {error && <p className="w-full text-meta font-medium text-rose-700">{error}</p>}
        <p className="w-full text-micro text-slate-600">
          A SCIM token can provision people and membership. It cannot read a board, and it can never make anybody an
          administrator of the deployment — only of this workspace, if you choose that above.
        </p>
      </div>

      <ul className="mt-2 space-y-1">
        {tokens.map((token) => {
          const live = !token.revokedAt
          return (
            <li
              key={token.id}
              className={cn('flex items-start justify-between gap-2 rounded border px-1.5 py-1 text-meta', live ? 'border-slate-200 text-slate-700' : 'border-slate-100 text-slate-500')}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{token.name}</span>
                <span className="block text-micro text-slate-600">
                  provisions {ROLE_LABEL[token.defaultRole] ?? token.defaultRole} · {token.lastUsedAt ? `last used ${when(token.lastUsedAt)}` : 'never used'}
                  {live ? '' : ' · revoked'}
                </span>
              </span>
              {live && (
                <button
                  onClick={() => void revoke(token)}
                  disabled={busy === token.id}
                  title="The provider is refused on its next call"
                  className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-micro text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                >
                  {busy === token.id ? 'revoking…' : 'revoke'}
                </button>
              )}
            </li>
          )
        })}
        {tokens.length === 0 && <li className="text-meta text-slate-600">No SCIM token yet — your directory cannot provision anything.</li>}
      </ul>
    </section>
  )
}
