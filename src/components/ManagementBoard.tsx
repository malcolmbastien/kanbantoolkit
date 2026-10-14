import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Layers, Plus, X } from 'lucide-react'
import { ArchivedBoardChip } from './ArchivedBoardChip'
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
  const setObjectives = useStore((s) => s.setObjectives)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [pick, setPick] = useState('')

  const board = boards.find((b) => b.id === boardId)
  if (!board) return null

  const linkedIds = board.linkedBoardIds ?? []
  const linked = linkedIds
    .map((id) => boards.find((b) => b.id === id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b))
    // A retired board stops collecting rollups: it is filtered here rather than unlinked,
    // so unarchiving restores the graph exactly.
    .filter((b) => !b.archived)
  // Any board that keeps the aggregation graph acyclic and isn't already linked.
  const candidates = linkableBoards(boards, board.id).filter((b) => !linkedIds.includes(b.id))
  const isPortfolio = board.band === 'portfolio'
  // The initiatives surface wears the board's band colour (Team = green, Program = blue, Portfolio = violet).
  const accent = BAND_ACCENT[board.band]
  /**
   * A section is the same slim bar a team board uses — a dot in the band's colour, a title,
   * a subtitle and a rule — so a program or portfolio reads like a team board. Only the
   * colour changes with the flight level; the shape is the product's.
   */
  const section = (
    key: string,
    title: React.ReactNode,
    body: React.ReactNode,
    right?: React.ReactNode,
    collapsible = true,
    tone: 'band' | 'slate' = 'slate',
  ) => {
    const isCollapsed = collapsed[key]
    const dot = tone === 'band' ? accent.dot : 'bg-slate-400'
    const rule = tone === 'band' ? accent.rule : 'border-slate-200'
    return (
      <section key={key} className="space-y-2">
        <div className={cn('flex items-center gap-2 border-b pb-1.5', rule)}>
          {collapsible && (
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
              className="shrink-0 rounded text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />
          {title}
          {right && <span className="ml-auto flex shrink-0 items-center gap-1">{right}</span>}
        </div>
        {!isCollapsed && <div>{body}</div>}
      </section>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100">
      {/* A retired board says so here too — it has no other strip to carry the chip. */}
      {board.archived && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-500">
          <ArchivedBoardChip />
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* A portfolio leads with strategy: objectives and the initiatives that serve
            them on one page. Other coordination boards show the initiatives workflow. */}
        {isPortfolio
          ? section(
              `${board.id}-strategy`,
              <>
                <span className="shrink-0 text-[12px] font-bold uppercase tracking-wide text-slate-900">Strategy map</span>
                <span className="truncate text-[11px] text-slate-500">objectives and the strategic initiatives that serve them</span>
              </>,
              <StrategyMap boardId={board.id} />,
              <button
                onClick={() => setObjectives(true)}
                className="flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
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
                <span className="shrink-0 text-[12px] font-bold uppercase tracking-wide text-slate-900">Initiatives workflow</span>
                <span className="truncate text-[11px] text-slate-500">the outcomes this board owns</span>
              </>,
              <BoardSummary boardId={board.id} rootsOnly variant="initiatives" interactive />,
              undefined,
              true,
              'band',
            )}

        {/* Linked boards — teams or other coordination boards */}
        {section(
          `${board.id}-linked`,
          <>
            <span className="shrink-0 text-[12px] font-bold uppercase tracking-wide text-slate-900">Linked boards</span>
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
                <div key={t.id} className="space-y-2">
                  <div className={cn('flex items-center gap-2 border-b pb-1.5', BAND_ACCENT[t.band].rule)}>
                    <button
                      onClick={() => setCollapsed((c) => ({ ...c, [`linked-${t.id}`]: !c[`linked-${t.id}`] }))}
                      className="shrink-0 rounded text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
                    >
                      {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', BAND_ACCENT[t.band].dot)} />
                    <BandBadge band={t.band} />
                    <span className="min-w-0 truncate text-[12px] font-semibold text-slate-800">{t.name}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => selectBoard(t.id)}
                        className="flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                        title="Open this board"
                      >
                        <ExternalLink size={10} /> open
                      </button>
                      <button
                        onClick={() => removeLinkedBoard(board.id, t.id)}
                        className="rounded p-0.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
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
              className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">Link a board…</option>
              {candidates.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
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
