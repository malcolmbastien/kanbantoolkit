import type { ViewName } from './url'

/**
 * What the document is called — in the tab, in history, in a bookmark.
 *
 * The board is the page, so its name leads and stays put while a card is opened and closed over
 * it. The view (Dashboard, Timeline, …) follows, saying which surface of that board is showing,
 * and the product is always last. The open card is deliberately not part of the name: a tab that
 * changes every time a drawer opens makes the board harder to find, not easier.
 */
const PRODUCT = 'Kanban Toolkit'

const VIEW_LABEL: Record<ViewName, string | null> = {
  board: null,
  dashboard: 'Dashboard',
  timeline: 'Timeline',
  flow: 'Flow',
  archive: 'Archive',
  boards: 'Workspace Home',
  objectives: 'Objectives',
  admin: 'Admin',
}

export function titleFor(place: { view: ViewName; board?: string }): string {
  const parts = [place.board, VIEW_LABEL[place.view]].filter((part): part is string => Boolean(part))
  // A board called "Admin" should not read "Admin · Admin"; a repeated part is said once.
  const said = parts.filter((part, i) => parts.indexOf(part) === i)
  return [...said, PRODUCT].join(' · ')
}
