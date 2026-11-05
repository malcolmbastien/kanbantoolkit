/**
 * How much of a card a board draws.
 *
 * A reading choice, not a fact about the work: two people looking at the same board may want
 * different density, and neither answer changes a placement, a rollup or a warning. The order is
 * least to most detailed, so the dial reads left to right as "less … more":
 *
 *     mini ── summary ── full
 *
 * **mini** is a colour tile per item — the type's colour, plus a marker for blocked or a warning —
 * for scanning a whole board. **summary** is the title, type, due date and people, with the
 * warnings kept and the extras dropped. **full** is the card the app has always drawn.
 */
export const BOARD_DETAIL_LEVELS = ['mini', 'summary', 'full'] as const

export type BoardDetail = (typeof BOARD_DETAIL_LEVELS)[number]

/** The word on the dial. */
export const BOARD_DETAIL_LABEL: Record<BoardDetail, string> = {
  mini: 'Mini',
  summary: 'Summary',
  full: 'Full',
}

/** What the level means, in the control's own tooltip. */
export const BOARD_DETAIL_HINT: Record<BoardDetail, string> = {
  mini: 'Colour tiles only — scan the whole board, with blocked and warning markers',
  summary: 'Title, type, due date and people — the key facts, without the extras',
  full: 'Every field, badge and control the card has',
}

/** Whether a stored value is a level this build can draw. */
export function isBoardDetail(value: unknown): value is BoardDetail {
  return typeof value === 'string' && (BOARD_DETAIL_LEVELS as readonly string[]).includes(value)
}

/**
 * The level for one board. A missing entry is **full**, so a workspace written before the dial
 * existed opens exactly as it did then, and a board nobody has chosen for keeps the complete card.
 */
export function detailFor(levels: Readonly<Record<string, BoardDetail>> | undefined, boardId: string): BoardDetail {
  const value = levels?.[boardId]
  return isBoardDetail(value) ? value : 'full'
}

/** The next level in a direction, wrapping at the ends — what the dial's arrow keys do. */
export function nextDetail(current: BoardDetail, direction: number): BoardDetail {
  const index = BOARD_DETAIL_LEVELS.indexOf(current)
  const step = direction < 0 ? -1 : 1
  return BOARD_DETAIL_LEVELS[(index + step + BOARD_DETAIL_LEVELS.length) % BOARD_DETAIL_LEVELS.length]
}
