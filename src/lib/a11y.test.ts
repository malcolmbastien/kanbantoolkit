import { describe, expect, it } from 'vitest'

/**
 * The rules a source file can be held to, checked against the sources themselves.
 *
 * What a browser test proves is that *this* dialog traps focus; what it cannot prove is that the
 * next dialog will. These are the cheap structural guards — every modal is the same modal, and the
 * reduced-motion rule is in the stylesheet rather than in one component's gut — so a surface added
 * later cannot quietly opt out by not knowing about the shared hook.
 */


const SOURCES = import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const MODALS = Object.entries(SOURCES).filter(([, text]) => text.includes('role="dialog"'))

describe('the surfaces', () => {
  it('is something to hold: there are dialogs to check', () => {
    expect(MODALS.length).toBeGreaterThan(5)
  })

  it('gives every dialog the same focus trap', () => {
    // A dialog that does not use the hook is a dialog where Tab walks out into the board behind
    // it, and where Escape leaves the caret at the top of the document.
    const offenders = MODALS.filter(([, text]) => !text.includes('useDialogFocus(')).map(([file]) => file)
    expect(offenders).toEqual([])
  })

  it('tells a screen reader that a dialog is modal', () => {
    // `aria-modal` is what tells the rest of the page it is not there. Without it a screen reader
    // still reads the board behind the confirmation.
    const offenders = MODALS.filter(([, text]) => !text.includes('aria-modal')).map(([file]) => file)
    expect(offenders).toEqual([])
  })

  it('names every dialog', () => {
    const offenders = MODALS.filter(([, text]) => !/role="dialog"[\s\S]{0,240}aria-label(ledby)?=/.test(text)).map(([file]) => file)
    expect(offenders).toEqual([])
  })
})

// Reduced motion is not checked here: it lives in the stylesheet, and the honest test of it is a
// browser with the preference set, which is what `e2e/a11y.spec.ts` does.

describe('announcements', () => {
  it('has one live region, and it is mounted once', () => {
    const regions = Object.entries(SOURCES).filter(([, text]) => text.includes('aria-live="polite"'))
    expect(regions.map(([file]) => file)).toContain('/src/components/Announcer.tsx')
    // The app mounts it at the root, beside the overlays, so no surface has to remember to.
    expect(SOURCES['/src/App.tsx']).toContain('<Announcer />')
  })
})
