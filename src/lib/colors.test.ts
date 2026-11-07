import { describe, expect, it } from 'vitest'
import { nextUnusedColor, VOCABULARY_PALETTE } from './colors'

describe('a new vocabulary colour', () => {
  it('starts with the first free colour', () => {
    expect(nextUnusedColor([])).toBe(VOCABULARY_PALETTE[0])
    expect(nextUnusedColor([VOCABULARY_PALETTE[0]])).toBe(VOCABULARY_PALETTE[1])
  })

  it('does not care how a colour is spelled', () => {
    expect(nextUnusedColor([VOCABULARY_PALETTE[0].toUpperCase()])).toBe(VOCABULARY_PALETTE[1])
  })

  it('walks past the named palette rather than repeating a colour', () => {
    const used = [...VOCABULARY_PALETTE]
    const fresh = nextUnusedColor(used)
    expect(used.map((colour) => colour.toLowerCase())).not.toContain(fresh)
    expect(fresh).toMatch(/^#[0-9a-f]{6}$/)
  })
})
