import { useEffect, useState } from 'react'
import { LayoutTemplate, Pencil, Plus, Settings, Target, Trash2, X } from 'lucide-react'
import { BAND_STYLES, BOARD_BANDS } from './BandBadge'
import { cardTypes, isAggregating, linkableBoards } from '@/domain/board'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

/**
 * Board settings: title, flight-level band, which card types the board
 * allows (and which is the default), WIP enforcement, and — for a coordination
 * or strategic board — the boards it aggregates.
 */
export function BoardSettings() {
  const boards = useStore((s) => s.boards)
  const boardId = useStore((s) => s.boardId)
  const issueTypes = useStore((s) => s.issueTypes)
  const renameBoard = useStore((s) => s.renameBoard)
  const setBoardBand = useStore((s) => s.setBoardBand)
  const setBoardCardTypes = useStore((s) => s.setBoardCardTypes)
  const setBoardDefaultCardType = useStore((s) => s.setBoardDefaultCardType)
  const setBoardWipEnforcement = useStore((s) => s.setBoardWipEnforcement)
  const saveBoardAsTemplate = useStore((s) => s.saveBoardAsTemplate)
  const addIssueType = useStore((s) => s.addIssueType)
  const updateIssueType = useStore((s) => s.updateIssueType)
  const removeIssueType = useStore((s) => s.removeIssueType)
  const askConfirm = useStore((s) => s.askConfirm)
  const addLinkedBoard = useStore((s) => s.addLinkedBoard)
  const removeLinkedBoard = useStore((s) => s.removeLinkedBoard)
  const close = useStore((s) => s.toggleBoardSettings)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeColor, setNewTypeColor] = useState('#8b5cf6')
  const [savedTemplate, setSavedTemplate] = useState(false)
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('#8b5cf6')

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
  const linked = board.linkedBoardIds ?? []
  const isAggregatingBoard = isAggregating(board)
  // Any board that keeps the aggregation graph acyclic and isn't already linked.
  const candidates = linkableBoards(boards, board.id).filter((b) => !linked.includes(b.id))

  const toggleType = (id: string) => {
    const next = allowed.includes(id) ? allowed.filter((x) => x !== id) : [...allowed, id]
    if (next.length === 0) return // at least one type must stay available
    setBoardCardTypes(board.id, next)
  }

  /** Define a brand-new card type and enable it on this board. */
  const saveTypeEdit = (id: string) => {
    const name = editName.trim()
    if (!name) return
    updateIssueType(id, { name, color: editColor })
    setEditingTypeId(null)
  }
  const addType = () => {
    const name = newTypeName.trim()
    if (!name) return
    const id = addIssueType(name, newTypeColor)
    setBoardCardTypes(board.id, [...allowed, id])
    setNewTypeName('')
  }

  const label = 'mb-1 block text-micro font-bold uppercase tracking-wide text-slate-600'
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
          <span className="text-title font-semibold text-slate-800">Board settings</span>
          <button onClick={close} className="ml-auto text-slate-600 hover:text-slate-600" title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-3 text-meta">
          {/* Title */}
          <div>
            <label className={label} htmlFor="board-title">
              Title
            </label>
            <input
              id="board-title"
              value={board.name}
              onChange={(e) => renameBoard(board.id, e.target.value)}
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-body font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* Flight-level band */}
          <div>
            <div className={label}>Flight-level band</div>
            <div className="grid grid-cols-3 gap-1.5">
              {BOARD_BANDS.map((b) => (
                <button
                  key={b}
                  onClick={() => setBoardBand(board.id, b)}
                  title={BAND_STYLES[b].hint}
                  className={cn(
                    'rounded border px-2 py-1.5 text-meta font-medium transition',
                    board.band === b
                      ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  {BAND_STYLES[b].label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-micro text-slate-600">{BAND_STYLES[board.band]?.hint}</p>
          </div>

          {/* Card types */}
          <div>
            <div className={label}>Card types on this board</div>
            <div className="space-y-1">
              {types.map((t) =>
                editingTypeId === t.id ? (
                  // Editing a type is a workspace-wide act — every board that uses it sees
                  // the new name and colour — so it happens in place, deliberately.
                  <div key={t.id} className={cn(row, 'gap-1')}>
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      title="Type colour"
                      className="h-6 w-6 shrink-0 cursor-pointer rounded border border-slate-200 bg-white"
                    />
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          saveTypeEdit(t.id)
                        }
                        if (e.key === 'Escape') setEditingTypeId(null)
                      }}
                      className="min-w-0 flex-1 rounded border border-indigo-300 px-1.5 py-1 text-meta outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <button
                      onClick={() => saveTypeEdit(t.id)}
                      disabled={!editName.trim()}
                      className="shrink-0 rounded bg-emerald-600 px-1.5 py-1 text-meta font-medium text-white disabled:opacity-40"
                      title="Save this type"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingTypeId(null)}
                      className="shrink-0 rounded border border-slate-200 px-1.5 py-1 text-meta font-medium text-slate-600 hover:border-slate-300"
                      title="Cancel"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div key={t.id} className={cn(row, 'group gap-1.5')}>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5">
                      <input type="checkbox" checked={allowed.includes(t.id)} onChange={() => toggleType(t.id)} />
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                      <span className="min-w-0 flex-1 truncate text-slate-700">{t.name}</span>
                      {board.defaultCardTypeId === t.id && (
                        <span className="shrink-0 rounded bg-slate-800 px-1 py-px text-micro font-semibold uppercase tracking-wide text-white">default</span>
                      )}
                    </label>
                    <button
                      onClick={() => { setEditingTypeId(t.id); setEditName(t.name); setEditColor(t.color) }}
                      className="shrink-0 rounded p-1 text-slate-600 transition hover:bg-slate-100 hover:text-slate-700"
                      title={`Edit ${t.name} — renames it everywhere it is used`}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() =>
                        askConfirm({
                          title: `Delete the "${t.name}" type?`,
                          body: 'Types are labels for the whole workspace, not per board — every card using it is affected, and the type is removed from every board that offers it.',
                          confirmLabel: 'Delete type',
                          danger: true,
                          onConfirm: () => removeIssueType(t.id),
                        })
                      }
                      className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                      title={`Delete ${t.name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ),
              )}
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
                className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1.5 text-meta outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                disabled={!newTypeName.trim()}
                onClick={addType}
                className="flex shrink-0 items-center gap-1 rounded bg-slate-800 px-2 py-1.5 text-meta font-medium text-white disabled:opacity-40"
                title="Create this type and enable it on this board"
              >
                <Plus size={11} /> Add type
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-meta text-slate-600">New cards default to</span>
              <select
                value={board.defaultCardTypeId ?? allowed[0] ?? ''}
                onChange={(e) => setBoardDefaultCardType(board.id, e.target.value || undefined)}
                className="rounded border border-slate-200 px-1.5 py-1 text-meta"
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
            <p className="mt-1 text-micro text-slate-600">
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
              className="rounded border border-slate-200 px-1.5 py-1 text-meta"
            >
              <option value="visualize">Visualize — tint at/over the limit, moves always allowed</option>
              <option value="justify">Justify — allow exceeding, but ask for a reason</option>
              <option value="block">Block — refuse moves that would exceed a limit</option>
            </select>
          </div>

          {/* Template — a board design, reusable when creating boards */}
          <div>
            <div className={label}>Template</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  saveBoardAsTemplate(board.id)
                  setSavedTemplate(true)
                }}
                className="flex shrink-0 items-center gap-1 rounded border border-slate-200 px-2 py-1.5 text-meta font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700"
              >
                <LayoutTemplate size={13} /> Save as template
              </button>
              <span className="text-meta text-slate-600">
                Keeps this board’s columns, card types and WIP policy — not its cards or linked boards.
              </span>
            </div>
            {savedTemplate && (
              <p className="mt-1 text-meta font-medium text-emerald-600">
                Saved as “{board.name}”. Rename it in the board workspace.
              </p>
            )}
          </div>

          {/* Linked boards (coordination/strategic) */}
          {isAggregatingBoard && (
            <div>
              <div className={label}>Linked boards</div>
              <div className="space-y-1">
                {linked.map((id) => {
                  const b = boards.find((x) => x.id === id)
                  if (!b) return null
                  return (
                    <label key={id} className={cn(row, 'cursor-pointer')}>
                      <input type="checkbox" checked onChange={() => removeLinkedBoard(board.id, id)} />
                      <span className="flex-1 text-slate-700">{b.name}</span>
                      {b.archived && (
                        <span className="shrink-0 rounded bg-slate-200 px-1 py-px text-micro font-semibold uppercase tracking-wide text-slate-600">
                          archived
                        </span>
                      )}
                      <span className="shrink-0 text-micro uppercase tracking-wide text-slate-600">{BAND_STYLES[b.band]?.label ?? '—'}</span>
                    </label>
                  )
                })}
                {candidates.map((b) => (
                  <label key={b.id} className={cn(row, 'cursor-pointer opacity-70')}>
                    <input type="checkbox" checked={false} onChange={() => addLinkedBoard(board.id, b.id)} />
                    <span className="flex-1 text-slate-700">{b.name}</span>
                    <span className="shrink-0 text-micro uppercase tracking-wide text-slate-600">{BAND_STYLES[b.band]?.label ?? '—'}</span>
                  </label>
                ))}
                {linked.length === 0 && candidates.length === 0 && (
                  <p className="text-meta text-slate-600">No boards can be linked here.</p>
                )}
              </div>
              <p className="mt-1 flex items-center gap-1 text-micro text-slate-600">
                <Target size={10} /> Teams or other coordination boards, any depth — their initiatives appear as bands. A board
                can’t be linked under one of its own descendants.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
