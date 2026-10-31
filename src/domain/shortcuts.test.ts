import { describe, expect, it } from 'vitest'
import { SHORTCUTS, SHORTCUT_GROUPS, shortcutsIn } from './shortcuts'

describe('the keyboard shortcut sheet is a complete, single list', () => {
  it('names every group, in the order the sheet reads them', () => {
    expect(SHORTCUT_GROUPS).toEqual(['Everywhere', 'Board', 'Card drawer', 'Search and palette', 'Dialogs'])
    for (const group of SHORTCUT_GROUPS) expect(shortcutsIn(group).length).toBeGreaterThan(0)
  })

  it('gives every shortcut a unique id, a label and at least one key', () => {
    const ids = SHORTCUTS.map((shortcut) => shortcut.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.label.trim(), shortcut.id).not.toBe('')
      expect(shortcut.keys.length, shortcut.id).toBeGreaterThan(0)
      expect(shortcut.keys.every((key) => key.trim().length > 0), shortcut.id).toBe(true)
    }
  })

  it('lists the global doors exactly once', () => {
    const keys = SHORTCUTS.map((shortcut) => `${shortcut.group}:${shortcut.keys.join('+')}`)
    expect(keys).toContain('Everywhere:⌘+K')
    expect(keys).toContain('Everywhere:/')
    expect(keys).toContain('Everywhere:?')
    expect(keys.filter((key) => key === 'Everywhere:?')).toHaveLength(1)
  })

  it('does not leave a shortcut in a group the sheet cannot draw', () => {
    for (const shortcut of SHORTCUTS) expect(SHORTCUT_GROUPS).toContain(shortcut.group)
  })
})
