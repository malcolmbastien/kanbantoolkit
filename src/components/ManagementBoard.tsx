import { useState } from 'react'
import { ChevronDown, ChevronRight, Crosshair, ExternalLink, Layers, Plus, X } from 'lucide-react'
import { BandBadge } from './BandBadge'
import { BoardSummary } from './BoardSummary'
import { StrategyMap } from './StrategyMap'
import { BAND_ACCENT } from '@/lib/colors'
import { linkableBoards } from '@/domain/board'
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
  // The initiatives surface wears the board's band colour (Team = green, Program = blue, Portfolio = violet).
  const accent = BAND_ACCENT[board.band]
  const slateSkin = { section: 'border-slate-300 bg-slate-100', header: 'border-slate-300 bg-slate-800' }

  const section = (
    key: string,
    title: React.ReactNode,
    body: React.ReactNode,
    right?: React.ReactNode,
    collapsible = true,
    tone: 'band' | 'slate' = 'slate',
  ) => {
    const isCollapsed = collapsed[key]
    const skin = tone === 'band' ? accent : slateSkin
    return (
      <section key={key} className={cn('rounded-lg border shadow-sm', skin.section)}>
        <div className={cn('flex items-center gap-2 rounded-t-lg border-b px-3 py-1.5 text-slate-200', skin.header)}>
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
      {/* The board's level and name are in the TopBar picker; this strip only carries the focus chip. */}
      {lensId && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-950/40 bg-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
          <span className="flex items-center gap-1 rounded bg-indigo-500/20 px-1.5 py-px font-medium text-indigo-200">
            <Crosshair size={11} /> Focused: {items.find((i) => i.id === lensId)?.title ?? '—'}
            <button onClick={clearLens} className="ml-0.5 text-indigo-200 hover:text-white" title="Clear focus">
              <X size={10} />
            </button>
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* A portfolio leads with strategy: objectives and the initiatives that serve
            them on one page. Other coordination boards show the initiatives workflow. */}
        {isPortfolio
          ? section(
              `${board.id}-strategy`,
              <>
                <span className="text-[12px] font-bold uppercase tracking-wide text-white">Strategy map</span>
                <span className={cn('text-[10px]', accent.subtitle)}>objectives and the strategic initiatives that serve them</span>
              </>,
              <StrategyMap boardId={board.id} />,
              <button
                onClick={() => setObjectives(true)}
                className="flex items-center gap-1 rounded border border-slate-500 px-1.5 py-0.5 text-[10px] font-medium text-slate-200 hover:text-white"
                title="Open the Objectives view — period, key results, scores"
              >
                <ExternalLink size={10} /> Objectives
              </button>,
              true,
              'band',
            )
          : section(
              `${board.id}-initiatives`,
              <>
                <span className="text-[12px] font-bold uppercase tracking-wide text-white">Initiatives workflow</span>
                <span className={cn('text-[10px]', accent.subtitle)}>the outcomes this board owns</span>
              </>,
              <BoardSummary boardId={board.id} rootsOnly variant="initiatives" />,
              undefined,
              true,
              'band',
            )}

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
