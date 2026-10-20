import { describe, expect, it } from 'vitest'
import { describeError, placeOf } from './errors'

describe('what an error report is allowed to say', () => {
  it('describes an Error, a thrown string and a thrown object without guessing', () => {
    const err = new TypeError('Cannot read properties of undefined')
    expect(describeError(err).message).toBe('Cannot read properties of undefined')
    expect(describeError(err).stack).toContain('TypeError')

    expect(describeError('boom').message).toBe('boom')
    expect(describeError({ reason: 'nope' }).message).toBe('{"reason":"nope"}')

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(describeError(circular).message).toBe('Unknown error')
  })

  it('keeps the path and the view, and never the query', () => {
    const place = placeOf({ pathname: '/', search: '?board=b-atlas&item=init-signup&q=acme&view=dashboard' })
    expect(place).toEqual({ url: '/', view: 'dashboard' })
    expect(JSON.stringify(place)).not.toContain('b-atlas')
    expect(JSON.stringify(place)).not.toContain('init-signup')
    expect(JSON.stringify(place)).not.toContain('acme')
  })

  it('calls the board view the default, because that is what an absent view means', () => {
    expect(placeOf({ pathname: '/', search: '' })).toEqual({ url: '/', view: 'board' })
    expect(placeOf({ pathname: '/', search: '?board=b-atlas' })).toEqual({ url: '/', view: 'board' })
  })
})
