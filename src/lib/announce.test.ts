import { beforeEach, describe, expect, it } from 'vitest'
import { announce, resetAnnouncements, subscribeAnnouncements } from './announce'

/**
 * The voice, on its own. What matters is that it is *one* voice, that a silent app stays silent
 * (nothing is said before anything is listening), and that the same sentence twice is still said
 * twice — a refusal repeated is a refusal, not a bug in the second attempt.
 */

const heard: string[] = []
beforeEach(() => {
  resetAnnouncements()
  heard.length = 0
})

describe('the announcer', () => {
  it('says nothing when nobody is listening', () => {
    expect(() => announce('A card moved.')).not.toThrow()
  })

  it('speaks once, in the words it was given', () => {
    const off = subscribeAnnouncements((message) => heard.push(message))
    announce('  Maya moved Card to In Progress.  ')
    expect(heard).toEqual(['Maya moved Card to In Progress.'])
    off()
  })

  it('says the same thing twice as two things', () => {
    subscribeAnnouncements((message) => heard.push(message))
    announce('Refused.')
    announce('Refused.')
    expect(heard).toHaveLength(2)
    // The second is new text (a zero-width space), so a live region reads it instead of
    // deciding that nothing changed.
    expect(heard[1].replace('\u200b', '')).toBe(heard[0])
    expect(heard[1]).not.toBe(heard[0])
  })

  it('stops when the listener unsubscribes', () => {
    const off = subscribeAnnouncements((message) => heard.push(message))
    off()
    announce('Nothing should hear this.')
    expect(heard).toEqual([])
  })

  it('ignores an empty message rather than clearing the region', () => {
    subscribeAnnouncements((message) => heard.push(message))
    announce('   ')
    expect(heard).toEqual([])
  })
})
