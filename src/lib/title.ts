import type { ViewName } from './url'

/**
 * What the document is called — in the tab, in history, in a bookmark.
 *
 * The most specific thing first: the open card, then the view, then the board, and always the
 * product. A place with none of the first three is the board's own flow, which the board names.
 */
const PRODUCT = 'Flowline'

const VIEW_LABEL: Record<ViewName, string | null> = {
  board: null,
  dashboard: 'Dashboard',
  timeline: 'Timeline',
  flow: 'Flow',
  archive: 'Archive',
  mywork: 'My work',
  boards: 'Boards',
  objectives: 'Objectives',
  admin: 'Admin',
}

export function titleFor(place: { card?: string; view: ViewName; board?: string }): string {
  const parts = [place.card, VIEW_LABEL[place.view], place.board].filter((part): part is string => Boolean(part))
  // A board called "Admin" should not read "Admin · Admin"; a repeated part is said once.
  const said = parts.filter((part, i) => parts.indexOf(part) === i)
  return [...said, PRODUCT].join(' · ')
}
