import { useEffect, useState } from 'react'
import { Archive, CheckSquare, Trash2, TriangleAlert, X } from 'lucide-react'
import { canSetParent, cardTypes, defaultDropLane, isInitiativeItem } from '@/domain/board'
import type { Graph } from '@/domain/derive'
import { lanePath, leafLanes } from '@/domain/lanes'
import { useStore } from '@/store'

/*
 * The bar is a floating panel like the card menu and the palette — white, slate-bordered, one
 * shadow — so it reads as part of the app rather than as a system chrome. Its words are `body`,
 * not `meta`: it is a row of full sentences beside their controls, and a label you have to lean
 * in to read is a control you cannot use.
 */
const BAR_CLS =
  'fixed bottom-4 left-1/2 z-40 flex w-max max-w-[95vw] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-body text-slate-700 shadow-2xl'
const LABEL_CLS = 'flex items-center gap-1.5 text-slate-600'
const SELECT_CLS =
  'rounded-md border border-slate-200 bg-white px-1.5 py-1 text-body text-slate-800 outline-none transition hover:border-slate-300 focus:ring-2 focus:ring-indigo-400'
const FIELD_CLS =
  'w-28 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-body text-slate-800 placeholder:text-slate-500 outline-none transition hover:border-slate-300 focus:ring-2 focus:ring-indigo-400'
const PRIMARY_CLS =
  'rounded-md bg-indigo-600 px-2 py-1 font-medium text-white transition hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-40'
const SECONDARY_CLS =
  'flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900'
const GHOST_CLS =
  'flex items-center gap-1 rounded-md px-2 py-1 font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900'
const DANGER_CLS =
  'flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 font-medium text-rose-600 transition hover:bg-rose-50'

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

  // A refusal is about the selection it was judged against, so it does not outlive it.
  useEffect(() => setParentRefused(false), [multiSelect])

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
    <div data-bulk-actions className={BAR_CLS}>
      <span className="flex items-center gap-1.5 font-semibold text-slate-800">
        <CheckSquare size={15} className="shrink-0 text-indigo-600" /> {count} selected
      </span>

      <span className="h-5 w-px bg-slate-200" />

      <label className={LABEL_CLS}>
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
        <label className={LABEL_CLS}>
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
            className={PRIMARY_CLS}
          >
            Move
          </button>
        </label>
      )}

      {!selectionHasInitiative && (
        <label className={LABEL_CLS}>
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
        <label className={LABEL_CLS}>
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
          <button disabled={!parentTarget} onClick={applyParent} className={PRIMARY_CLS}>
            Set
          </button>
        </label>
      )}

      {/* A refusal is a warning, so it wears the warning's colours — the same amber the drawer's
          health section uses — rather than a colour of its own. */}
      {parentRefused && (
        <span role="status" className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-800 ring-1 ring-amber-300">
          <TriangleAlert size={13} className="shrink-0" /> Nothing changed: one of the selection sits above that initiative.
        </span>
      )}

      <label className={LABEL_CLS}>
        Assign
        <input
          list="bulk-assignees"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyAssignee()
          }}
          placeholder="full name…"
          className={FIELD_CLS}
        />
        <datalist id="bulk-assignees">
          {users.map((u) => (
            <option key={u.id} value={u.name} />
          ))}
        </datalist>
        <button onClick={applyAssignee} className={SECONDARY_CLS} title="Add this person to every selected card">
          Add
        </button>
        <button
          onClick={() => clearItemsAssignees(multiSelect)}
          className={GHOST_CLS}
          title="Remove every assignee from the selection"
        >
          Clear
        </button>
      </label>

      <span className="h-5 w-px bg-slate-200" />

      <button
        onClick={() => archiveItems(multiSelect)}
        className={SECONDARY_CLS}
        title="Archive the selected cards (with their children)"
      >
        <Archive size={13} /> Archive
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
        className={DANGER_CLS}
        title="Delete the selected cards permanently"
      >
        <Trash2 size={13} /> Delete
      </button>
      <button onClick={clearMultiSelect} className={GHOST_CLS} title="Clear the selection (Esc)">
        <X size={13} /> Clear
      </button>
    </div>
  )
}
