import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Layers } from 'lucide-react'
import { BoardSummary } from './BoardSummary'
import { LevelBadge } from './LevelBadge'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

/** A stacked "management view": several boards as bands, each keeping its own lane tree. */
export function ManagementView() {
  const boards = useStore((s) => s.boards)
  const managementBoards = useStore((s) => s.managementBoards)
  const toggleManagementBoard = useStore((s) => s.toggleManagementBoard)
  const selectBoard = useStore((s) => s.selectBoard)
  const setView = useStore((s) => s.setView)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const bands = managementBoards.map((id) => boards.find((b) => b.id === id)).filter((b): b is NonNullable<typeof b> => Boolean(b))

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-200">
      {/* Toolbar: which boards are stacked */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-950/40 bg-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
        <span className="font-semibold text-white">Management view</span>
        <span className="text-slate-400">· {bands.length} board{bands.length === 1 ? '' : 's'} stacked</span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {boards.map((b) => {
            const on = managementBoards.includes(b.id)
            return (
              <button
                key={b.id}
                onClick={() => toggleManagementBoard(b.id)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-semibold transition',
                  on ? 'border-transparent bg-slate-600 text-white' : 'border-slate-600 text-slate-400 hover:text-white',
                )}
                title={on ? 'Remove from management view' : 'Add to management view'}
              >
                {b.name}
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {bands.length === 0 && <p className="text-[12px] text-slate-500">No boards selected. Add one above.</p>}
        {bands.map((board) => {
          const isCollapsed = collapsed[board.id]
          return (
            <section key={board.id} className="rounded-lg border border-slate-300 bg-slate-100 shadow-sm">
              <div className="flex items-center gap-2 rounded-t-lg border-b border-slate-300 bg-slate-800 px-3 py-1.5 text-slate-200">
                <button onClick={() => setCollapsed((c) => ({ ...c, [board.id]: !c[board.id] }))} className="text-slate-300 hover:text-white">
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
                <LevelBadge level={board.level} />
                <span className="text-[12px] font-semibold text-white">{board.name}</span>
                {board.derived && (
                  <span className="rounded bg-violet-400/20 px-1.5 py-px text-[10px] font-semibold text-violet-200">
                    rollup status
                  </span>
                )}
                <button
                  onClick={() => { selectBoard(board.id); setView('board') }}
                  className="ml-auto flex items-center gap-1 rounded border border-slate-600 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:text-white"
                  title="Open this board on its own"
                >
                  <ExternalLink size={11} /> open
                </button>
              </div>
              {!isCollapsed && (
                <div className="max-h-[560px] overflow-auto">
                  <BoardSummary boardId={board.id} />
                </div>
              )}
            </section>
          )
        })}
        {bands.length > 0 && (
          <p className="flex items-center gap-1 px-1 text-[10px] text-slate-400">
            <Layers size={11} /> Management view shows each board’s initiatives only — a rollup flow of Not Started / In Progress / Done, without the team’s detailed card flow.
          </p>
        )}
      </div>
    </div>
  )
}
