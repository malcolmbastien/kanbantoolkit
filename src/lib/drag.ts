import { create } from 'zustand'

/**
 * The gesture, kept apart from the workspace.
 *
 * A drag is not a change to a board: it is a card in the air and the gap it would land in. Keeping
 * it in the workspace store made every pointer move a workspace write — and in the hosted build a
 * serialise of the persisted slice — so the board re-rendered on a gesture that changed nothing.
 *
 * Only the surfaces that draw the gesture read this store: the canvases, the drop column and the
 * lifted card. The workspace store no longer knows a drag is happening.
 */

export interface DragPreview {
  itemId: string
  height: number
  laneId: string | null
  index: number | null
}

interface DragState {
  dragPreview: DragPreview | null
  /** The initiative a card in the air would become a child of. */
  dropTargetId: string | null
  setDragPreview: (preview: DragPreview | null) => void
  setDropTarget: (dropTargetId: string | null) => void
}

const same = (a: DragPreview | null, b: DragPreview | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.itemId === b.itemId &&
    a.height === b.height &&
    a.laneId === b.laneId &&
    a.index === b.index)

export const useDrag = create<DragState>((set, get) => ({
  dragPreview: null,
  dropTargetId: null,
  // Called on every pointer move: a no-op move must not wake the board.
  setDragPreview: (dragPreview) => {
    if (same(get().dragPreview, dragPreview)) return
    set({ dragPreview })
  },
  setDropTarget: (dropTargetId) => {
    if (get().dropTargetId === dropTargetId) return
    set({ dropTargetId })
  },
}))
