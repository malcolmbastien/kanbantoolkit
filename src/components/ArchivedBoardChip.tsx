import { Archive } from 'lucide-react'
import { useStore } from '@/store'

/**
 * Shown while the board you are looking at is archived: it is out of the picker, the
 * workspace's list and the rollups, but nothing was destroyed and it is still fully
 * usable. This is how you bring it back.
 *
 * A chip rather than a whole strip, so both board surfaces can carry it inside the strip
 * they already have.
 */
export function ArchivedBoardChip() {
  const boardId = useStore((s) => s.boardId)
  const archived = useStore((s) => Boolean(s.boards.find((b) => b.id === s.boardId)?.archived))
  const unarchiveBoard = useStore((s) => s.unarchiveBoard)

  if (!archived) return null
  return (
    <span className="flex items-center gap-1.5 rounded bg-slate-500/30 px-1.5 py-px font-semibold text-slate-200">
      <Archive size={11} /> archived — out of the picker and rollups
      <button
        onClick={() => unarchiveBoard(boardId)}
        className="ml-0.5 rounded bg-white/15 px-1.5 py-px font-medium text-white transition hover:bg-white/25"
      >
        Restore
      </button>
    </span>
  )
}
