import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { LayoutTemplate, Minus, Pencil, Plus, Settings, Target, Trash2, X } from 'lucide-react'
import { BAND_STYLES } from './BandBadge'
import { cardTypes, defaultCardTypeId, isAggregating, isPortfolio, linkableBoards, NONE_TYPE_ID } from '@/domain/board'
import { lanePath, leafLanes } from '@/domain/lanes'
import { initiativesCarrying, itemsCarryingTag } from '@/domain/board'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { useDialogFocus } from '@/lib/useDialogFocus'
import { cardsFlows } from '@/domain/flows'
import { VocabularySaveError } from './VocabularySaveError'

type SettingsTab = 'general' | 'cards' | 'tags' | 'boards'

/**
 * Board settings, in the order a person reads it: **General** holds who the board is — its title
 * and description — beside how it treats work (its WIP enforcement) and what it can become (a
 * template). **Cards** holds the vocabulary a card is chosen from: the workspace's card types and
 * this board's own initiative kinds, with the type and cell new cards start in. **Tags** is the
 * board's other set of labels. **Boards** is the boards a coordination board reads beneath it.
 *
 * The board's **type** is not here. It is fixed when the board is made — it decides which surfaces
 * exist and where the work rolls up, so changing it would hide work rather than move it — and the
 * dialog's own header already names it. A setting that cannot be changed is not a setting.
 *
 * A **portfolio** board has none of the work-shaped settings: it renders no cards workflow, makes no
 * initiatives of its own and arranges no lanes, so a default card type, a landing cell, its own
 * kinds, its own tags, a WIP policy and a template of its columns would all be settings with nothing
 * to act on. What it keeps is its identity and the boards it reads beneath it.
 */
export function BoardSettings() {
  const boards = useStore((s) => s.boards)
  const boardId = useStore((s) => s.boardId)
  const issueTypes = useStore((s) => s.issueTypes)
  const renameBoard = useStore((s) => s.renameBoard)
  const setBoardDescription = useStore((s) => s.setBoardDescription)
  const setBoardDefaultCardType = useStore((s) => s.setBoardDefaultCardType)
  const setBoardDefaultDropLane = useStore((s) => s.setBoardDefaultDropLane)
  const lanes = useStore((s) => s.lanes)
  const flows = useStore((s) => s.flows)
  const setBoardWipEnforcement = useStore((s) => s.setBoardWipEnforcement)
  const saveBoardAsTemplate = useStore((s) => s.saveBoardAsTemplate)
  const addIssueType = useStore((s) => s.addIssueType)
  const items = useStore((s) => s.items)
  const addInitiativeType = useStore((s) => s.addInitiativeType)
  const updateInitiativeType = useStore((s) => s.updateInitiativeType)
  const removeInitiativeType = useStore((s) => s.removeInitiativeType)
  const addTag = useStore((s) => s.addTag)
  const updateTag = useStore((s) => s.updateTag)
  const removeTag = useStore((s) => s.removeTag)
  const updateIssueType = useStore((s) => s.updateIssueType)
  const removeIssueType = useStore((s) => s.removeIssueType)
  const askConfirm = useStore((s) => s.askConfirm)
  const addLinkedBoard = useStore((s) => s.addLinkedBoard)
  const removeLinkedBoard = useStore((s) => s.removeLinkedBoard)
  const close = useStore((s) => s.toggleBoardSettings)
  const dialogRef = useRef<HTMLDivElement>(null)
  // A dialog over the board: the caret is in it, Tab stays in it, Escape puts the caret back on
  // the control that opened it.
  useDialogFocus(dialogRef, close)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeColor, setNewTypeColor] = useState('#8b5cf6')
  const [newKindName, setNewKindName] = useState('')
  const [newKindColor, setNewKindColor] = useState('#0ea5e9')
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#64748b')
  const [savedTemplate, setSavedTemplate] = useState(false)
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('#8b5cf6')
  const [tab, setTab] = useState<SettingsTab>('general')

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
  const kinds = board.initiativeTypes ?? []
  const tags = board.tags ?? []
  const linked = board.linkedBoardIds ?? []
  const isAggregatingBoard = isAggregating(board)
  // A portfolio reads work rather than holding it: none of the card-shaped settings below apply.
  const portfolio = isPortfolio(board)
  // Any board that keeps the aggregation graph acyclic and isn't already linked.
  const candidates = linkableBoards(boards, board.id).filter((b) => !linked.includes(b.id))

  /** Define a brand-new card type and enable it on this board. */
  const saveTypeEdit = (id: string) => {
    const name = editName.trim()
    if (!name) return
    updateIssueType(id, { name, color: editColor })
    setEditingTypeId(null)
  }
  const addTagToBoard = () => {
    const name = newTagName.trim()
    if (!name) return
    addTag(board.id, name, newTagColor)
    setNewTagName('')
  }

  const addKind = () => {
    const name = newKindName.trim()
    if (!name) return
    addInitiativeType(board.id, name, newKindColor)
    setNewKindName('')
  }

  const addType = () => {
    const name = newTypeName.trim()
    if (!name) return
    addIssueType(name, newTypeColor)
    setNewTypeName('')
  }

  const label = 'mb-1 block text-micro font-bold uppercase tracking-wide text-slate-600'
  const row = 'flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5'

  // A conventional settings modal: the identity first, then one tab per kind of setting. A
  // portfolio has no card-shaped settings and hides those tabs rather than showing empty ones.
  const tabs: Array<{ id: SettingsTab; label: string }> = [{ id: 'general', label: 'General' }]
  if (!portfolio) {
    // The word-shaped settings, and the tags beside them: a type and a kind are one choice about
    // what the work is, and a tag is another — a set, read on its own list.
    tabs.push(
      { id: 'cards', label: 'Cards' },
      { id: 'tags', label: 'Tags' },
    )
  }
  if (isAggregatingBoard) tabs.push({ id: 'boards', label: 'Boards' })
  const activeTab = tabs.some((entry) => entry.id === tab) ? tab : 'general'

  /** Arrow keys move between tabs, as a tablist is expected to; focus follows the selection. */
  const moveTab = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((entry) => entry.id === activeTab)
    let next = index
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    const target = tabs[next]
    setTab(target.id)
    requestAnimationFrame(() => document.getElementById(`board-settings-tab-${target.id}`)?.focus())
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onClick={close}>
      <div
        ref={dialogRef}
        data-board-settings
        role="dialog"
        aria-modal="true"
        aria-label="Board settings"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
            <Settings size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-slate-900">Board settings</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-micro text-slate-600">
              <span className="min-w-0 truncate">{board.name}</span>
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px font-semibold text-slate-600">
                {BAND_STYLES[board.band]?.label ?? board.band}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close board settings"
            title="Close"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <X size={16} />
          </button>
        </div>

        <div role="tablist" aria-label="Board settings sections" aria-orientation="horizontal" className="flex shrink-0 gap-1 border-b border-slate-200 px-3">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              id={`board-settings-tab-${entry.id}`}
              role="tab"
              aria-selected={activeTab === entry.id}
              aria-controls={`board-settings-panel-${entry.id}`}
              tabIndex={activeTab === entry.id ? 0 : -1}
              onClick={() => setTab(entry.id)}
              onKeyDown={moveTab}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-meta font-medium transition',
                activeTab === entry.id
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-meta">
          <div
            role="tabpanel"
            id="board-settings-panel-general"
            aria-labelledby="board-settings-tab-general"
            hidden={activeTab !== 'general'}
            className="space-y-4"
          >
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

          {/* Description — the board's own voice; the command palette searches it. */}
          <div>
            <label className={label} htmlFor="board-description">
              Description
            </label>
            <textarea
              id="board-description"
              value={board.description}
              onChange={(e) => setBoardDescription(board.id, e.target.value)}
              rows={3}
              placeholder="What this board is for. A newcomer reads this first."
              className="w-full resize-y rounded border border-slate-200 px-2 py-1.5 text-body text-slate-800 outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <p className="mt-1 text-micro text-slate-600">The command palette searches it too.</p>
          </div>

          {/* WIP enforcement — the board's policy for its own lanes, offered beside the identity
              because it is how this board treats its work rather than a property of one column. */}
          {!portfolio && (
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
                <option value="visualize">Visualize — tint at or over the limit</option>
                <option value="justify">Justify — ask for a reason to exceed</option>
                <option value="block">Block — refuse the move</option>
              </select>
              {cardsFlows(flows, board.id).length > 1 && (
                <p className="mt-1 text-micro text-slate-600">Applies to every flow.</p>
              )}
            </div>
          )}

          {/* Template — a board design, reusable when creating boards. A portfolio has no columns
              of its own to keep, so there is nothing to save. */}
          {!portfolio && (
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
                Keeps the columns, default card type and WIP policy. Not the cards or the linked boards.
              </span>
            </div>
            {savedTemplate && (
              <p className="mt-1 text-meta font-medium text-emerald-600">
                Saved as “{board.name}”. Rename it in the board workspace.
              </p>
            )}
          </div>
          )}
          </div>

          {/* Card types — the workspace's vocabulary, not this board's: every board offers all
              of them and picks only a default (v27). The label said "on this board", which the
              per-board subsets used to make true. */}
          {!portfolio && (
          <div
            role="tabpanel"
            id="board-settings-panel-cards"
            aria-labelledby="board-settings-tab-cards"
            hidden={activeTab !== 'cards'}
            className="space-y-4"
          >
            <div className={label}>Card types</div>
            <p className="mb-1.5 text-micro text-slate-600">
              Every board offers every type. This one picks what its new cards start as.
            </p>
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
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      {t.id === NONE_TYPE_ID ? (
                        <Minus size={13} className="shrink-0 text-slate-400" />
                      ) : (
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                      )}
                      <span className="min-w-0 flex-1 truncate text-slate-700">{t.name}</span>
                      {board.defaultCardTypeId === t.id && (
                        <span className="shrink-0 rounded bg-slate-800 px-1 py-px text-micro font-semibold uppercase tracking-wide text-white">default</span>
                      )}
                      {t.id === NONE_TYPE_ID && (
                        <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-micro font-semibold uppercase tracking-wide text-slate-600">built-in</span>
                      )}
                    </span>
                    {t.id !== NONE_TYPE_ID && (
                      <>
                        <button
                          onClick={() => { setEditingTypeId(t.id); setEditName(t.name); setEditColor(t.color) }}
                          className="shrink-0 rounded p-1 text-slate-600 transition hover:bg-slate-100 hover:text-slate-700"
                          title={`Edit ${t.name}`}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() =>
                            askConfirm({
                              title: `Delete the "${t.name}" type?`,
                              body: 'Every card using it is affected, on every board that offers it.',
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
                      </>
                    )}
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
                title="Create this type for the whole workspace"
              >
                <Plus size={11} /> Add type
              </button>
            </div>
            {/* A type is the workspace's word, so a refusal is said here, beside the list. */}
            <VocabularySaveError lists={['issueTypes']} />
            <div className="mt-2 flex items-center gap-2">
              <span className="text-meta text-slate-600">New cards default to</span>
              <select
                value={board.defaultCardTypeId ?? defaultCardTypeId(types) ?? ''}
                onChange={(e) => setBoardDefaultCardType(board.id, e.target.value || undefined)}
                className="rounded border border-slate-200 px-1.5 py-1 text-meta"
              >
                {types
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label htmlFor="board-default-drop" className="text-meta text-slate-600">
                New cards land in
              </label>
              <select
                id="board-default-drop"
                value={board.defaultDropLaneId ?? ''}
                onChange={(e) => setBoardDefaultDropLane(board.id, e.target.value || undefined)}
                title="Where a new card starts, and where a card moved here lands"
                className="rounded border border-slate-200 px-1.5 py-1 text-meta"
              >
                <option value="">the first cell</option>
                {/* Several flows mean the same column name appears more than once, so the
                    destinations are grouped by the flow that holds them — and the group's name is
                    the answer to "which Backlog". */}
                {cardsFlows(flows, board.id).length > 1
                  ? cardsFlows(flows, board.id).map((flow) => (
                      <optgroup key={flow.id} label={flow.name}>
                        {leafLanes(lanes, flow.id).map((l) => (
                          <option key={l.id} value={l.id}>
                            {lanePath(lanes, l.id).join(' / ')}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  : cardsFlows(flows, board.id).flatMap((flow) => leafLanes(lanes, flow.id)).map((l) => (
                      <option key={l.id} value={l.id}>
                        {lanePath(lanes, l.id).join(' / ')}
                      </option>
                    ))}
                {/* A named cell that has gone — deleted, or split away — is said rather than
                    silently reading as "the first cell". */}
                {board.defaultDropLaneId &&
                  !cardsFlows(flows, board.id).some((flow) => leafLanes(lanes, flow.id).some((l) => l.id === board.defaultDropLaneId)) && (
                    <option value={board.defaultDropLaneId}>the cell is gone</option>
                  )}
              </select>
            </div>
            {cardsFlows(flows, board.id).length > 1 && (
              <p className="mt-1 text-micro text-slate-600">
                A card made in a flow’s tab lands in that flow. Only a card moved here lands in the default.
              </p>
            )}
            <p className="mt-1 text-micro text-slate-600">
              Initiative is reserved for the initiatives workflow. None is built in: always available, never
              edited or removed.
            </p>

            <div>
              <div className={label}>Initiative kinds</div>
              <p className="mb-1.5 text-micro text-slate-600">
                This board’s own labels for its initiatives — a bet, a programme, an experiment. Nothing else reads
                them.
              </p>
              <div className="space-y-1">
                <div className={row}>
                  <Minus size={13} className="shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 text-meta font-medium text-slate-700">None</span>
                  <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-micro font-semibold uppercase tracking-wide text-slate-600">built-in</span>
                </div>
                {kinds.length === 0 && <p className="text-meta text-slate-600">No kinds of your own yet.</p>}
                {kinds.map((k) => {
                  const used = initiativesCarrying(items, k.id)
                  return (
                    <div key={k.id} className={row}>
                      <input
                        type="color"
                        value={k.color}
                        onChange={(e) => updateInitiativeType(board.id, k.id, { color: e.target.value })}
                        title={`${k.name} colour`}
                        className="h-6 w-6 shrink-0 cursor-pointer rounded border border-slate-200 bg-white"
                      />
                      <input
                        value={k.name}
                        onChange={(e) => updateInitiativeType(board.id, k.id, { name: e.target.value })}
                        aria-label={`${k.name} name`}
                        className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-meta font-medium text-slate-800 outline-none transition hover:border-slate-200 focus:border-indigo-300"
                      />
                      {used > 0 && (
                        <span className="shrink-0 text-micro text-slate-600">
                          {used} initiative{used === 1 ? '' : 's'}
                        </span>
                      )}
                      <button
                        disabled={used > 0}
                        onClick={() => removeInitiativeType(board.id, k.id)}
                        title={
                          used > 0
                            ? `${used} initiative${used === 1 ? ' still carries' : 's still carry'} this kind — clear ${used === 1 ? 'it' : 'those'} first`
                            : `Remove ${k.name}`
                        }
                        className="shrink-0 rounded p-0.5 text-slate-600 transition enabled:hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
              <div className="mt-2 flex items-center gap-1">
                <input
                  type="color"
                  value={newKindColor}
                  onChange={(e) => setNewKindColor(e.target.value)}
                  title="New kind colour"
                  className="h-7 w-7 shrink-0 cursor-pointer rounded border border-slate-200 bg-white"
                />
                <input
                  value={newKindName}
                  onChange={(e) => setNewKindName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addKind()
                    }
                  }}
                  placeholder="Define a new initiative kind…"
                  className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1.5 text-meta outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  disabled={!newKindName.trim()}
                  onClick={addKind}
                  className="flex shrink-0 items-center gap-1 rounded bg-slate-800 px-2 py-1.5 text-meta font-medium text-white disabled:opacity-40"
                  title="Create this kind for this board"
                >
                  <Plus size={11} /> Add kind
                </button>
              </div>
            </div>

          </div>
          )}

          {/* Tags — this board's own labels for its work: a set rather than a choice, so there
              is no None to protect and an item with no tags simply has none. A tab of their own
              because the list is read on its own, and it grows one entry at a time. */}
          {!portfolio && (
          <div
            role="tabpanel"
            id="board-settings-panel-tags"
            aria-labelledby="board-settings-tab-tags"
            hidden={activeTab !== 'tags'}
            className="space-y-4"
          >
            <div>
              <div className={label}>Tags</div>
              <p className="mb-1.5 text-micro text-slate-600">
                This board’s own labels for its work. A card can carry several; only a filter reads them.
              </p>
              <div className="space-y-1">
                {tags.length === 0 && <p className="text-meta text-slate-600">No tags yet.</p>}
                {tags.map((t) => {
                  const used = itemsCarryingTag(items, t.id)
                  return (
                    <div key={t.id} className={row}>
                      <input
                        type="color"
                        value={t.color}
                        onChange={(e) => updateTag(board.id, t.id, { color: e.target.value })}
                        title={`${t.name} colour`}
                        className="h-6 w-6 shrink-0 cursor-pointer rounded border border-slate-200 bg-white"
                      />
                      <input
                        value={t.name}
                        onChange={(e) => updateTag(board.id, t.id, { name: e.target.value })}
                        aria-label={`${t.name} name`}
                        className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-meta font-medium text-slate-800 outline-none transition hover:border-slate-200 focus:border-indigo-300"
                      />
                      {used > 0 && (
                        <span className="shrink-0 text-micro text-slate-600">
                          {used} item{used === 1 ? '' : 's'}
                        </span>
                      )}
                      <button
                        disabled={used > 0}
                        onClick={() => removeTag(board.id, t.id)}
                        title={
                          used > 0
                            ? `${used} item${used === 1 ? ' still carries' : 's still carry'} this tag — clear ${used === 1 ? 'it' : 'those'} first`
                            : `Remove ${t.name}`
                        }
                        className="shrink-0 rounded p-0.5 text-slate-600 transition enabled:hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
              <div className="mt-2 flex items-center gap-1">
                <input
                  type="color"
                  value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  title="New tag colour"
                  className="h-7 w-7 shrink-0 cursor-pointer rounded border border-slate-200 bg-white"
                />
                <input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addTagToBoard()
                    }
                  }}
                  placeholder="Define a new tag…"
                  className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1.5 text-meta outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  disabled={!newTagName.trim()}
                  onClick={addTagToBoard}
                  className="flex shrink-0 items-center gap-1 rounded bg-slate-800 px-2 py-1.5 text-meta font-medium text-white disabled:opacity-40"
                  title="Create this tag for this board"
                >
                  <Plus size={11} /> Add tag
                </button>
              </div>
            </div>
          </div>
          )}

          {/* Linked boards (coordination/strategic) */}
          {isAggregatingBoard && (
            <div
              role="tabpanel"
              id="board-settings-panel-boards"
              aria-labelledby="board-settings-tab-boards"
              hidden={activeTab !== 'boards'}
              className="space-y-4"
            >
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
                  <p className="text-meta text-slate-600">No boards to link.</p>
                )}
              </div>
              <p className="mt-1 flex items-center gap-1 text-micro text-slate-600">
                <Target size={10} /> Teams or coordination boards, at any depth. A board cannot sit under its own
                descendant.
              </p>
              {/* Said here because this is where the link is made, and a portfolio is the one board
                  whose surface will not show it. */}
              {portfolio && (
                <p className="mt-1 text-micro text-slate-600">
                  A portfolio shows no bands. Its surface is its objectives and the initiatives that serve them.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <span className="text-micro text-slate-500">Saved as you edit.</span>
          <button
            type="button"
            onClick={close}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-meta font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
