/**
 * What this browser and the account agree about the workspace.
 *
 * Two directions, and they are not the same question:
 *
 * - **Down**: if the account has a workspace, this is the one to show. It arrives through the file
 *   import's own action, so validation and whitelisting are the same code, and it replaces rather
 *   than merges — a half-merged workspace is worse than either half.
 * - **Up**: if the account has nothing and this browser has boards, the person is offered a copy
 *   once. Offered, never taken: the browser's workspace is the one they have been working in.
 *
 * Neither direction runs over edits that have not been sent. The queue is the record of work
 * accepted here, and adopting a server workspace on top of it would write over exactly that.
 */

import { create } from 'zustand'
import { PERSIST_VERSION, useStore } from '@/store'
import { noteStructureRev } from './structure'
import { useAuth } from './auth'
import { isDemoWorkspace } from './demo'
import { personFor } from './identity'
import { queue } from './queue'

/**
 * What this client can render.
 *
 * Deliberately its own number rather than the server's: this one says what the app understands, the
 * server's says what it produces, and the disagreement between them is the thing worth refusing.
 */
export const WORKSPACE_SCHEMA = 1

interface WorkspaceSync {
  /** Whether the offer to copy this workspace up is on screen. */
  offer: boolean
  busy: boolean
  error?: string
}

export const useWorkspaceSync = create<WorkspaceSync>(() => ({ offer: false, busy: false }))

const ASKED = 'kanbantoolkit-import-asked:'

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

export type AccountLoad = 'adopted' | 'offered' | 'held' | 'empty' | 'mismatch' | 'gone' | 'failed'

/**
 * Settle what this browser should be showing, given the account.
 *
 * Returns what it decided, so a caller — and a test — can see the choice rather than infer it from
 * the screen.
 */
export async function reflectAccount(userId: string): Promise<AccountLoad> {
  if (queue.size() > 0) return 'held'

  let body: Record<string, unknown>
  try {
    const response = await fetch('/api/workspace', { headers: { accept: 'application/json' } })
    if (response.status === 404) {
      // The account is not in this instance's workspace: the workspace was deleted, or this person
      // was removed from it. There is no second one to join by asking — an administrator invites
      // somebody in — so the notice says where they stand and nothing more.
      useWorkspaceSync.setState({
        offer: false,
        error: 'This account is not in this instance’s workspace — it was removed, or the workspace was deleted. What you see is this browser’s own copy.',
      })
      return 'gone'
    }
    if (!response.ok) return 'failed'
    body = (await response.json()) as Record<string, unknown>
  } catch {
    return 'failed'
  }

  if (body.schema !== WORKSPACE_SCHEMA) {
    useWorkspaceSync.setState({
      offer: false,
      error: 'This account’s workspace is a shape this version of the app cannot read.',
    })
    return 'mismatch'
  }

  const rev = typeof body.structureRev === 'number' ? body.structureRev : null
  const boards = Array.isArray(body.boards) ? body.boards : []
  if (boards.length === 0) {
    // An account whose workspace is empty is a workspace with nothing in it — a fresh instance — and
    // that is what it shows. The one exception is a browser that holds a *real* workspace from
    // before the account existed: that one is offered a copy rather than replaced by emptiness.
    const local = useStore.getState()
    const localDemo = isDemoWorkspace({ boards: local.boards, lanes: local.lanes, items: local.items, placements: local.placements })
    if (local.boards.length > 0 && !localDemo && !asked(userId)) {
      useWorkspaceSync.setState({ offer: true, error: undefined })
      noteStructureRev(rev)
      return 'offered'
    }
    // The account's workspace is empty, and empty is what it shows — its people included, because
    // the roster is where an assignee and an author point.
    useStore.getState().importWorkspace({ ...body }, PERSIST_VERSION, { allowEmpty: true })
    const account = useAuth.getState().user
    useStore.getState().setUser(personFor(account, useStore.getState().users)?.id)
    noteStructureRev(rev)
    useWorkspaceSync.setState({ offer: false, error: undefined })
    return 'empty'
  }

  // The account's workspace is the one to show. `schema` and `meUserId` are the server's, not the
  // workspace's: the browser decides who its person is, and the import's whitelist is what decides
  // which keys the store may take.
  const { schema: _schema, meUserId: _me, structureRev: _rev, ...slice } = body
  useStore.getState().importWorkspace(slice, PERSIST_VERSION)

  // One rule for which person an account is here — the same one "My work" and the author of a
  // change read, so the three cannot disagree about who just adopted this workspace.
  const account = useAuth.getState().user
  useStore.getState().setUser(personFor(account, useStore.getState().users)?.id)

  // The design just read is the one the next design write is based on.
  noteStructureRev(rev)
  useWorkspaceSync.setState({ offer: false, error: undefined })
  return 'adopted'
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
          ? 'This workspace already has boards to import into.'
          : response.status === 403
            ? 'You are not a member of this workspace.'
            : 'The workspace could not be copied.'
      useWorkspaceSync.setState({ busy: false, error: message })
      return false
    }

    const answer = (await response.json().catch(() => null)) as { structureRev?: number } | null
    // The copy created the design, so its revision is where this browser's next design write starts.
    if (typeof answer?.structureRev === 'number') noteStructureRev(answer.structureRev)
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
