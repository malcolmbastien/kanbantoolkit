import { useEffect, useState } from 'react'
import { Layers, Plus, Settings, Target, X } from 'lucide-react'
import { cardTypes } from '@/domain/board'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { BoardLevel } from '@/domain/types'

const LEVELS: { id: BoardLevel; label: string; hint: string }[] = [
  { id: 'team', label: 'Team', hint: 'a delivery team’s flow' },
  { id: 'project', label: 'Project', hint: 'a project-level board' },
  { id: 'portfolio', label: 'Portfolio', hint: 'rolls up linked team boards' },
]

/**
 * Board settings: title, type, rollup, which card types the board allows (and
 * which is the default), WIP enforcement, and — for a portfolio — the team
 * boards it aggregates.
 */
export function BoardSettings() {
  const boards = useStore((s) => s.boards)
  const boardId = useStore((s) => s.boardId)
  const issueTypes = useStore((s) => s.issueTypes)
  const renameBoard = useStore((s) => s.renameBoard)
  const setBoardLevel = useStore((s) => s.setBoardLevel)
  const setBoardDerived = useStore((s) => s.setBoardDerived)
  const setBoardCardTypes = useStore((s) => s.setBoardCardTypes)
  const setBoardDefaultCardType = useStore((s) => s.setBoardDefaultCardType)
  const setBoardWipEnforcement = useStore((s) => s.setBoardWipEnforcement)
  const addIssueType = useStore((s) => s.addIssueType)
  const addManagementTeam = useStore((s) => s.addManagementTeam)
  const removeManagementTeam = useStore((s) => s.removeManagementTeam)
  const close = useStore((s) => s.toggleBoardSettings)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeColor, setNewTypeColor] = useState('#8b5cf6')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const board = boards.find((b) => b.id === boardId)
  if (!board) return null

  const types = cardTypes(issueTypes)
  // No restriction = every card type.
  const allowed = board.cardTypeIds ?? types.map((t) => t.id)
  const teams = boards.filter((b) => b.level !== 'portfolio')
  const linked = board.teamBoardIds ?? []
  const isPortfolio = board.level === 'portfolio'

  const toggleType = (id: string) => {
    const next = allowed.includes(id) ? allowed.filter((x) => x !== id) : [...allowed, id]
    if (next.length === 0) return // at least one type must stay available
    setBoardCardTypes(board.id, next)
  }

  /** Define a brand-new card type and enable it on this board. */
  const addType = () => {
    const name = newTypeName.trim()
    if (!name) return
    const id = addIssueType(name, newTypeColor)
    setBoardCardTypes(board.id, [...allowed, id])
    setNewTypeName('')
  }

  const label = 'mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-400'
  const row = 'flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5'

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onClick={close}>
      <div
        data-board-settings
        role="dialog"
        aria-modal="true"
        aria-label="Board settings"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Settings size={16} className="text-indigo-600" />
          <span className="text-sm font-semibold text-slate-800">Board settings</span>
          <button onClick={close} className="ml-auto text-slate-400 hover:text-slate-600" title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-3 text-[12px]">
          {/* Title */}
          <div>
            <label className={label} htmlFor="board-title">
              Title
            </label>
            <input
              id="board-title"
              value={board.name}
              onChange={(e) => renameBoard(board.id, e.target.value)}
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-[13px] font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* Type */}
          <div>
            <div className={label}>Type</div>
            <div className="grid grid-cols-3 gap-1.5">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setBoardLevel(board.id, l.id)}
                  title={l.hint}
                  className={cn(
                    'rounded border px-2 py-1.5 text-[12px] font-medium transition',
                    board.level === l.id
                      ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-slate-400">{LEVELS.find((l) => l.id === board.level)?.hint}</p>
          </div>

          {/* Rollup */}
          <label className={cn(row, 'cursor-pointer')}>
            <input type="checkbox" checked={board.derived === true} onChange={(e) => setBoardDerived(board.id, e.target.checked)} />
            <span className="flex-1">
              <span className="flex items-center gap-1 font-medium text-slate-700">
                <Layers size={12} className="text-slate-400" /> Rollup board
              </span>
              <span className="text-[10px] text-slate-400">
                Derive each item’s column from the status of the work at the lowest level of its subtree.
              </span>
            </span>
          </label>

          {/* Card types */}
          <div>
            <div className={label}>Card types on this board</div>
            <div className="space-y-1">
              {types.map((t) => (
                <label key={t.id} className={cn(row, 'cursor-pointer')}>
                  <input type="checkbox" checked={allowed.includes(t.id)} onChange={() => toggleType(t.id)} />
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                  <span className="flex-1 text-slate-700">{t.name}</span>
                  {board.defaultCardTypeId === t.id && (
                    <span className="rounded bg-slate-800 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-white">default</span>
                  )}
                </label>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1">
              <input
                type="color"
                value={newTypeColor}
                onChange={(e) => setNewTypeColor(e.target.value)}
                title="New type colour"
                className="h-7 w-7 shrink-0 cursor-pointer rounded border border-slate-200 bg-white"
              />
              <input
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addType()
                  }
                }}
                placeholder="Define a new card type…"
                className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                disabled={!newTypeName.trim()}
                onClick={addType}
                className="flex shrink-0 items-center gap-1 rounded bg-slate-800 px-2 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
                title="Create this type and enable it on this board"
              >
                <Plus size={11} /> Add type
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-slate-500">New cards default to</span>
              <select
                value={board.defaultCardTypeId ?? allowed[0] ?? ''}
                onChange={(e) => setBoardDefaultCardType(board.id, e.target.value || undefined)}
                className="rounded border border-slate-200 px-1.5 py-1 text-[11px]"
              >
                {types
                  .filter((t) => allowed.includes(t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              The Initiative type is reserved for the Initiatives workflow and is never a card type.
            </p>
          </div>

          {/* WIP enforcement */}
          <div>
            <label className={label} htmlFor="board-wip">
              WIP limit enforcement
            </label>
            <select
              id="board-wip"
              value={board.wipEnforcement ?? 'visualize'}
              onChange={(e) => setBoardWipEnforcement(board.id, e.target.value as 'visualize' | 'justify' | 'block')}
              className="rounded border border-slate-200 px-1.5 py-1 text-[11px]"
            >
              <option value="visualize">Visualize — tint at/over the limit, moves always allowed</option>
              <option value="justify">Justify — allow exceeding, but ask for a reason</option>
              <option value="block">Block — refuse moves that would exceed a limit</option>
            </select>
          </div>

          {/* Linked team boards (portfolio only) */}
          {isPortfolio && (
            <div>
              <div className={label}>Linked team boards</div>
              <div className="space-y-1">
                {teams.map((t) => {
                  const on = linked.includes(t.id)
                  return (
                    <label key={t.id} className={cn(row, 'cursor-pointer')}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => (e.target.checked ? addManagementTeam(board.id, t.id) : removeManagementTeam(board.id, t.id))}
                      />
                      <span className="flex-1 text-slate-700">{t.name}</span>
                    </label>
                  )
                })}
                {teams.length === 0 && <p className="text-[11px] text-slate-400">No team boards yet.</p>}
              </div>
              <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                <Target size={10} /> Their initiatives appear as bands on this board.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
