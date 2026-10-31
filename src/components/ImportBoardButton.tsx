import { lazy, Suspense, useState } from 'react'
import { FileUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The way into the import dialog, from either place a person starts: the board workspace or the
 * workspace data panel. The dialog is a lazy chunk — a board that never imports one does not carry
 * the parser or the mapping screen in its first download.
 */
const ImportBoardDialog = lazy(() => import('./ImportBoardDialog').then((module) => ({ default: module.ImportBoardDialog })))

export function ImportBoardButton({ className, label = 'Import board…' }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-meta font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700',
          className,
        )}
        title="Bring a Trello board or a Jira CSV in as one board"
      >
        <FileUp size={13} /> {label}
      </button>
      {open && (
        <Suspense fallback={null}>
          <ImportBoardDialog onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
