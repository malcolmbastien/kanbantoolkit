/**
 * Every key gesture the app listens for, in one list.
 *
 * The sheet is a reading of this list rather than a second place to edit: a shortcut added to a
 * component and forgotten here would be a shortcut nobody can find, and one listed here that no
 * component answers would be a promise the app breaks. It is deliberately small and pure — no
 * React, no DOM — so the tests can assert the shape without a browser.
 */

export type ShortcutGroup = 'Everywhere' | 'Board' | 'Card drawer' | 'Search and palette' | 'Dialogs'

/** The order a person learns them in: the global doors first, then the work. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  'Everywhere',
  'Board',
  'Card drawer',
  'Search and palette',
  'Dialogs',
]

export interface Shortcut {
  id: string
  group: ShortcutGroup
  /** What the gesture does, in the app's own words. */
  label: string
  /** The keys, one cap each. A modifier is its own cap, as it is on a keyboard. */
  keys: readonly string[]
  /** Where it applies, when the group alone is not enough. */
  when?: string
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: 'palette',
    group: 'Everywhere',
    label: 'Command palette',
    keys: ['⌘', 'K'],
    when: 'Ctrl+K on Windows and Linux',
  },
  { id: 'search', group: 'Everywhere', label: 'Search every board', keys: ['/'] },
  { id: 'shortcuts', group: 'Everywhere', label: 'Keyboard shortcuts', keys: ['?'] },
  { id: 'close-layer', group: 'Everywhere', label: 'Close the top layer, or clear the selection', keys: ['Esc'] },

  { id: 'open-card', group: 'Board', label: 'Open a card', keys: ['Enter'], when: 'A card is focused' },
  { id: 'open-card-space', group: 'Board', label: 'Open a card', keys: ['Space'], when: 'A card is focused' },
  {
    id: 'card-menu',
    group: 'Board',
    label: 'Open a card menu',
    keys: ['Shift', 'F10'],
    when: 'A card is focused — or the Menu key',
  },
  { id: 'multi-select', group: 'Board', label: 'Add a card to the selection', keys: ['Shift', 'click'] },

  { id: 'close-drawer', group: 'Card drawer', label: 'Close the card', keys: ['Esc'] },
  { id: 'send-note', group: 'Card drawer', label: 'Send a note', keys: ['Enter'], when: 'The note field is focused' },
  { id: 'next-field', group: 'Card drawer', label: 'Move through the fields', keys: ['Tab'] },
  { id: 'previous-field', group: 'Card drawer', label: 'Move back through the fields', keys: ['Shift', 'Tab'] },

  { id: 'next-result', group: 'Search and palette', label: 'Next result', keys: ['↓'] },
  { id: 'previous-result', group: 'Search and palette', label: 'Previous result', keys: ['↑'] },
  { id: 'choose-result', group: 'Search and palette', label: 'Open the result', keys: ['Enter'] },
  { id: 'dismiss-results', group: 'Search and palette', label: 'Dismiss the results', keys: ['Esc'] },

  { id: 'cancel-dialog', group: 'Dialogs', label: 'Cancel or close', keys: ['Esc'] },
  { id: 'next-control', group: 'Dialogs', label: 'Move to the next control', keys: ['Tab'] },
  { id: 'previous-control', group: 'Dialogs', label: 'Move to the previous control', keys: ['Shift', 'Tab'] },
]

/** The shortcuts in one group, in the order above. */
export function shortcutsIn(group: ShortcutGroup): Shortcut[] {
  return SHORTCUTS.filter((shortcut) => shortcut.group === group)
}
