import { canSetParent } from '@/domain/board'
import type { Graph } from '@/domain/derive'
import type { IssueType } from '@/domain/types'

/**
 * The initiative card under the pointer, if one of them would accept this item as a child.
 *
 * Resolved from the **rectangles** of the initiative cards rather than from
 * `document.elementFromPoint`, because a card is `pointer-events-none` while one is in the air —
 * that rule is what lets the lane or the cell beneath it answer — so the point under the pointer
 * can never be a card. The rectangles are read fresh on each move instead of cached: the board
 * reflows as the lifted card leaves its lane, and a cached rectangle would point at where a card
 * used to be.
 *
 * The rule is `canSetParent`, the same one the store keeps, so a target that lights up is a target
 * the drop would accept.
 */
export function parentTargetUnder(
  x: number,
  y: number,
  itemId: string,
  graph: Graph,
  issueTypes: IssueType[],
): string | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-card-initiative]')) {
    const id = el.dataset.cardId
    if (!id || id === itemId) continue
    const r = el.getBoundingClientRect()
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
    if (canSetParent(itemId, id, graph, issueTypes)) return id
  }
  return null
}
