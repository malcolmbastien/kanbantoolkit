/**
 * The one way to ask the shortcut sheet to open.
 *
 * The sheet is mounted once by `Overlays`, which is the app's single host for floating surfaces.
 * A caller that has no prop path to it — the command palette is a separate lazy chunk — asks by
 * event rather than by importing the component, so opening the palette does not also download the
 * sheet and the palette does not need a prop threaded through `App`.
 */
export const SHORTCUTS_EVENT = 'kanbantoolkit:shortcuts'

export function openShortcuts(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SHORTCUTS_EVENT))
}
