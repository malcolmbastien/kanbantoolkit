import { HEALTH_META } from '@/domain/health'
import { parseDay } from '@/domain/filters'
import type { PortfolioHeatmap as Heatmap, PortfolioRow } from '@/domain/portfolio'
import { PORTFOLIO_RISK_STYLES } from '@/lib/colors'
import { cn } from '@/lib/utils'

/**
 * The portfolio's reading of risk, above the objective flows.
 *
 * The strategy map is the answer to "what serves what"; this table is the answer to "where is it
 * concentrated". Every cell is derived — coverage from attribution, progress from the same rollup
 * the objective card shows, health from the initiatives that serve it, the date from their targets
 * — and every cell says its reading in words, so colour is a glance rather than the only answer.
 * The objective's name is a button into its own flow below, which is where the detail lives.
 */
export function PortfolioHeatmap({ heatmap }: { heatmap: Heatmap }) {
  if (heatmap.rows.length === 0) return null

  const scrollTo = (id: string) => {
    document.getElementById(`objective-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section data-portfolio-heatmap aria-labelledby="portfolio-heatmap-title" className="rounded-lg border border-slate-300 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 px-3 py-2">
        <h2 id="portfolio-heatmap-title" className="text-body font-semibold text-slate-800">
          Portfolio at a glance
        </h2>
        <span className="text-micro text-slate-600">
          {heatmap.counts.objectives} objective{heatmap.counts.objectives === 1 ? '' : 's'} by period
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5" aria-label="Risk legend">
          {(Object.keys(PORTFOLIO_RISK_STYLES) as Array<keyof typeof PORTFOLIO_RISK_STYLES>).map((risk) => (
            <span key={risk} className="flex items-center gap-1 text-micro text-slate-600">
              <span className={cn('rounded px-1 py-px text-micro font-semibold ring-1', PORTFOLIO_RISK_STYLES[risk].chip)}>
                {PORTFOLIO_RISK_STYLES[risk].label}
              </span>
              <span className="tabular-nums">{heatmap.counts[risk]}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[54rem] border-collapse text-meta">
          <caption className="sr-only">
            Objectives by period, with coverage, progress, health and the nearest target date. Each row is a way into the
            objective's own flow below.
          </caption>
          <thead className="bg-slate-50 text-left text-micro font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-1.5">Objective</th>
              <th scope="col" className="px-3 py-1.5">Period</th>
              <th scope="col" className="px-3 py-1.5">Coverage</th>
              <th scope="col" className="px-3 py-1.5">Progress</th>
              <th scope="col" className="px-3 py-1.5">Health</th>
              <th scope="col" className="px-3 py-1.5">Target</th>
            </tr>
          </thead>
          <tbody>
            {heatmap.rows.map((row) => (
              <Row key={row.objective.id} row={row} onOpen={() => scrollTo(row.objective.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Row({ row, onOpen }: { row: PortfolioRow; onOpen: () => void }) {
  const risk = PORTFOLIO_RISK_STYLES[row.risk]
  const health = row.health.level === 'none' ? undefined : HEALTH_META[row.health.level]
  const target = parseDay(row.targetEnd)?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return (
    <tr data-portfolio-row={row.objective.id} data-risk={row.risk} className={cn('border-t border-slate-100 align-top', risk.row)}>
      <th scope="row" className="max-w-[18rem] px-3 py-2 text-left font-normal">
        <button
          onClick={onOpen}
          className="block max-w-full truncate text-left font-semibold text-slate-800 underline-offset-2 hover:text-indigo-700 hover:underline"
          title={`Read ${row.objective.title} in its flow below`}
        >
          {row.objective.title}
        </button>
        <span className={cn('mt-1 inline-block rounded px-1 py-px text-micro font-semibold ring-1', risk.chip)}>{risk.label}</span>
      </th>
      <td className="whitespace-nowrap px-3 py-2 text-slate-600">{row.objective.period}</td>
      <td className="px-3 py-2 text-slate-700">
        {row.coverageGap ? (
          <span className="font-medium text-amber-800">No initiative</span>
        ) : (
          <span>
            {row.serving.length} serving
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        {row.rollup ? (
          <div className="flex items-center gap-2">
            <span className="w-9 text-right font-semibold tabular-nums text-slate-800">{row.rollup.percent}%</span>
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
              <span className="block h-full rounded-full bg-violet-500" style={{ width: `${row.rollup.percent}%` }} />
            </span>
            <span className="whitespace-nowrap text-micro text-slate-500">
              {row.rollup.done}/{row.rollup.total} done
            </span>
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        {health ? (
          <span className={cn('inline-block rounded px-1.5 py-px text-micro font-semibold ring-1', health.chip)}>{health.label}</span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
        {(row.health.risk > 0 || row.health.watch > 0) && (
          <div className="mt-0.5 text-micro text-slate-500">
            {row.health.risk > 0 && `${row.health.risk} risk`}
            {row.health.risk > 0 && row.health.watch > 0 && ' · '}
            {row.health.watch > 0 && `${row.health.watch} watch`}
          </div>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-slate-700">
        {target ?? '—'}
        {row.overdue > 0 && (
          <div className="text-micro font-semibold text-orange-700">
            {row.overdue} overdue
          </div>
        )}
      </td>
    </tr>
  )
}
