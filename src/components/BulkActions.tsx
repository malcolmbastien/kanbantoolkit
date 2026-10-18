import { useState } from 'react'
import { Archive, CheckSquare, Trash2, TriangleAlert, X } from 'lucide-react'
import { canSetParent, cardTypes, defaultDropLane, isInitiativeItem } from '@/domain/board'
import type { Graph } from '@/domain/derive'
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
  const moveCardsToLane = useStore((s) => s.moveCardsToLane)
  const moveCardsToBoard = useStore((s) => s.moveCardsToBoard)
  const boards = useStore((s) => s.boards)
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

  const setParents = useStore((s) => s.setParents)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)

  const [assignee, setAssignee] = useState('')
  const [targetBoard, setTargetBoard] = useState('')
  const [parentTarget, setParentTarget] = useState('')
  const [parentRefused, setParentRefused] = useState(false)

  if (multiSelect.length === 0) return null

  const leaves = leafLanes(lanes, boardId, 'cards')
  // The boards this one can hand work to, each labelled with the cell it would land in — the
  // destination is not a mystery to be discovered after the move.
  const elsewhere = boards
    .filter((b) => b.id !== boardId)
    .map((b) => ({ board: b, lane: defaultDropLane(b, lanes, b.id) }))
  const types = cardTypes(issueTypes)
  const count = multiSelect.length

  // The initiatives that could take every one of them: the list the drawer's parent control
  // offers for one item, narrowed to what the whole selection accepts — so a choice that is
  // offered is a choice the store takes.
  const graph: Graph = { items, edges, links, placements, lanes }
  const parentCandidates = items.filter(
    (i) => isInitiativeItem(i, issueTypes) && multiSelect.every((id) => canSetParent(id, i.id, graph, issueTypes)),
  )

  const applyParent = () => {
    if (!parentTarget) return
    // The whole selection is judged before anything is written, so a refusal changes nothing —
    // and says why.
    const applied = setParents(multiSelect, parentTarget)
    setParentRefused(!applied)
    if (applied) setParentTarget('')
  }

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

      {/* Handing work to another board, which is a different act from moving it within this
          one: the cards leave, and where they land is that board's own answer. */}
      {elsewhere.length > 0 && (
        <label className="flex items-center gap-1 text-slate-600">
          Move to board
          <select
            value={targetBoard}
            onChange={(e) => setTargetBoard(e.target.value)}
            className={SELECT_CLS}
            title="Move every selected card to another board, into the cell that board lands cards in"
          >
            <option value="">board…</option>
            {elsewhere.map(({ board, lane }) => (
              <option key={board.id} value={board.id}>
                {board.name}
                {lane ? ` → ${lanePath(lanes, lane.id).join(' / ')}` : ' → no cell'}
              </option>
            ))}
          </select>
          <button
            disabled={!targetBoard}
            onClick={() => {
              moveCardsToBoard(multiSelect, targetBoard)
              setTargetBoard('')
            }}
            className="rounded bg-indigo-600 px-2 py-1 font-medium text-white disabled:opacity-40"
          >
            Move
          </button>
        </label>
      )}

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

      {/* Hierarchy is not retyping: an initiative can be a child of another, so this control
          is offered for every selection, initiatives included. */}
      {parentCandidates.length > 0 && (
        <label className="flex items-center gap-1 text-slate-600">
          Roll up to
          <select
            value={parentTarget}
            onChange={(e) => {
              setParentTarget(e.target.value)
              setParentRefused(false)
            }}
            className={SELECT_CLS}
            title="Make every selected item a child of one initiative"
          >
            <option value="">initiative…</option>
            {parentCandidates.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </select>
          <button
            disabled={!parentTarget}
            onClick={applyParent}
            className="rounded bg-indigo-600 px-2 py-1 font-medium text-white disabled:opacity-40"
          >
            Set
          </button>
        </label>
      )}

      {parentRefused && (
        <span role="status" className="flex items-center gap-1 text-amber-300">
          <TriangleAlert size={12} /> Nothing changed: one of the selection sits above that initiative.
        </span>
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
