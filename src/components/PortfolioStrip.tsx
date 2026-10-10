import { Sparkles } from 'lucide-react'
import { computeLevel, portfolioStatus } from '@/domain/derive'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Item } from '@/domain/types'

/** The exec read: status computed from committed work, never typed. */
export function PortfolioStrip() {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const sponsors = useStore((s) => s.sponsors)
  const openItem = useStore((s) => s.openItem)
  const graph = { items, edges }
  const initiatives = items.filter((i) => computeLevel(i, graph).level === 'L1')

  const tone: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
    sky: 'bg-sky-50 text-sky-700 ring-sky-200',
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  }

  return (
    <div className="flex flex-wrap items-stretch gap-2 border-b border-slate-300 bg-slate-100 px-3 py-2">
      <div className="flex items-center gap-1 pr-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <Sparkles size={12} /> Portfolio rollup
      </div>
      {initiatives.map((i: Item) => {
        const status = portfolioStatus(i, graph)
        const record = sponsors[i.id]
        return (
          <button
            key={i.id}
            onClick={() => openItem(i.id)}
            className="flex min-w-[240px] flex-col rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-left shadow-sm transition hover:border-slate-400 hover:shadow-md"
          >
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12px] font-semibold text-slate-800">{i.title}</span>
              <span className={cn('ml-auto rounded px-1 py-px text-[9px] font-bold ring-1', tone[status.tone])}>
                {status.label}
              </span>
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              {status.rationale}
            </div>
            <div className="mt-0.5 text-[10px]">
              {record ? (
                <span className="text-emerald-600">sponsor confirmed {record.decision}</span>
              ) : (
                <span className="text-indigo-600">recommend: {status.recommendation}</span>
              )}
            </div>
          </button>
        )
      })}
      {initiatives.length === 0 && (
        <span className="text-[11px] text-slate-400">No initiatives at this resolution.</span>
      )}
    </div>
  )
}
