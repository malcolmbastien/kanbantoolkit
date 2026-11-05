/**
 * Where a drop lands in a row of cards.
 *
 * The board has two shapes of cards: a column of full cards, where a pointer's **y** says which
 * gap it means, and a wrapping grid of Mini tiles, where both **x** and **y** are needed. One
 * function answers "which place" for both, so the preview and the write cannot disagree.
 *
 * The index counts the cards that remain in the lane (the card in the air is already excluded), so
 * it is the same number `moveCardToIndex` takes. A pointer between tiles of a row lands before the
 * first tile whose middle is to its right; past the last tile of a row it lands after that row,
 * not at the end of the whole cell.
 */
export function insertionIndex(cards: readonly HTMLElement[], x: number, y: number, dense: boolean): number {
  if (!cards.length) return 0
  if (!dense) {
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect()
      if (y < r.top + r.height / 2) return i
    }
    return cards.length
  }

  // Group by the visual row. A pixel of tolerance covers sub-pixel layout; anything bigger is a
  // different row, which is what the wrapping grid draws.
  const rows: Array<{ top: number; items: Array<{ index: number; rect: DOMRect }> }> = []
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect()
    const row = rows.find((candidate) => Math.abs(candidate.top - rect.top) < 2)
    if (row) row.items.push({ index: i, rect })
    else rows.push({ top: rect.top, items: [{ index: i, rect }] })
  }

  // The row the pointer is in, or the first one below it; below every row means the end.
  const row = rows.find((candidate) => y < candidate.items[0].rect.bottom) ?? rows[rows.length - 1]
  // Above the row's own top is before it, whatever the x: the pointer is in the gap above.
  if (y < row.items[0].rect.top) return row.items[0].index
  for (const { index, rect } of row.items) {
    if (x < rect.left + rect.width / 2) return index
  }
  return row.items[row.items.length - 1].index + 1
}
