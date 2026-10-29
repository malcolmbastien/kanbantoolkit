import { useRef, useState } from 'react'
import { Database, Download, Upload } from 'lucide-react'
import { useMay } from '@/lib/permissions'
import { readWorkspaceFile } from '@/domain/workspace'
import { downloadWorkspace } from '@/lib/exportWorkspace'
import { formatBytes, requestPersistence, useStorageStatus } from '@/lib/storage'
import { PERSIST_VERSION, useStore } from '@/store'

/**
 * The workspace as a file, and what the browser promises to keep.
 *
 * It lives in Admin because it is about the workspace itself rather than about its work: an
 * export is a copy of everything, an import replaces everything, and the storage figures are the
 * browser's answer about whether either is safe. The board workspace is for browsing boards.
 *
 * An import is not a merge: the file carries the whole workspace, so the confirmation says that
 * before anything is replaced.
 */
export function WorkspaceDataPanel() {
  const importWorkspace = useStore((s) => s.importWorkspace)
  const askConfirm = useStore((s) => s.askConfirm)
  const may = useMay()
  const canImport = may('workspace.import')
  const storageUsage = useStorageStatus((s) => s.usage)
  const storageQuota = useStorageStatus((s) => s.quota)
  const storagePersisted = useStorageStatus((s) => s.persisted)
  const [importError, setImportError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const onImportFile = async (file: File | undefined) => {
    if (!file) return
    let json: unknown
    try {
      json = JSON.parse(await file.text())
    } catch {
      setImportError('That file is not valid JSON.')
      return
    }
    const read = readWorkspaceFile(json, PERSIST_VERSION)
    if (!read.ok || !read.state) {
      setImportError(read.error ?? 'That file is not a Kanban Toolkit workspace.')
      return
    }
    setImportError(null)
    const boards = read.state.boards as { name: string; archived?: boolean }[]
    const items = (read.state.items as unknown[]).length
    askConfirm({
      title: `Import “${file.name}”?`,
      body: `It replaces this workspace: ${boards.length} board${boards.length === 1 ? '' : 's'}, ${items} work item${items === 1 ? '' : 's'}. The current workspace is overwritten — export first if you want to keep it.`,
      confirmLabel: 'Import',
      danger: true,
      onConfirm: () => importWorkspace(read.state!, read.version!),
    })
  }

  return (
    <section data-workspace-data className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-body font-semibold text-slate-900">
            <Database size={14} className="text-slate-500" /> Workspace data
          </h2>
          <p className="mt-0.5 text-meta text-slate-600">
            Export downloads every board, card and initiative as a JSON file; importing one replaces this
            workspace with what the file carries.
          </p>
          {/* What the browser says about the space, and whether it has promised to keep it.
              A browser that will not promise may evict the workspace after a quiet week. */}
          <p data-storage-figures className="mt-1 text-micro text-slate-600">
            Storage: <span className="tabular-nums">{formatBytes(storageUsage)}</span> used
            {storageQuota !== null && <> of {formatBytes(storageQuota)}</>}
            {' · '}
            {storagePersisted === true
              ? 'the browser will keep it'
              : storagePersisted === false
                ? 'the browser may evict it'
                : 'persistence not yet requested'}
            {storagePersisted === false && (
              <button
                onClick={() => void requestPersistence(true)}
                className="ml-1.5 rounded border border-slate-300 px-1.5 py-0.5 font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
                title="Ask the browser to keep this workspace instead of evicting it under pressure"
              >
                Ask the browser to keep it
              </button>
            )}
          </p>
          {importError && <p className="mt-1 text-meta font-medium text-rose-600">{importError}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => downloadWorkspace()}
            className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-meta font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
            title="Download the whole workspace as JSON"
          >
            <Download size={13} /> Export
          </button>
          {canImport && (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-meta font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
                title="Import a workspace file — replaces everything here"
              >
                <Upload size={13} /> Import…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  void onImportFile(e.target.files?.[0])
                  // Reading the same file again must fire again.
                  e.target.value = ''
                }}
              />
            </>
          )}
        </div>
      </div>
    </section>
  )
}
