import { describe, expect, it } from 'vitest'
import { placeFromQuery, urlQuery, viewOf, type Place, type ViewFlags } from './url'

const flags = (over: Partial<ViewFlags> = {}): ViewFlags => ({
  showBoards: false,
  showArchive: false,
  showObjectives: false,
  showDashboard: false,
  showMetrics: false,
  showTimeline: false,
  showAdmin: false,
  ...over,
})

const place = (over: Partial<Place> = {}): Place => ({ boardId: 'b-atlas', view: 'board', itemId: null, ...over })

describe('the view a place is in', () => {
  it('names every view, and the board’s own flow is the one with no flag set', () => {
    expect(viewOf(flags())).toBe('board')
    expect(viewOf(flags({ showDashboard: true }))).toBe('dashboard')
    expect(viewOf(flags({ showTimeline: true }))).toBe('timeline')
    expect(viewOf(flags({ showMetrics: true }))).toBe('flow')
    expect(viewOf(flags({ showArchive: true }))).toBe('archive')
    expect(viewOf(flags({ showBoards: true }))).toBe('boards')
    expect(viewOf(flags({ showObjectives: true }))).toBe('objectives')
  })

  it('resolves a state holding two flags to the view App would actually render', () => {
    // App's order: workspace, archive, objectives, dashboard, flow, timeline, board.
    expect(viewOf(flags({ showBoards: true, showDashboard: true }))).toBe('boards')
    expect(viewOf(flags({ showArchive: true, showTimeline: true }))).toBe('archive')
    expect(viewOf(flags({ showDashboard: true, showTimeline: true }))).toBe('dashboard')
    expect(viewOf(flags({ showMetrics: true, showTimeline: true }))).toBe('flow')
  })
})

describe('the query a place writes', () => {
  it('writes the board, and only what else there is to say', () => {
    expect(urlQuery(place())).toBe('?board=b-atlas')
    expect(urlQuery(place({ view: 'timeline' }))).toBe('?board=b-atlas&view=timeline')
    expect(urlQuery(place({ itemId: 'init-signup' }))).toBe('?board=b-atlas&item=init-signup')
    expect(urlQuery(place({ view: 'flow', itemId: 'st-email' }))).toBe('?board=b-atlas&view=flow&item=st-email')
  })

  it('says nothing at all for a place with no board', () => {
    expect(urlQuery(place({ boardId: '' }))).toBe('')
  })

  it('writes one URL per place — no two places share one, no one place has two', () => {
    const places: Place[] = [
      place(),
      place({ view: 'dashboard' }),
      place({ view: 'timeline' }),
      place({ view: 'flow' }),
      place({ boardId: 'b-nova' }),
      place({ itemId: 'init-signup' }),
      place({ itemId: 'st-email' }),
      place({ view: 'archive', itemId: 'st-email' }),
    ]
    const written = places.map(urlQuery)
    expect(new Set(written).size).toBe(places.length)
    // And stable: the same place written twice is the same string, key order and all.
    for (const p of places) expect(urlQuery({ ...p })).toBe(urlQuery(p))
  })

  it('never writes a view for the board’s own flow', () => {
    expect(urlQuery(place({ view: 'board' }))).not.toContain('view=')
  })
})

describe('the place a query names', () => {
  it('reads the board, the view and the open card', () => {
    expect(placeFromQuery('?board=b-nova')).toEqual({ boardId: 'b-nova', view: 'board' })
    expect(placeFromQuery('?board=b-nova&view=timeline')).toEqual({ boardId: 'b-nova', view: 'timeline' })
    expect(placeFromQuery('?board=b-nova&view=dashboard&item=init-signup')).toEqual({
      boardId: 'b-nova',
      view: 'dashboard',
      itemId: 'init-signup',
    })
  })

  it('reads an absent view as the workspace home, unless the query names a board', () => {
    // The two directions have to agree, or the back button lands on a board still showing the
    // Timeline under a URL that no longer mentions it.
    expect(placeFromQuery('').view).toBe('boards')
    expect(placeFromQuery('?board=b-atlas').view).toBe('board')
    expect(placeFromQuery('?view=board').view).toBe('board')
    expect(placeFromQuery('?view=nonsense').view).toBe('board')
  })

  it('names no board and no card when the query does not', () => {
    expect(placeFromQuery('')).toEqual({ view: 'boards' })
    expect(placeFromQuery('?q=signup')).toEqual({ view: 'board' })
    expect(placeFromQuery('?stress=300')).toEqual({ view: 'board' })
    expect(placeFromQuery('?edit=1&select=a,b&collapse=l1')).toEqual({ view: 'board' })
  })

  it('accepts the store’s older word for the Flow view', () => {
    expect(placeFromQuery('?view=metrics').view).toBe('flow')
    expect(placeFromQuery('?view=flow').view).toBe('flow')
  })

  it('reads every view the app has', () => {
    for (const name of ['dashboard', 'timeline', 'flow', 'archive', 'boards', 'objectives']) {
      expect(placeFromQuery(`?view=${name}`).view).toBe(name)
    }
  })
})

describe('a place survives the round trip', () => {
  it('writes a query that reads back as the place it came from', () => {
    const places: Place[] = [
      place(),
      place({ view: 'timeline' }),
      place({ view: 'flow', itemId: 'st-email' }),
      place({ boardId: 'b-strategy', view: 'boards' }),
      place({ itemId: 'init-revenue' }),
    ]
    for (const p of places) {
      const back = placeFromQuery(urlQuery(p))
      // A query cannot say "no card open" — absence there means "leave it alone" — so the app's
      // own default supplies what the URL is silent about. Everything it *does* say must survive.
      expect(back.boardId).toBe(p.boardId)
      expect(back.view).toBe(p.view)
      expect(back.itemId ?? null).toBe(p.itemId)
    }
  })

  it('normalises a hand-written link to the same place', () => {
    // The board's flow spelled out, a legacy view name, and parameters that are not places.
    expect(placeFromQuery('?view=board&board=b-atlas&q=signup&stress=300')).toEqual({ boardId: 'b-atlas', view: 'board' })
    expect(urlQuery({ ...place(), ...placeFromQuery('?board=b-atlas&view=metrics&q=x') })).toBe('?board=b-atlas&view=flow')
  })
})
