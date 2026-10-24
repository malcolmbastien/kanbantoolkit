import { useEffect, useRef, type RefObject } from 'react'

/**
 * An open dialog is a place, and focus stays in it until it closes.
 *
 * Three things, and they are one thing: the caret starts inside, Tab and Shift+Tab cycle within
 * rather than wandering out into the board behind, and when the surface goes the caret returns to
 * whatever opened it — so a keyboard user is never dumped at the top of the document with no idea
 * where they were.
 *
 * Only the topmost surface acts: dialogs nest (a confirmation over a drawer), and Escape should
 * close the one the person can see, not both.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'summary',
].join(',')

/** The stack of open surfaces, newest last — the one that owns the keyboard. */
const surfaces: symbol[] = []

export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  /**
   * Whether the surface is on screen. Components that only mount with their dialog pass nothing;
   * one that stays mounted and renders its dialog conditionally passes the condition, so the trap
   * is set up when the surface appears rather than when the file first ran.
   */
  open = true,
  /** A selector for the control that should take the caret first, when it is not the first one. */
  initial?: string,
): void {
  // The callback changes on every render of most dialogs; the effect must not, or the caret would
  // jump back to the top of the dialog on every keystroke.
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    if (!open) return
    const root = ref.current
    if (!root) return

    const id = Symbol('dialog')
    surfaces.push(id)
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const visible = (element: HTMLElement) => element.getClientRects().length > 0
    const focusable = () => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible)

    // A dialog with nothing to focus is still a place: the container itself takes the caret, which
    // is what makes Escape reach it and what stops Tab from walking out.
    const first = () => (initial ? root.querySelector<HTMLElement>(initial) : null) ?? focusable()[0] ?? root
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
    first().focus()

    const onKey = (event: KeyboardEvent) => {
      if (surfaces[surfaces.length - 1] !== id) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        close.current()
        return
      }
      if (event.key !== 'Tab') return

      const nodes = focusable()
      if (nodes.length === 0) {
        event.preventDefault()
        root.focus()
        return
      }
      const at = nodes.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey) {
        if (at <= 0) {
          event.preventDefault()
          nodes[nodes.length - 1].focus()
        }
      } else if (at === -1 || at === nodes.length - 1) {
        event.preventDefault()
        nodes[0].focus()
      }
    }

    // Capture: the app's own Escape (and the board's) must not also act on the same key press.
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      const at = surfaces.indexOf(id)
      if (at !== -1) surfaces.splice(at, 1)
      // After the surface has gone, so the caret lands on a control that is still there.
      queueMicrotask(() => {
        if (opener && document.contains(opener)) opener.focus()
      })
    }
  }, [ref, open, initial])
}

/**
 * For a panel that is not modal — the card's own side panel, which sits beside the board and lets
 * the board be used. Focus is not trapped there, because trapping it would take the board away.
 * What it does need is the return: when it closes, the caret goes back to the card that opened it,
 * so Escape does not leave a keyboard user at the top of the page.
 */
export function useReturnFocus(): void {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      queueMicrotask(() => {
        if (opener && document.contains(opener)) opener.focus()
      })
    }
  }, [])
}
