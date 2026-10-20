import { PERSIST_VERSION, persistedSlice, useStore } from '@/store'
import { downloadText } from './download'

/**
 * The workspace as a file: exactly what the app persists, with the shape it was written in.
 *
 * One function, because two callers need it — the workspace panel, and the banner that offers a
 * copy when the browser has stopped saving.
 */
export function workspaceBackup() {
  return {
    app: 'flowline',
    exportedAt: new Date().toISOString(),
    version: PERSIST_VERSION,
    state: persistedSlice(useStore.getState()),
  }
}

export function downloadWorkspace(): void {
  const backup = workspaceBackup()
  downloadText(
    `flowline-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(backup, null, 2),
    'application/json',
  )
}
