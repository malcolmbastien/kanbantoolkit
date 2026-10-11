import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Layers, Plus, X } from 'lucide-react'
import { BoardSummary } from './BoardSummary'
import { LevelBadge } from './LevelBadge'
import { useStore } from '@/store'

/**
 * A management board, Kanbanize-style:
 *  - an "Initiatives workflow" of its own top-level initiatives (wide summary cards
 *    with a progress bar and linked-initiative symbols)
 *  - "Linked workflows": the summary flow of each team board it aggregates.
 */
export function ManagementBoard({ boardId }: { boardId: string }) {
  const boards = useStore((s) => s.boards)
  const addManagementTeam = useStore((s) => s.addManagementTeam)
  const removeManagementTeam = useStore((s) => s.removeManagementTeam)
  const selectBoard = useStore((s) => s.selectBoard)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [pick, setPick] = useState('')

  const board = boards.find((b) => b.id === boardId)
  if (!board) return null

  const teamIds = board.teamBoardIds ?? []
  const teams = teamIds.map((id) => boards.find((b) => b.id === id)).filter((b): b is NonNullable<typeof b> => Boolean(b))
  const candidates = boards.filter((b) => b.level !== 'portfolio' && !teamIds.includes(b.id))

  const section = (
    key: string,
    title: React.ReactNode,
    body: React.ReactNode,
    right?: React.ReactNode,
    collapsible = true,
  ) => {
    const isCollapsed = collapsed[key]
    return (
      <section key={key} className="rounded-lg border border-slate-300 bg-slate-100 shadow-sm">
        <div className="flex items-center gap-2 rounded-t-lg border-b border-slate-300 bg-slate-800 px-3 py-1.5 text-slate-200">
          {collapsible && (
            <button onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))} className="text-slate-300 hover:text-white">
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          {title}
          {right && <span className="ml-auto flex items-center gap-1">{right}</span>}
        </div>
        {!isCollapsed && <div className="max-h-[560px] overflow-auto">{body}</div>}
      </section>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-950/40 bg-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
        <LevelBadge level={board.level} />
        <span className="font-semibold text-white">{board.name}</span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-400">management board</span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* Initiatives workflow */}
        {section(
          `${board.id}-initiatives`,
          <>
            <span className="text-[12px] font-bold uppercase tracking-wide text-white">Initiatives workflow</span>
            <span className="text-[10px] text-slate-400">top-level initiatives</span>
          </>,
          <BoardSummary boardId={board.id} rootsOnly />,
        )}

        {/* Linked workflows — the team boards */}
        {section(
          `${board.id}-linked`,
          <>
            <span className="text-[12px] font-bold uppercase tracking-wide text-white">Linked workflows</span>
            <span className="text-[10px] text-slate-400">{teams.length} team board{teams.length === 1 ? '' : 's'}</span>
          </>,
          <div className="space-y-3 p-2">
            {teams.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-[12px] text-slate-500">
                No linked workflows yet. Add a team board above to show its initiatives here.
              </div>
            )}
            {teams.map((t) => {
              const isCollapsed = collapsed[`team-${t.id}`]
              return (
                <div key={t.id} className="rounded-md border border-slate-300 bg-slate-100">
                  <div className="flex items-center gap-2 rounded-t-md bg-slate-700 px-3 py-1.5 text-slate-100">
                    <button onClick={() => setCollapsed((c) => ({ ...c, [`team-${t.id}`]: !c[`team-${t.id}`] }))} className="text-slate-300 hover:text-white">
                      {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <LevelBadge level={t.level} />
                    <span className="text-[11px] font-semibold text-white">{t.name}</span>
                    <span className="ml-auto flex items-center gap-1">
                      <button
                        onClick={() => selectBoard(t.id)}
                        className="flex items-center gap-1 rounded border border-slate-500 px-1.5 py-0.5 text-[10px] font-medium text-slate-200 hover:text-white"
                        title="Open this team board"
                      >
                        <ExternalLink size={10} /> open
                      </button>
                      <button
                        onClick={() => removeManagementTeam(board.id, t.id)}
                        className="text-slate-300 hover:text-rose-300"
                        title="Remove this linked workflow"
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
              <option value="">Add linked workflow…</option>
              {candidates.map((b) => (
                <option key={b.id} value={b.id} className="bg-slate-800 text-slate-100">{b.name}</option>
              ))}
            </select>
            <button
              disabled={!pick}
              onClick={() => {
                addManagementTeam(board.id, pick)
                setPick('')
              }}
              className="flex items-center gap-1 rounded-md bg-indigo-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
            >
              <Plus size={12} /> Add
            </button>
          </>,
          false,
        )}

        <div className="flex items-center gap-1 px-1 text-[10px] text-slate-400">
          <Layers size={11} /> Each band is a rollup of that board’s initiatives — Not Started / In Progress / Done. Card symbols show linked team initiatives.
        </div>
      </div>
    </div>
  )
}
