import { Ban, CalendarClock, Layers, Target } from 'lucide-react'
import { blockedBelow, decompositionChildren, decompositionParent, rollupOf, type Graph } from '@/domain/derive'
import { buildRefs } from '@/domain/board'
import { STAGE_LABELS } from '@/domain/lanes'
import { stageChip } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType, Item, Stage } from '@/domain/types'

const barColor = (pct: number) => (pct >= 100 ? '#10b981' : pct > 0 ? '#6366f1' : '#cbd5e1')

/** Parse an ISO 'YYYY-MM-DD' as a local date so it doesn't shift a day. */
function parseDate(iso?: string): Date | undefined {
  return iso ? new Date(`${iso}T00:00:00`) : undefined
}
function formatDate(iso?: string): string {
  const d = parseDate(iso)
  return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
}

/**
 * A summary dashboard for a management board: the board's initiatives with their
 * rolled-up work progress, target date, computed status, and an indicator of any
 * blocked work down the chain.
 *
 * Kept deliberately as a read-only overview — projection and richer health
 * signals can be layered on later without changing this shape.
 */
export function ManagementDashboard({ boardId }: { boardId: string }) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)
  const boards = useStore((s) => s.boards)
  const openItem = useStore((s) => s.openItem)
  const selectedItemId = useStore((s) => s.selectedItemId)

  const graph: Graph = { items, edges, links, placements, lanes }
  const refs = buildRefs(items, issueTypes)
  const typeOf = (typeId: string): IssueType =>
    issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const board = boards.find((b) => b.id === boardId)
  const teamBoardNames = (board?.teamBoardIds ?? [])
    .map((id) => boards.find((b) => b.id === id)?.name)
    .filter((n): n is string => Boolean(n))

  const onBoard = placements
    .filter((p) => p.boardId === boardId)
    .map((p) => items.find((i) => i.id === p.itemId))
    .filter((i): i is Item => Boolean(i))

  // Board-local top-level initiatives — an initiative whose parent is not on this
  // board is top-level here (the same set the Initiatives workflow shows).
  const onBoardIds = new Set(onBoard.map((i) => i.id))
  const initiativeTypeId = issueTypes.find((t) => t.name === 'Initiative')?.id
  const initiatives = (
    initiativeTypeId
      ? onBoard.filter((i) => i.typeId === initiativeTypeId)
      : onBoard.filter((i) => decompositionChildren(i.id, edges).length > 0)
  ).filter((i) => !i.archived).filter((i) => {
    const parent = decompositionParent(i.id, edges)
    return !parent || !onBoardIds.has(parent)
  })

  const rows = initiatives.map((item) => {
    const roll = rollupOf(item.id, graph)
    const blocked = blockedBelow(item.id, graph)
    const target = parseDate(item.targetEndDate)
    const overdue = Boolean(target && roll.bucket !== 'done' && target.getTime() < Date.now())
    const childInits = decompositionChildren(item.id, edges).filter(
      (id) => items.find((i) => i.id === id)?.typeId === initiativeTypeId,
    ).length
    return { item, roll, blocked, target, overdue, childInits }
  })

  const blockedInitiatives = rows.filter((r) => r.blocked > 0).length
  const doneInitiatives = rows.filter((r) => r.roll.bucket === 'done').length

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-slate-200 p-4">
      <div className="mx-auto w-full max-w-5xl">
        {/* Header */}
        <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2 rounded-lg border border-violet-300 bg-violet-50/70 px-4 py-3">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-violet-700">
              <Target size={12} /> Portfolio dashboard
            </div>
            <div className="text-[16px] font-semibold text-slate-800">{board?.name ?? 'Management board'}</div>
            {teamBoardNames.length > 0 && (
              <div className="text-[11px] text-slate-500">Rolls up {teamBoardNames.join(' · ')}</div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-4 text-[11px] text-slate-600">
            <Stat label="Initiatives" value={rows.length} />
            <Stat label="Done" value={doneInitiatives} tone="emerald" />
            <Stat label="With blocked work" value={blockedInitiatives} tone={blockedInitiatives > 0 ? 'rose' : undefined} />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-semibold">Initiative</th>
                <th className="px-4 py-2 font-semibold">Work progress</th>
                <th className="px-4 py-2 font-semibold">Target date</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Blocked below</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, roll, blocked, overdue, childInits }) => {
                const type = typeOf(item.typeId)
                const bucket = roll.bucket as Stage
                return (
                  <tr
                    key={item.id}
                    onClick={() => openItem(item.id)}
                    className={cn(
                      'cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-slate-50',
                      selectedItemId === item.id && 'bg-indigo-50',
                    )}
                  >
                    <td className="max-w-[280px] px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide"
                          style={{ backgroundColor: type.color, color: '#fff' }}
                        >
                          {type.name}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-400">{refs.get(item.id)}</span>
                      </div>
                      <div className="truncate text-[13px] font-semibold text-slate-800">{item.title}</div>
                      {childInits > 0 && (
                        <div className="flex items-center gap-1 text-[10px] text-slate-400" title={`${childInits} child initiatives`}>
                          <Layers size={10} /> {childInits} child initiative{childInits === 1 ? '' : 's'}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full transition-all" style={{ width: `${roll.percent}%`, backgroundColor: barColor(roll.percent) }} />
                        </div>
                        <span className="w-9 text-right text-[12px] font-bold tabular-nums text-slate-600">{roll.percent}%</span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {roll.done} of {roll.total} done
                        {roll.inProgress > 0 ? ` · ${roll.inProgress} active` : ''}
                      </div>
                    </td>

                    <td className="px-4 py-2.5">
                      <div className={cn('flex items-center gap-1 text-[12px]', overdue ? 'font-semibold text-rose-600' : 'text-slate-600')}>
                        <CalendarClock size={12} className={overdue ? 'text-rose-500' : 'text-slate-400'} />
                        {item.targetStartDate ? `${formatDate(item.targetStartDate)} → ` : ''}
                        {formatDate(item.targetEndDate)}
                      </div>
                      {overdue && <div className="text-[10px] font-semibold text-rose-500">overdue</div>}
                    </td>

                    <td className="px-4 py-2.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', stageChip(bucket))}>
                        {STAGE_LABELS[bucket]}
                      </span>
                    </td>

                    <td className="px-4 py-2.5">
                      {blocked > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200">
                          <Ban size={11} /> {blocked} blocked
                        </span>
                      ) : (
                        <span className="text-[12px] text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[12px] text-slate-400">
                    No initiatives on this board yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] text-slate-400">
          Work progress and status are computed from the leaf work beneath each initiative. Blocked below counts explicitly
          blocked descendants anywhere in the chain.
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'rose' }) {
  return (
    <div className="text-center">
      <div
        className={cn(
          'text-[18px] font-bold tabular-nums leading-none',
          tone === 'emerald' ? 'text-emerald-600' : tone === 'rose' ? 'text-rose-600' : 'text-slate-700',
        )}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  )
}
