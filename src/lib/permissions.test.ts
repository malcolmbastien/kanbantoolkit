import { describe, expect, it } from 'vitest'
import { may } from './permissions'

/**
 * Every component's source, as text — Vite's own glob, because this project's app side has no
 * business importing `node:fs` (and its build says so).
 */
const COMPONENTS = import.meta.glob('/src/components/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

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

  it('is the only door: no component asks the matrix a question of its own', () => {
    // A second copy of the rules is the one thing this module exists to prevent, and it would
    // arrive as an import rather than as an argument. `ROLES` — the list, for a picker — is fine;
    // `can` is the decision, and a control making it is a control that will drift.
    // Imported by name, or called: prose is allowed to say "you can", a control may not decide.
    const decides = (source: string) => {
      for (const match of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'@\/domain\/roles'/g)) {
        if (match[1].split(',').some((name) => name.trim().replace(/^type\s+/, '') === 'can')) return true
      }
      return /(^|[^.\w])can\(/m.test(source)
    }
    const offenders = Object.entries(COMPONENTS)
      .filter(([, source]) => decides(source))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
