import { useState } from 'react'
import { Archive, RotateCcw, Search } from 'lucide-react'
import { archiveOutcome, type Graph } from '@/domain/derive'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType } from '@/domain/types'
import { VocabularySaveError } from './VocabularySaveError'

/**
 * The Archive: filed-away items. They have left the boards (so boards don't clutter), but they are
 * still here — searchable, linked, and restorable.
 *
 * The archive says one thing about each item: whether its work was finished. A card in a Done
 * column is *completed*; anything else is *discarded*, dropped from the board without claiming it
 * was done. The column it happened to sit in is not an archive's business, and an item's place in
 * the board can change long after it left — so the word is kept from the moment it was filed.
 */
export function ArchiveView() {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const boards = useStore((s) => s.boards)
  const issueTypes = useStore((s) => s.issueTypes)
  const autoArchiveDays = useStore((s) => s.autoArchiveDays)
  const setAutoArchiveDays = useStore((s) => s.setAutoArchiveDays)
  const unarchiveItem = useStore((s) => s.unarchiveItem)
  const openItem = useStore((s) => s.openItem)

  const [q, setQ] = useState('')

  const graph: Graph = { items, edges, links, placements, lanes }
  const typeOf = (id: string): IssueType => issueTypes.find((t) => t.id === id) ?? { id, name: 'Item', color: '#64748b' }

  const archived = items
    .filter((i) => i.archived)
    .filter((i) => i.title.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))

  const boardOf = (id: string) => boards.find((b) => b.id === placements.find((p) => p.itemId === id)?.boardId)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-slate-200 p-4">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2 rounded-lg border border-amber-300 bg-amber-50/70 px-4 py-3">
          <div>
            <div className="flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-amber-700">
              <Archive size={12} /> Archive
            </div>
            <div className="text-heading font-semibold text-slate-800">
              {archived.length} filed item{archived.length === 1 ? '' : 's'}
            </div>
            <div className="text-meta text-slate-600">
              Finished work is archived, unfinished work is discarded — either way it leaves the boards and stays restorable.
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-meta text-slate-600">
              Auto-archive Done after
              <input
                type="number"
                min={0}
                value={autoArchiveDays ?? ''}
                placeholder="off"
                onChange={(e) => setAutoArchiveDays(e.target.value === '' ? undefined : Number(e.target.value))}
                className="w-16 rounded border border-slate-300 px-1.5 py-1 text-meta outline-none focus:ring-2 focus:ring-amber-300"
              />
              days
            </label>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search archive…"
                className="w-48 rounded-md border border-slate-300 py-1 pl-7 pr-2 text-meta outline-none focus:ring-2 focus:ring-amber-300"
              />
            </div>
          </div>
          {/* The policy is the workspace's, not this browser's: a refusal is said beside it. */}
          <div className="w-full">
            <VocabularySaveError lists={['autoArchiveDays']} />
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100 text-micro uppercase tracking-wide text-slate-600">
                <th className="px-4 py-2 font-semibold">Item</th>
                <th className="px-4 py-2 font-semibold">Board</th>
                <th className="px-4 py-2 font-semibold">Outcome</th>
                <th className="px-4 py-2 font-semibold">Archived</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {archived.map((item) => {
                const type = typeOf(item.typeId)
                const outcome = archiveOutcome(item, graph)
                return (
                  <tr
                    key={item.id}
                    onClick={() => openItem(item.id, { focus: false })}
                    className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-200"
                  >
                    <td className="max-w-[320px] px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded px-1 py-px text-micro font-bold uppercase tracking-wide" style={{ backgroundColor: type.color, color: '#fff' }}>
                          {type.name}
                        </span>
                      </div>
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          openItem(item.id, { focus: false })
                        }}
                        className="block max-w-full truncate text-left text-body font-semibold text-slate-800 hover:text-indigo-600"
                      >
                        {item.title}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-meta text-slate-600">{boardOf(item.id)?.name ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span
                        title={
                          outcome === 'completed'
                            ? 'The work was done when it was filed away'
                            : 'The work was not done when it was filed away'
                        }
                        className={cn(
                          'rounded px-1.5 py-0.5 text-micro font-bold',
                          outcome === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700',
                        )}
                      >
                        {outcome === 'completed' ? 'Completed' : 'Discarded'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-meta text-slate-600">
                      {item.archivedAt ? new Date(item.archivedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          unarchiveItem(item.id)
                        }}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-meta font-medium text-slate-600 hover:bg-slate-50"
                      >
                        <RotateCcw size={11} /> Restore
                      </button>
                    </td>
                  </tr>
                )
              })}
              {archived.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-meta text-slate-600">
                    Nothing archived{q ? ' matches your search' : ' yet'}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
