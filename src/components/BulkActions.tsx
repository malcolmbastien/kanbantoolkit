import { useState } from 'react'
import { Archive, CheckSquare, Trash2, X } from 'lucide-react'
import { boardCardTypes, isInitiativeItem } from '@/domain/board'
import { lanePath, leafLanes } from '@/domain/lanes'
import { useStore } from '@/store'

const SELECT_CLS =
  'rounded border border-slate-600 bg-slate-700 px-1.5 py-1 text-meta text-slate-100 outline-none focus:ring-2 focus:ring-indigo-400'

/**
 * The multi-select sub-menu: a floating bulk-action bar shown while cards are
 * shift-selected. Move to a lane, change type, assign, archive or delete them
 * all at once.
 */
export function BulkActions() {
  const multiSelect = useStore((s) => s.multiSelect)
  const boardId = useStore((s) => s.boardId)
  const lanes = useStore((s) => s.lanes)
  const users = useStore((s) => s.users)
  const issueTypes = useStore((s) => s.issueTypes)
  const boards = useStore((s) => s.boards)
  const moveCardsToLane = useStore((s) => s.moveCardsToLane)
  const setItemsType = useStore((s) => s.setItemsType)
  const items = useStore((s) => s.items)
  // An initiative is never retyped, so the control is not offered for a selection that
  // contains one.
  const selectionHasInitiative = multiSelect.some((id) => isInitiativeItem(items.find((i) => i.id === id), issueTypes))
  const addItemsAssignee = useStore((s) => s.addItemsAssignee)
  const clearItemsAssignees = useStore((s) => s.clearItemsAssignees)
  const archiveItems = useStore((s) => s.archiveItems)
  const deleteItems = useStore((s) => s.deleteItems)
  const askConfirm = useStore((s) => s.askConfirm)
  const clearMultiSelect = useStore((s) => s.clearMultiSelect)

  const [assignee, setAssignee] = useState('')

  if (multiSelect.length === 0) return null

  const leaves = leafLanes(lanes, boardId, 'cards')
  const types = boardCardTypes(boards.find((b) => b.id === boardId), issueTypes)
  const count = multiSelect.length

  const applyAssignee = () => {
    const name = assignee.trim()
    if (!name) return
    addItemsAssignee(multiSelect, name)
    setAssignee('')
  }

  return (
    <div
      data-bulk-actions
      className="fixed bottom-4 left-1/2 z-40 flex w-max max-w-[95vw] -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-meta text-slate-200 shadow-2xl"
    >
      <span className="flex items-center gap-1 font-semibold text-white">
        <CheckSquare size={13} className="text-indigo-300" /> {count} selected
      </span>

      <span className="h-5 w-px bg-slate-600" />

      <label className="flex items-center gap-1 text-slate-600">
        Move to
        <select
          value=""
          onChange={(e) => e.target.value && moveCardsToLane(multiSelect, e.target.value)}
          className={SELECT_CLS}
          title="Move every selected card to a lane"
        >
          <option value="">lane…</option>
          {leaves.map((l) => (
            <option key={l.id} value={l.id}>
              {lanePath(lanes, l.id).join(' / ')}
            </option>
          ))}
        </select>
      </label>

      {!selectionHasInitiative && (
        <label className="flex items-center gap-1 text-slate-600">
          Type
          <select
            value=""
            onChange={(e) => e.target.value && setItemsType(multiSelect, e.target.value)}
            className={SELECT_CLS}
            title="Change the type of every selected card"
          >
            <option value="">type…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex items-center gap-1 text-slate-600">
        Assign
        <input
          list="bulk-assignees"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyAssignee()
          }}
          placeholder="full name…"
          className="w-24 rounded border border-slate-600 bg-slate-700 px-1.5 py-1 text-meta text-slate-100 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <datalist id="bulk-assignees">
          {users.map((u) => (
            <option key={u.id} value={u.name} />
          ))}
        </datalist>
        <button onClick={applyAssignee} className="rounded bg-slate-700 px-1.5 py-1 font-medium text-slate-100 hover:bg-slate-600" title="Add this person to every selected card">
          Add
        </button>
        <button
          onClick={() => clearItemsAssignees(multiSelect)}
          className="rounded px-1.5 py-1 font-medium text-slate-400 hover:bg-slate-700 hover:text-white"
          title="Remove every assignee from the selection"
        >
          Clear
        </button>
      </label>

      <span className="h-5 w-px bg-slate-600" />

      <button
        onClick={() => archiveItems(multiSelect)}
        className="flex items-center gap-1 rounded border border-slate-600 px-2 py-1 font-medium text-slate-200 hover:bg-slate-700"
        title="Archive the selected cards (with their children)"
      >
        <Archive size={12} /> Archive
      </button>
      <button
        onClick={() =>
          askConfirm({
            title: `Delete ${count} card${count === 1 ? '' : 's'}?`,
            body: "This can't be undone.",
            confirmLabel: `Delete ${count}`,
            danger: true,
            onConfirm: () => deleteItems(multiSelect),
          })
        }
        className="flex items-center gap-1 rounded border border-rose-500/50 px-2 py-1 font-medium text-rose-300 hover:bg-rose-500/20"
        title="Delete the selected cards permanently"
      >
        <Trash2 size={12} /> Delete
      </button>
      <button
        onClick={clearMultiSelect}
        className="flex items-center gap-1 rounded px-2 py-1 font-medium text-slate-400 hover:bg-slate-700 hover:text-white"
        title="Clear the selection (Esc)"
      >
        <X size={12} /> Clear
      </button>
    </div>
  )
}
