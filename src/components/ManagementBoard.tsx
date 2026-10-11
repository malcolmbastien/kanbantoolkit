import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Layers } from 'lucide-react'
import { BoardSummary } from './BoardSummary'
import { LevelBadge } from './LevelBadge'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

/**
 * A management board: its own top-level initiatives plus the summary flows of the
 * team boards it aggregates (each a Not Started / In Progress / Done rollup).
 */
export function ManagementBoard({ boardId }: { boardId: string }) {
  const boards = useStore((s) => s.boards)
  const addManagementTeam = useStore((s) => s.addManagementTeam)
  const removeManagementTeam = useStore((s) => s.removeManagementTeam)
  const selectBoard = useStore((s) => s.selectBoard)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const board = boards.find((b) => b.id === boardId)
  if (!board) return null

  const teamIds = board.teamBoardIds ?? []
  const teams = teamIds.map((id) => boards.find((b) => b.id === id)).filter((b): b is NonNullable<typeof b> => Boolean(b))
  const candidates = boards.filter((b) => b.level !== 'portfolio')

  const band = (
    id: string,
    title: string,
    subtitle: string | undefined,
    body: React.ReactNode,
  ) => {
    const isCollapsed = collapsed[id]
    return (
      <section key={id} className="rounded-lg border border-slate-300 bg-slate-100 shadow-sm">
        <div className="flex items-center gap-2 rounded-t-lg border-b border-slate-300 bg-slate-800 px-3 py-1.5 text-slate-200">
          <button onClick={() => setCollapsed((c) => ({ ...c, [id]: !c[id] }))} className="text-slate-300 hover:text-white">
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <span className="text-[12px] font-semibold text-white">{title}</span>
          {subtitle && <span className="text-[10px] text-slate-400">{subtitle}</span>}
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
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <span className="text-slate-400">Teams:</span>
          {candidates.map((b) => {
            const on = teamIds.includes(b.id)
            return (
              <button
                key={b.id}
                onClick={() => (on ? removeManagementTeam(board.id, b.id) : addManagementTeam(board.id, b.id))}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-semibold transition',
                  on ? 'border-transparent bg-slate-600 text-white' : 'border-slate-600 text-slate-400 hover:text-white',
                )}
                title={on ? 'Remove from this management board' : 'Add to this management board'}
              >
                {b.name}
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {band(board.id, 'Top-level initiatives', 'this board', <BoardSummary boardId={board.id} />)}

        {teams.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-100 p-6 text-center text-[12px] text-slate-500">
            No team boards linked. Add teams above to show their initiative flows here.
          </div>
        )}

        {teams.map((t) =>
          band(
            t.id,
            t.name,
            'team board',
            <BoardSummary boardId={t.id} />,
          ),
        )}

        <div className="flex items-center justify-between px-1 text-[10px] text-slate-400">
          <span className="flex items-center gap-1">
            <Layers size={11} /> Each band is a rollup of that board’s initiatives — Not Started / In Progress / Done.
          </span>
          <span className="flex items-center gap-1">
            Open a team board to see its full flow:
            {teams.length > 0 && (
              <button
                onClick={() => selectBoard(teams[0].id)}
                className="flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 font-medium text-slate-600 hover:text-slate-800"
              >
                <ExternalLink size={10} /> {teams[0].name}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
