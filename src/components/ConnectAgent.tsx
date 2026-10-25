import { useState } from 'react'
import { Check, Copy, Plug } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { SCOPES, type Scope } from '@/domain/scopes'
import { mintFor } from '@/lib/tokens'
import { cn } from '@/lib/utils'

/**
 * "Connect an agent" (task 170, R8) — the click that replaces a JSON snippet somebody has to fill in.
 *
 * It mints a token with the scopes the agent needs and shows the two configurations an MCP client
 * takes: Streamable HTTP for an agent that cannot spawn a process, stdio for one that can. The
 * secret is shown here and nowhere else (the server keeps a hash), which is why the configs carry it
 * in the same panel rather than sending the person to find it again.
 *
 * The stdio config reads the token from the file `flowline login` writes where it can, because that
 * is the better place for a secret; the pasted one is the shortcut for a machine where the CLI has
 * not run. Both are honest about the code the agent will run: the repository's own bridge.
 */

const READ: Scope[] = ['boards:read', 'items:read', 'people:read', 'items:comment']

export function ConnectAgent() {
  const account = useAuth((state) => state.user)
  const [name, setName] = useState('my agent')
  const [write, setWrite] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'http' | 'stdio' | 'secret' | null>(null)

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const scopes: Scope[] = write ? [...READ, 'items:write', 'objectives:write'] : READ

  const create = async () => {
    setBusy(true)
    setError(null)
    const answer = await mintFor(undefined, { name: name.trim() || 'my agent', scopes })
    setBusy(false)
    if (!answer.ok) {
      setError(answer.error)
      return
    }
    setSecret(answer.secret)
  }

  const httpConfig = secret
    ? JSON.stringify({ mcpServers: { flowline: { type: 'http', url: `${origin}/mcp`, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2)
    : ''
  const stdioConfig = secret
    ? JSON.stringify(
        {
          mcpServers: {
            flowline: {
              command: 'npx',
              args: ['tsx', 'server/mcp.ts'],
              env: { FLOWLINE_URL: origin, FLOWLINE_TOKEN: secret },
            },
          },
        },
        null,
        2,
      )
    : ''

  const copy = (which: 'http' | 'stdio' | 'secret', value: string) => {
    void navigator.clipboard?.writeText(value)
    setCopied(which)
  }

  if (!account) return null

  return (
    <section data-connect-agent className="rounded-lg border border-slate-300 bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-slate-600">
        <Plug size={12} /> Connect an agent
      </div>
      <p className="mt-0.5 text-meta text-slate-600">
        An agent reads and writes the board through the same rules as a person — a move it makes is a move. It needs a
        token of its own, with only what it should be able to do.
      </p>

      {secret ? (
        <div className="mt-2 space-y-2">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2">
            <p className="text-micro font-semibold text-amber-900">This is the only time the token is shown.</p>
            <div className="mt-1 flex items-center gap-1">
              <code data-agent-secret className="min-w-0 flex-1 select-all truncate rounded bg-white px-1.5 py-1 text-micro text-slate-800 ring-1 ring-amber-200">
                {secret}
              </code>
              <button onClick={() => copy('secret', secret)} className="shrink-0 rounded border border-amber-300 bg-white px-2 py-0.5 text-micro font-medium text-amber-900">
                {copied === 'secret' ? <Check size={11} /> : <Copy size={11} />}
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-micro font-semibold uppercase tracking-wide text-slate-500">For an agent that calls over HTTP</p>
              <button onClick={() => copy('http', httpConfig)} className="text-micro font-medium text-indigo-700 hover:underline">
                {copied === 'http' ? 'copied' : 'copy'}
              </button>
            </div>
            <pre className="mt-0.5 max-h-40 overflow-auto rounded bg-slate-900 px-2 py-1.5 text-micro text-slate-100">{httpConfig}</pre>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-micro font-semibold uppercase tracking-wide text-slate-500">For an agent on your machine</p>
              <button onClick={() => copy('stdio', stdioConfig)} className="text-micro font-medium text-indigo-700 hover:underline">
                {copied === 'stdio' ? 'copied' : 'copy'}
              </button>
            </div>
            <pre className="mt-0.5 max-h-40 overflow-auto rounded bg-slate-900 px-2 py-1.5 text-micro text-slate-100">{stdioConfig}</pre>
            <p className="mt-1 text-micro text-slate-600">
              The stdio bridge forwards to this instance; it holds no rules of its own. On a machine where{' '}
              <code>flowline login</code> has run, point <code>FLOWLINE_TOKEN_FILE</code> at the file instead of pasting the secret.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-0">
            <span className="block text-micro font-medium text-slate-600">What is it for?</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Agent name"
              className="mt-0.5 w-56 rounded-md border border-slate-200 px-2 py-1 text-meta text-slate-800 outline-none focus:border-indigo-400"
            />
          </label>
          <label className="flex items-center gap-1.5 text-meta text-slate-700">
            <input type="checkbox" checked={write} onChange={(event) => setWrite(event.target.checked)} aria-label="Let the agent change cards" />
            let it change cards
          </label>
          <button
            onClick={() => void create()}
            disabled={busy}
            className={cn('rounded-md bg-slate-900 px-2.5 py-1 text-meta font-medium text-white hover:bg-slate-800', busy && 'opacity-40')}
          >
            {busy ? 'Making…' : 'Make the token'}
          </button>
          {error && <p className="w-full text-meta font-medium text-rose-700">{error}</p>}
          <p className="w-full text-micro text-slate-600">
            It will be able to {write ? 'read the board and change cards' : `read and comment — ${SCOPES['boards:read'].label}, ${SCOPES['items:read'].label}`}. Every
            write it makes is in the trail under your name, naming the token.
          </p>
        </div>
      )}
    </section>
  )
}
