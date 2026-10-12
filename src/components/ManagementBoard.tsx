import { useState } from 'react'
import { ChevronDown, ChevronRight, Crosshair, ExternalLink, Layers, Plus, TriangleAlert, X } from 'lucide-react'
import { BandBadge } from './BandBadge'
import { BoardSummary } from './BoardSummary'
import { initiativeTypeId, linkableBoards } from '@/domain/board'
import { okrCoverage } from '@/domain/derive'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

/**
 * An aggregating board (coordination or strategic), Kanbanize-style:
 *  - an "Initiatives workflow" of its own initiatives (wide summary cards with a
 *    progress bar and linked-initiative symbols)
 *  - "Linked boards": the summary flow of every board it aggregates — teams or
 *    other coordination boards, at any depth.
 */
export function ManagementBoard({ boardId }: { boardId: string }) {
  const boards = useStore((s) => s.boards)
  const addLinkedBoard = useStore((s) => s.addLinkedBoard)
  const removeLinkedBoard = useStore((s) => s.removeLinkedBoard)
  const selectBoard = useStore((s) => s.selectBoard)
  const items = useStore((s) => s.items)
  const placements = useStore((s) => s.placements)
  const edges = useStore((s) => s.edges)
  const objectives = useStore((s) => s.objectives)
  const issueTypes = useStore((s) => s.issueTypes)
  const openItem = useStore((s) => s.openItem)
  const setObjectives = useStore((s) => s.setObjectives)
  const lensId = useStore((s) => s.lensId)
  const clearLens = useStore((s) => s.clearLens)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [pick, setPick] = useState('')

  const board = boards.find((b) => b.id === boardId)
  if (!board) return null

  const linkedIds = board.linkedBoardIds ?? []
  const linked = linkedIds.map((id) => boards.find((b) => b.id === id)).filter((b): b is NonNullable<typeof b> => Boolean(b))
  // Any board that keeps the aggregation graph acyclic and isn't already linked.
  const candidates = linkableBoards(boards, board.id).filter((b) => !linkedIds.includes(b.id))
  const isPortfolio = board.band === 'portfolio'

  const section = (
    key: string,
    title: React.ReactNode,
    body: React.ReactNode,
    right?: React.ReactNode,
    collapsible = true,
    accent: 'violet' | 'slate' = 'slate',
  ) => {
    const isCollapsed = collapsed[key]
    return (
      <section key={key} className={cn('rounded-lg border shadow-sm', accent === 'violet' ? 'border-violet-300 bg-violet-50/60' : 'border-slate-300 bg-slate-100')}>
        <div className={cn('flex items-center gap-2 rounded-t-lg border-b px-3 py-1.5 text-slate-200', accent === 'violet' ? 'border-violet-300 bg-violet-800' : 'border-slate-300 bg-slate-800')}>
          {collapsible && (
            <button onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))} className="text-slate-300 hover:text-white">
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          {title}
          {right && <span className="ml-auto flex items-center gap-1">{right}</span>}
        </div>
        {!isCollapsed && <div>{body}</div>}
      </section>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-950/40 bg-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
        <BandBadge band={board.band} />
        <span className="font-semibold text-white">{board.name}</span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-400">{isPortfolio ? 'portfolio board' : 'program board'}</span>
        {lensId && (
          <span className="flex items-center gap-1 rounded bg-indigo-500/20 px-1.5 py-px font-medium text-indigo-200">
            <Crosshair size={11} /> Focused: {items.find((i) => i.id === lensId)?.title ?? '—'}
            <button onClick={clearLens} className="ml-0.5 text-indigo-200 hover:text-white" title="Clear focus">
              <X size={10} />
            </button>
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* Initiatives workflow */}
        {section(
          `${board.id}-initiatives`,
          <>
            <span className="text-[12px] font-bold uppercase tracking-wide text-white">Initiatives workflow</span>
            <span className="text-[10px] text-violet-200">{isPortfolio ? 'strategic initiatives' : 'the outcomes this board owns'}</span>
          </>,
          <BoardSummary boardId={board.id} rootsOnly variant="initiatives" />,
          undefined,
          true,
          'violet',
        )}

        {/* OKR coverage — the strategic lens. Gaps are first-class. */}
        {isPortfolio &&
          (() => {
            const initId = initiativeTypeId(issueTypes)
            const own = items.filter(
              (i) => i.typeId === initId && placements.some((p) => p.itemId === i.id && p.boardId === board.id),
            )
            const { unmapped, unserved } = okrCoverage(own, objectives, edges)
            const chip = (label: string, onClick: () => void) => (
              <button
                key={label}
                onClick={onClick}
                className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800 hover:bg-amber-100"
              >
                <TriangleAlert size={10} /> {label}
              </button>
            )
            return section(
              `${board.id}-coverage`,
              <>
                <span className="text-[12px] font-bold uppercase tracking-wide text-white">OKR coverage</span>
                <span className="text-[10px] text-slate-400">
                  {own.length} strategic initiative{own.length === 1 ? '' : 's'} · {objectives.length} OKR
                  {objectives.length === 1 ? '' : 's'} · {unmapped.length + unserved.length} gap
                  {unmapped.length + unserved.length === 1 ? '' : 's'}
                </span>
              </>,
              <div className="space-y-2 p-2 text-[12px]">
                <div>
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Strategic initiatives with no OKR
                  </div>
                  {unmapped.length === 0 ? (
                    <p className="text-[11px] text-slate-400">Every strategic initiative carries an OKR.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">{unmapped.map((i) => chip(i.title, () => openItem(i.id)))}</div>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    OKRs with no strategic initiative
                  </div>
                  {unserved.length === 0 ? (
                    <p className="text-[11px] text-slate-400">Every OKR is served by a strategic initiative.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">{unserved.map((o) => chip(o.title, () => setObjectives(true)))}</div>
                  )}
                </div>
                <p className="text-[10px] text-slate-400">
                  OKRs attach to strategic initiatives only — open one to map it. Everything below inherits through the decomposition.
                </p>
              </div>,
              undefined,
              true,
              'slate',
            )
          })()}

        {/* Linked boards — teams or other coordination boards */}
        {section(
          `${board.id}-linked`,
          <>
            <span className="text-[12px] font-bold uppercase tracking-wide text-white">Linked boards</span>
            <span className="text-[10px] text-slate-400">
              {linked.length} board{linked.length === 1 ? '' : 's'} roll up here
            </span>
          </>,
          <div className="space-y-3 p-2">
            {linked.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-[12px] text-slate-500">
                Nothing linked yet. Link a team board — or another coordination board — to roll its initiatives up here.
              </div>
            )}
            {linked.map((t) => {
              const isCollapsed = collapsed[`linked-${t.id}`]
              return (
                <div key={t.id} className="rounded-md border border-slate-300 bg-slate-100">
                  <div className="flex items-center gap-2 rounded-t-md bg-slate-700 px-3 py-1.5 text-slate-100">
                    <button onClick={() => setCollapsed((c) => ({ ...c, [`linked-${t.id}`]: !c[`linked-${t.id}`] }))} className="text-slate-300 hover:text-white">
                      {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <BandBadge band={t.band} />
                    <span className="text-[11px] font-semibold text-white">{t.name}</span>
                    <span className="ml-auto flex items-center gap-1">
                      <button
                        onClick={() => selectBoard(t.id)}
                        className="flex items-center gap-1 rounded border border-slate-500 px-1.5 py-0.5 text-[10px] font-medium text-slate-200 hover:text-white"
                        title="Open this board"
                      >
                        <ExternalLink size={10} /> open
                      </button>
                      <button
                        onClick={() => removeLinkedBoard(board.id, t.id)}
                        className="text-slate-300 hover:text-rose-300"
                        title="Unlink this board"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  </div>
                  {!isCollapsed && <BoardSummary boardId={t.id} />}
                </div>
              )
            })}
          </div>,
          <>
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="rounded-md border border-slate-600 bg-slate-700 px-1.5 py-1 text-[11px] text-slate-100 outline-none"
            >
              <option value="">Link a board…</option>
              {candidates.map((b) => (
                <option key={b.id} value={b.id} className="bg-slate-800 text-slate-100">{b.name}</option>
              ))}
            </select>
            <button
              disabled={!pick}
              onClick={() => {
                addLinkedBoard(board.id, pick)
                setPick('')
              }}
              className="flex items-center gap-1 rounded-md bg-indigo-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
            >
              <Plus size={12} /> Link
            </button>
          </>,
          false,
        )}

        <div className="flex items-center gap-1 px-1 text-[10px] text-slate-400">
          <Layers size={11} /> Each band is a rollup of that board’s initiatives — Not Started / In Progress / Done. Card symbols show linked initiatives.
        </div>
      </div>
    </div>
  )
}
