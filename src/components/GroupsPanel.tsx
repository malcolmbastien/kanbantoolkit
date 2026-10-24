import { useCallback, useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { ROLES } from '@/domain/roles'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

/**
 * Groups: a role granted once to many.
 *
 * A group is a name, the people in it, and the role it carries here. The screen is deliberately
 * flat — no tree, no nesting — because a group has no authority of its own: it is a way of writing
 * down the same role for several people at once, and the role it writes is the role a person would
 * otherwise have had directly.
 *
 * Two things the screen says out loud rather than hiding: a group can be **turned off** instead of
 * deleted (the reversible answer), and it cannot be left holding the last administrator of the
 * workspace — the server refuses that, and the refusal is shown in its own words.
 */

interface Person {
  id: string
  name: string
  email: string
}

interface Group {
  id: string
  name: string
  description?: string
  active: boolean
  members: Person[]
  roles: Record<string, string>
}

const FIELD =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'
const BUTTON = 'rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'

export function GroupsPanel() {
  const askConfirm = useStore((state) => state.askConfirm)
  const [groups, setGroups] = useState<Group[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [workspaceId, setWorkspaceId] = useState('workspace')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [adding, setAdding] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, directory] = await Promise.all([
        fetch('/api/admin/groups', { headers: { accept: 'application/json' } }),
        fetch('/api/admin/users?limit=200', { headers: { accept: 'application/json' } }),
      ])
      if (!list.ok) {
        setError('Only an instance administrator can see the groups here.')
        return
      }
      const body = (await list.json()) as { groups: Group[]; workspaceId: string }
      setGroups(body.groups)
      setWorkspaceId(body.workspaceId)
      if (directory.ok) setPeople(((await directory.json()) as { people: Person[] }).people)
    } catch {
      setError('The server could not be reached.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** One call shape for every write: report what the server said, never guess at it. */
  async function call(key: string, path: string, init: RequestInit, done: string) {
    setBusy(key)
    setMessage(undefined)
    try {
      const response = await fetch(path, init)
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setMessage({ tone: 'bad', text: body?.error ?? 'That could not be done.' })
        return false
      }
      setMessage({ tone: 'ok', text: done })
      await load()
      // The People table on this same screen shows the role a group grants, so it is told to read
      // the directory again rather than showing yesterday's answer beside today's group.
      window.dispatchEvent(new Event('flowline:directory-changed'))
      return true
    } catch {
      setMessage({ tone: 'bad', text: 'The server could not be reached.' })
      return false
    } finally {
      setBusy(null)
    }
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  async function create() {
    if (!name.trim()) return
    const created = await call(
      'create',
      '/api/admin/groups',
      json('POST', { name: name.trim(), description: description.trim() || undefined }),
      `“${name.trim()}” was created.`,
    )
    if (created) {
      setName('')
      setDescription('')
    }
  }

  async function addPerson(group: Group, userId: string) {
    if (!userId) return
    await call('add', `/api/admin/groups/${group.id}/members`, json('POST', { userId }), 'Added.')
    setAdding(null)
  }

  async function remove(group: Group) {
    askConfirm({
      title: `Delete “${group.name}”?`,
      body: 'Its members lose the role it gives them, unless they hold it another way. Turning it off instead keeps the list.',
      confirmLabel: 'Delete group',
      danger: true,
      onConfirm: () => {
        void call('delete', `/api/admin/groups/${group.id}`, { method: 'DELETE' }, 'Deleted.')
      },
    })
  }

  if (error) return <p className="mt-6 rounded-xl bg-rose-50 px-3 py-2 text-meta text-rose-800">{error}</p>

  return (
    <section className="mt-6 rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-body font-semibold text-slate-900">Groups</h2>
        <span className="text-meta text-slate-600">
          {groups.length === 0 ? 'a role granted once to many' : `${groups.filter((group) => group.active).length} active of ${groups.length}`}
        </span>
      </div>

      {message && (
        <p
          className={cn(
            'mt-2 rounded-md px-2 py-1 text-meta',
            message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800',
          )}
        >
          {message.text}
        </p>
      )}

      <div className="mt-3 space-y-2">
        {groups.map((group) => {
          const role = group.roles[workspaceId] ?? ''
          return (
            <div
              key={group.id}
              className={cn(
                'rounded-lg border px-2.5 py-2',
                group.active ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-50',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-meta font-semibold text-slate-800">{group.name}</span>
                {!group.active && <span className="rounded bg-slate-200 px-1.5 py-px text-micro font-bold uppercase text-slate-700">off</span>}
                <span className="text-micro text-slate-600">{group.description}</span>

                <span className="ml-auto flex items-center gap-1.5">
                  <label className="text-micro text-slate-600">
                    Role here
                    <select
                      value={role}
                      onChange={(event) =>
                        void call(
                          `role-${group.id}`,
                          `/api/admin/groups/${group.id}/role`,
                          json('PUT', { role: event.target.value || null, workspaceId }),
                          event.target.value ? `Now ${event.target.value} here.` : 'No role here now.',
                        )
                      }
                      disabled={busy !== null}
                      aria-label={`Role ${group.name} carries in this workspace`}
                      className={cn(FIELD, 'ml-1')}
                    >
                      <option value="">no role</option>
                      {ROLES.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={() =>
                      void call(
                        `active-${group.id}`,
                        `/api/admin/groups/${group.id}`,
                        json('PATCH', { active: !group.active }),
                        group.active ? 'Turned off — it grants nothing now.' : 'Turned on.',
                      )
                    }
                    disabled={busy !== null}
                    className={cn(BUTTON, 'px-1.5 text-micro')}
                  >
                    {group.active ? 'Turn off' : 'Turn on'}
                  </button>
                  <button onClick={() => remove(group)} disabled={busy !== null} className={cn(BUTTON, 'px-1.5 text-micro')}>
                    Delete
                  </button>
                </span>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {group.members.length === 0 && <span className="text-micro text-slate-600">Nobody in this group.</span>}
                {group.members.map((member) => (
                  <span
                    key={member.id}
                    className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-micro text-slate-700"
                  >
                    {member.name}
                    <button
                      onClick={() =>
                        void call(
                          `remove-${member.id}`,
                          `/api/admin/groups/${group.id}/members/${member.id}`,
                          { method: 'DELETE' },
                          `${member.name} was removed.`,
                        )
                      }
                      disabled={busy !== null}
                      aria-label={`Remove ${member.name} from ${group.name}`}
                      className="rounded p-0.5 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-40"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {adding === group.id ? (
                  <select
                    autoFocus
                    value=""
                    onChange={(event) => void addPerson(group, event.target.value)}
                    onBlur={() => setAdding(null)}
                    aria-label={`Add somebody to ${group.name}`}
                    className={cn(FIELD, 'text-micro')}
                  >
                    <option value="">choose a person…</option>
                    {people
                      .filter((person) => !group.members.some((member) => member.id === person.id))
                      .map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  <button
                    onClick={() => setAdding(group.id)}
                    disabled={!group.active}
                    title={group.active ? 'Add somebody to this group' : 'Turn the group on first'}
                    className="flex items-center gap-0.5 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-micro text-slate-600 hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-40"
                  >
                    <Plus size={10} /> person
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <form
        className="mt-3 flex flex-wrap items-end gap-1.5 border-t border-slate-100 pt-2.5"
        onSubmit={(event) => {
          event.preventDefault()
          void create()
        }}
      >
        <label className="text-micro font-semibold uppercase tracking-wide text-slate-500">
          New group
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Platform Leads"
            className={cn(FIELD, 'mt-1 block w-44')}
          />
        </label>
        <label className="text-micro font-semibold uppercase tracking-wide text-slate-500">
          What it is for
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="optional"
            className={cn(FIELD, 'mt-1 block w-56')}
          />
        </label>
        <button type="submit" disabled={busy !== null || !name.trim()} className={BUTTON}>
          Create group
        </button>
      </form>

      <p className="mt-1.5 text-micro text-slate-600">
        A group grants the role it carries to the people in it — the highest of that and their own role wins. Turning it off
        takes the grant away immediately and keeps the list.
      </p>
    </section>
  )
}
