import { describe, expect, it } from 'vitest'
import { may } from './permissions'

/**
 * The interface's half of the matrix: a role answers, and nobody signed in means nobody to ask.
 */
describe('what the interface may offer', () => {
  it('leaves a browser with no account editable', () => {
    // The static build is a workspace in localStorage: there is no server, no role, nothing to
    // enforce — and the demo is the product's best argument, so it has to be usable.
    expect(may(undefined, 'item.write')).toBe(true)
    expect(may(undefined, 'board.design')).toBe(true)
  })

  it('answers a Viewer with reading and commenting only', () => {
    expect(may('viewer', 'board.read')).toBe(true)
    expect(may('viewer', 'item.comment')).toBe(true)
    expect(may('viewer', 'item.write')).toBe(false)
    expect(may('viewer', 'item.move')).toBe(false)
    expect(may('viewer', 'board.design')).toBe(false)
    expect(may('viewer', 'workspace.members')).toBe(false)
  })

  it('answers an Editor with the work, not the board', () => {
    expect(may('editor', 'item.write')).toBe(true)
    expect(may('editor', 'item.move')).toBe(true)
    expect(may('editor', 'board.design')).toBe(false)
    expect(may('editor', 'workspace.delete')).toBe(false)
  })

  it('answers an Administrator with everything', () => {
    expect(may('admin', 'board.design')).toBe(true)
    expect(may('admin', 'workspace.delete')).toBe(true)
  })

  it('treats a role it does not recognise as a Viewer', () => {
    // A server that grew a role this build has not heard of must not become an Administrator.
    expect(may('superuser', 'item.write')).toBe(false)
    expect(may('superuser', 'board.read')).toBe(false)
  })
})
