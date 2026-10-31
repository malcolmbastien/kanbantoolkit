import { useRef, type ReactNode } from 'react'
import { Keyboard, X } from 'lucide-react'
import { SHORTCUT_GROUPS, shortcutsIn } from '@/domain/shortcuts'
import { useDialogFocus } from '@/lib/useDialogFocus'

/**
 * The keyboard's own page: every gesture the app listens for, grouped by where it is used.
 *
 * It is a dialog rather than a panel because it is a reference a person opens, reads and closes —
 * the board behind it is not part of the reading. `?` opens it anywhere a person is not typing, and
 * the command palette offers it by name for anyone who does not know the key.
 */
export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Escape, Tab and focus return are the dialog's, not this component's own key handling.
  useDialogFocus(dialogRef, onClose, true, '[data-shortcuts-close]')

  return (
    <div
      className="fixed inset-0 z-[58] grid place-items-center bg-slate-900/50 p-4"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        data-shortcuts-sheet
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <Keyboard size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="shortcuts-title" className="text-body font-semibold text-slate-900">
              Keyboard shortcuts
            </h2>
            <p className="mt-0.5 text-meta text-slate-600">
              Every key path in the app. Press <Key>?</Key> anywhere you are not typing to open this page.
            </p>
          </div>
          <button
            data-shortcuts-close
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            title="Close"
            className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <X size={16} />
          </button>
        </header>

        <div className="grid gap-x-8 gap-y-5 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group} aria-labelledby={`shortcuts-${group.replace(/\s+/g, '-').toLowerCase()}`}>
              <h3
                id={`shortcuts-${group.replace(/\s+/g, '-').toLowerCase()}`}
                className="mb-1 text-micro font-bold uppercase tracking-wide text-slate-500"
              >
                {group}
              </h3>
              <dl className="divide-y divide-slate-100">
                {shortcutsIn(group).map((shortcut) => (
                  <div key={shortcut.id} className="flex items-start justify-between gap-3 py-1.5">
                    <div className="min-w-0">
                      <dt className="text-meta text-slate-800">{shortcut.label}</dt>
                      {shortcut.when && <dd className="text-micro leading-snug text-slate-500">{shortcut.when}</dd>}
                    </div>
                    <dd className="flex shrink-0 items-center gap-1 pt-0.5" aria-label={shortcut.keys.join(' plus ')}>
                      {shortcut.keys.map((key, index) => (
                        <span key={`${shortcut.id}-${index}`} className="flex items-center gap-1">
                          {index > 0 && <span className="text-micro text-slate-400">+</span>}
                          <Key>{key}</Key>
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <footer className="border-t border-slate-200 bg-slate-50 px-5 py-2 text-micro text-slate-600">
          The sheet is a reference, not a mode: the board stays exactly as it was behind it.
        </footer>
      </div>
    </div>
  )
}

/** One key cap. `kbd` is the element for this, not a styled span. */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-micro font-semibold text-slate-700 shadow-sm">
      {children}
    </kbd>
  )
}
