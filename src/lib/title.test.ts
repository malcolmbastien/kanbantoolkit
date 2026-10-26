import { describe, expect, it } from 'vitest'
import { titleFor } from './title'

describe('what the document is called', () => {
  it('names the product when there is nothing more specific', () => {
    expect(titleFor({ view: 'board' })).toBe('Flowline')
  })

  it('leads with the board, and names the view when one is open', () => {
    expect(titleFor({ view: 'board', board: 'Team Atlas' })).toBe('Team Atlas · Flowline')
    expect(titleFor({ view: 'dashboard', board: 'Team Atlas' })).toBe('Team Atlas · Dashboard · Flowline')
    expect(titleFor({ view: 'timeline', board: 'Team Atlas' })).toBe('Team Atlas · Timeline · Flowline')
  })

  it('says a repeated name once', () => {
    // A board named after a view, or after the product, should not stutter.
    expect(titleFor({ view: 'timeline', board: 'Timeline' })).toBe('Timeline · Flowline')
  })
})
