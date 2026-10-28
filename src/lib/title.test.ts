import { describe, expect, it } from 'vitest'
import { titleFor } from './title'

describe('what the document is called', () => {
  it('names the product when there is nothing more specific', () => {
    expect(titleFor({ view: 'board' })).toBe('Kanban Toolkit')
  })

  it('leads with the board, and names the view when one is open', () => {
    expect(titleFor({ view: 'board', board: 'Team Atlas' })).toBe('Team Atlas · Kanban Toolkit')
    expect(titleFor({ view: 'dashboard', board: 'Team Atlas' })).toBe('Team Atlas · Dashboard · Kanban Toolkit')
    expect(titleFor({ view: 'timeline', board: 'Team Atlas' })).toBe('Team Atlas · Timeline · Kanban Toolkit')
  })

  it('says a repeated name once', () => {
    // A board named after a view, or after the product, should not stutter.
    expect(titleFor({ view: 'timeline', board: 'Timeline' })).toBe('Timeline · Kanban Toolkit')
  })
})
