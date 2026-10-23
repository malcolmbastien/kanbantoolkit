/**
 * The one moment a workspace can move onto the server: the first time somebody signs in here.
 *
 * Offered, never taken. The browser's workspace is the thing a person has been working in, so a
 * failed import leaves it exactly where it was, and declining is remembered per account rather than
 * asked again on every reload.
 *
 * The server refuses an import into a workspace that already has a board, which is the same
 * question this asks before it offers: two half-workspaces are not a merge, and R3 says the account
 * gets the one the person was working in.
 */

import { create } from 'zustand'

interface WorkspaceSync {
  /** Whether the offer is on screen. */
  offer: boolean
  busy: boolean
  error?: string
}

export const useWorkspaceSync = create<WorkspaceSync>(() => ({ offer: false, busy: false }))

const ASKED = 'flowline-import-asked:'

function asked(userId: string): boolean {
  try {
    return localStorage.getItem(ASKED + userId) === '1'
  } catch {
    return false
  }
}

function remember(userId: string): void {
  try {
    localStorage.setItem(ASKED + userId, '1')
  } catch {
    // A full disk only means the question is asked again.
  }
}

/** Ask the server whether this account already has a workspace, and offer if it does not. */
export async function considerImport(userId: string, localBoards: number): Promise<void> {
  if (localBoards === 0 || asked(userId)) return

  try {
    const response = await fetch('/api/workspace', { headers: { accept: 'application/json' } })
    if (!response.ok) return
    const body = (await response.json()) as { boards?: unknown[] }
    if ((body.boards ?? []).length === 0) useWorkspaceSync.setState({ offer: true })
  } catch {
    // An instance with no server has nothing to offer.
  }
}

/** Copy the browser's workspace to the account. `false` means it stayed where it was. */
export async function copyToAccount(userId: string, workspace: Record<string, unknown>): Promise<boolean> {
  useWorkspaceSync.setState({ busy: true, error: undefined })

  try {
    const response = await fetch('/api/workspace/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(workspace),
    })

    if (!response.ok) {
      const message =
        response.status === 409
          ? 'This account already has a workspace.'
          : response.status === 403
            ? 'You are not a member of this workspace.'
            : 'The workspace could not be copied.'
      useWorkspaceSync.setState({ busy: false, error: message })
      return false
    }

    remember(userId)
    useWorkspaceSync.setState({ busy: false, offer: false })
    return true
  } catch {
    useWorkspaceSync.setState({ busy: false, error: 'The server could not be reached.' })
    return false
  }
}

/** Not now. Asked once, per account. */
export function declineImport(userId: string): void {
  remember(userId)
  useWorkspaceSync.setState({ offer: false })
}
