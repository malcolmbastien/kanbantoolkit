import { describe, expect, it } from 'vitest'
import {
  BOARD_DETAIL_LEVELS,
  BOARD_DETAIL_LABEL,
  detailFor,
  isBoardDetail,
  nextDetail,
} from './boardDetail'

describe('the board level of detail', () => {
  it('names the three levels from least to most detailed', () => {
    expect(BOARD_DETAIL_LEVELS).toEqual(['mini', 'summary', 'full'])
    expect(BOARD_DETAIL_LABEL).toEqual({ mini: 'Mini', summary: 'Summary', full: 'Full' })
  })

  it('defaults a board with no choice to Full', () => {
    expect(detailFor(undefined, 'b-atlas')).toBe('full')
    expect(detailFor({}, 'b-atlas')).toBe('full')
    expect(detailFor({ 'b-atlas': 'mini' }, 'b-atlas')).toBe('mini')
    expect(detailFor({ 'b-atlas': 'summary' }, 'b-nova')).toBe('full')
  })

  it('refuses a value this build does not draw', () => {
    expect(isBoardDetail('mini')).toBe(true)
    expect(isBoardDetail('summary')).toBe(true)
    expect(isBoardDetail('full')).toBe(true)
    expect(isBoardDetail('tiny')).toBe(false)
    expect(isBoardDetail(2)).toBe(false)
    // A stored value from a future build falls back rather than half-rendering.
    expect(detailFor({ 'b-atlas': 'tiny' as never }, 'b-atlas')).toBe('full')
  })

  it('wraps the dial in both directions', () => {
    expect(nextDetail('mini', 1)).toBe('summary')
    expect(nextDetail('summary', 1)).toBe('full')
    expect(nextDetail('full', 1)).toBe('mini')
    expect(nextDetail('full', -1)).toBe('summary')
    expect(nextDetail('mini', -1)).toBe('full')
  })
})
