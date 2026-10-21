import { describe, expect, it } from 'vitest'
import { titleFor } from './title'

describe('what the document is called', () => {
  it('names the product when there is nothing more specific', () => {
    expect(titleFor({ view: 'board' })).toBe('Flowline')
  })

  it('names the board on its own flow, and the view when one is open', () => {
    expect(titleFor({ view: 'board', board: 'Team Atlas' })).toBe('Team Atlas · Flowline')
    expect(titleFor({ view: 'dashboard', board: 'Team Atlas' })).toBe('Dashboard · Team Atlas · Flowline')
  })

  it('puts the open card first, because it is the most specific thing on screen', () => {
    expect(titleFor({ view: 'board', board: 'Team Atlas', card: 'Add SSO for enterprise tenants' })).toBe(
      'Add SSO for enterprise tenants · Team Atlas · Flowline',
    )
    expect(titleFor({ view: 'flow', board: 'Team Atlas', card: 'Add SSO' })).toBe(
      'Add SSO · Flow · Team Atlas · Flowline',
    )
  })

  it('says a repeated name once', () => {
    // A board named after a view, or after the product, should not stutter.
    expect(titleFor({ view: 'timeline', board: 'Timeline' })).toBe('Timeline · Flowline')
  })
})
