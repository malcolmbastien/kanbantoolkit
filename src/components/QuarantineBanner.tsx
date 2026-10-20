import { AlertTriangle, Download, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { downloadText } from '@/lib/download'
import { forgetKeptWorkspace, keptWorkspace, keptWorkspaceFile, type KeptWorkspace } from '@/lib/quarantine'
import { PERSIST_VERSION, useStore } from '@/store'

/**
 * The most serious sentence the app can say: the workspace it was handed could not be read.
 *
 * It says what was found and what this build reads, because those two numbers are the whole
 * explanation. The copy is kept untouched and offered as a download; the workspace on screen is a
 * new one, and saying so is the difference between a fresh start and a silent replacement.
 */
export function QuarantineBanner() {
  const [kept, setKept] = useState<KeptWorkspace | null>(() => keptWorkspace())
  const askConfirm = useStore((s) => s.askConfirm)
  if (!kept) return null
  const written = kept.found === null ? 'a shape this build does not recognise' : `version ${kept.found}`

  return (
    <div
      data-quarantine-banner
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-meta text-amber-900"
    >
      <AlertTriangle size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">This browser&apos;s workspace could not be read.</strong> It was
        written by {written}, and this build reads up to version {PERSIST_VERSION}. It has been kept,
        untouched — the workspace on screen is a new one, and the download is the copy that was here.
      </span>
      <button
        onClick={() => {
          const file = keptWorkspaceFile(kept)
          downloadText(file.filename, file.text, 'application/json')
        }}
        className="flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900 transition hover:border-amber-400 hover:bg-amber-100"
        title="Download the workspace that could not be read, as a workspace file"
      >
        <Download size={13} /> Download the kept copy
      </button>
      <button
        onClick={() =>
          askConfirm({
            title: 'Delete the kept copy?',
            body: 'It is the only copy of the workspace that could not be read. Download it first unless you are sure.',
            confirmLabel: 'Delete',
            danger: true,
            onConfirm: () => {
              forgetKeptWorkspace(kept.key)
              setKept(keptWorkspace())
            },
          })
        }
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium text-amber-900/80 transition hover:bg-amber-100 hover:text-amber-900"
        title="Delete the copy this browser kept"
      >
        <Trash2 size={13} /> Delete
      </button>
    </div>
  )
}
