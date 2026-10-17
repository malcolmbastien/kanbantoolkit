import { useStore } from '@/store'

/**
 * Narrow the initiatives flow to one kind.
 *
 * It lives in the workflow it narrows — next to the heading that says what is being narrowed, the
 * place the cards workflow keeps its own Filters button — and it narrows *what the flow shows* and
 * nothing else: not the cards workflow, not the dashboard, the timeline or the strategy map, and
 * never a count. A cell's badge reads the column, as everywhere.
 *
 * Nothing renders when the board has no kinds, because there is nothing to narrow by: an
 * initiatives flow of unlabelled work has no kinds in it.
 */
export function KindFilter({ boardId }: { boardId: string }) {
  const kinds = useStore((s) => s.boards.find((b) => b.id === boardId)?.initiativeTypes ?? [])
  const kindFilter = useStore((s) => s.initiativeKindFilter)
  const setInitiativeKindFilter = useStore((s) => s.setInitiativeKindFilter)

  if (kinds.length === 0) return null

  return (
    <label className="flex shrink-0 items-center gap-1.5 text-micro text-slate-600">
      Kind
      <select
        value={kindFilter ?? ''}
        onChange={(e) => setInitiativeKindFilter(e.target.value || null)}
        title="Show only the initiatives of one kind — the flow narrows, nothing else moves"
        className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-micro text-slate-700"
      >
        <option value="">All kinds</option>
        {kinds.map((k) => (
          <option key={k.id} value={k.id}>
            {k.name}
          </option>
        ))}
      </select>
    </label>
  )
}
