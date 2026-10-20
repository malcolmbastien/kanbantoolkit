/**
 * The app's place, as a URL.
 *
 * A place is a board, a view of it, and the card or initiative open over it — three facts, one
 * canonical query:
 *
 *     /?board=b-atlas                          the board's own flow
 *     /?board=b-atlas&view=timeline            a view of that board
 *     /?board=b-atlas&item=init-signup         a card or initiative open on it
 *     /?board=b-atlas&view=dashboard&item=…    both at once
 *
 * Canonical, not merely faithful: the query is rebuilt from the state every time and anything the
 * app does not recognise is dropped, so one place has exactly one URL and two people looking at
 * the same thing hold the same link.
 *
 * The other parameters the app understands (`?q=`, `?filters=`, `?collapse=`, `?select=`, `?lens=`,
 * `?boundary=`, `?stress=`, `?edit=`) are *intentions* rather than places: they say what to do on
 * arrival and are consumed, normalised away, and never written back. `?edit=` is deliberately one
 * of them — edit mode is a mode, not a place, and the back button must never be the thing that
 * throws a board design away.
 */

/** Every view the app can be in. `board` is the board's own flow — the Board tab. */
export type ViewName = 'board' | 'dashboard' | 'timeline' | 'flow' | 'archive' | 'mywork' | 'boards' | 'objectives' | 'admin'

/** The view flags a place is read from. */
export interface ViewFlags {
  showBoards: boolean
  showArchive: boolean
  showMyWork: boolean
  showObjectives: boolean
  showDashboard: boolean
  showMetrics: boolean
  showTimeline: boolean
  /** The workspace's own administration: the copies this browser keeps, and its storage. */
  showAdmin: boolean
}

/** Where the app is. */
export interface Place {
  boardId: string
  view: ViewName
  itemId: string | null
}

/**
 * The view a set of flags names.
 *
 * The order is the order App renders in — first flag set wins — so a state that somehow holds two
 * still resolves to the view actually on screen. In practice only one is ever set: `setView` is the
 * one door, and the round trip through it is tested.
 */
export function viewOf(flags: ViewFlags): ViewName {
  if (flags.showBoards) return 'boards'
  if (flags.showArchive) return 'archive'
  if (flags.showMyWork) return 'mywork'
  if (flags.showObjectives) return 'objectives'
  if (flags.showDashboard) return 'dashboard'
  if (flags.showMetrics) return 'flow'
  if (flags.showTimeline) return 'timeline'
  if (flags.showAdmin) return 'admin'
  return 'board'
}

/** The canonical query for a place. One place, one string. */
export function urlQuery(place: Place): string {
  const params = new URLSearchParams()
  if (place.boardId) params.set('board', place.boardId)
  // The board's own flow is the absence of a view, not a view named `board`: `/?board=x` is the
  // shortest true thing to say, and it is what a person writes by hand.
  if (place.view !== 'board') params.set('view', place.view)
  if (place.itemId) params.set('item', place.itemId)
  const query = params.toString()
  return query ? `?${query}` : ''
}

/**
 * What a view is called in a URL, and what each name means.
 *
 * `metrics` is the store's word for the Flow view and is accepted so links written before this
 * existed still land; `flow` is what the tab has always said and is the only thing written back.
 */
const VIEW_NAMES: Record<string, ViewName> = {
  board: 'board',
  dashboard: 'dashboard',
  timeline: 'timeline',
  flow: 'flow',
  metrics: 'flow',
  archive: 'archive',
  mywork: 'mywork',
  boards: 'boards',
  objectives: 'objectives',
  admin: 'admin',
}

/**
 * The place a query names — what a link means, followed at boot or with the back button.
 *
 * An absent `view` means the board's own flow, not "no opinion": every URL the app writes says
 * which view it is in by leaving the parameter off when it is the board. Reading it the other way
 * round is what would make the back button land on a board still showing the Timeline, under a URL
 * that no longer mentioned it.
 *
 * A view name nobody knows lands on the board's flow too — the app's home, and a real place to be.
 */
export function placeFromQuery(search: string): Partial<Place> {
  const params = new URLSearchParams(search)
  const place: Partial<Place> = { view: VIEW_NAMES[params.get('view') ?? 'board'] ?? 'board' }
  const board = params.get('board')
  if (board) place.boardId = board
  const item = params.get('item')
  if (item) place.itemId = item
  return place
}
