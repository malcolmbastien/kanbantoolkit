import { describe, expect, it } from 'vitest'
import { parseReport, pathOnly } from './report'

const report = (over: Record<string, unknown> = {}) => ({
  message: 'Cannot read properties of undefined',
  stack: 'TypeError: ...\n    at dropCardAt (index.js:1:1)',
  url: '/?board=b-atlas&item=init-signup&q=acme',
  view: 'board',
  release: 'd2861aa',
  ua: 'Mozilla/5.0',
  ...over,
})

describe('what the error endpoint accepts', () => {
  it('keeps the error and drops the query it came with', () => {
    const parsed = parseReport(report())!
    expect(parsed.message).toBe('Cannot read properties of undefined')
    expect(parsed.release).toBe('d2861aa')
    expect(parsed.url).toBe('/')
    // Board ids, item ids and search terms live in the query, and none of them travel.
    expect(parsed.url).not.toContain('b-atlas')
    expect(JSON.stringify(parsed)).not.toContain('init-signup')
    expect(JSON.stringify(parsed)).not.toContain('acme')
  })

  it('refuses a report with no message', () => {
    expect(parseReport(report({ message: '   ' }))).toBe(null)
    expect(parseReport(report({ message: 42 }))).toBe(null)
    expect(parseReport(null)).toBe(null)
    expect(parseReport('a string')).toBe(null)
    expect(parseReport([])).toBe(null)
  })

  it('cuts every field to its ceiling rather than storing what it is given', () => {
    const parsed = parseReport(
      report({
        message: 'm'.repeat(10_000),
        stack: 's'.repeat(100_000),
        ua: 'u'.repeat(10_000),
        view: 'v'.repeat(1_000),
        release: 'r'.repeat(1_000),
        url: `/${'p'.repeat(10_000)}`,
      }),
    )!
    expect(parsed.message).toHaveLength(300)
    expect(parsed.stack).toHaveLength(4000)
    expect(parsed.ua).toHaveLength(200)
    expect(parsed.view).toHaveLength(40)
    expect(parsed.release).toHaveLength(40)
    expect(parsed.url.length).toBeLessThanOrEqual(300)
  })

  it('treats what it cannot read as empty, never as a wildcard', () => {
    expect(pathOnly(42)).toBe('')
    expect(pathOnly(null)).toBe('')
    expect(pathOnly('')).toBe('')
    const parsed = parseReport({ message: 'boom' })!
    expect(parsed).toEqual({ message: 'boom', stack: '', url: '', view: '', release: '', ua: '' })
  })
})
