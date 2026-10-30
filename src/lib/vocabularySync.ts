/**
 * The workspace's words, kept on the server.
 *
 * Issue types, board templates, objectives and key results are whole-list edits with no position of
 * their own, so they travel as one document under one revision — beside the board design and
 * deliberately not inside it: a lane moving and a type being renamed are unrelated acts, and one
 * counter would refuse the second for no reason.
 *
 * This is the client half. It watches the five fields the document is made of, sends what they say a
 * moment after they stop changing, and keeps the revision the server answered. Four rules keep it
 * honest:
 *
 *   - **the edit is the write.** Not sign-out, not a save button: a rename typed a letter at a time
 *     is one write 700 ms after the last letter, and a reload in between loses nothing that was not
 *     still being typed.
 *   - **adoption sets the revision.** A browser that has not been told which revision it holds does
 *     not write: the static app has no server, and the demo's words are the browser's own.
 *   - **a refusal is not retried blind.** A 409 means somebody else wrote the words; the answer is
 *     to read theirs — the local edit is dropped, deliberately — not to send ours over theirs.
 *   - **a failed write is not a failed edit.** A refused or unreachable write leaves the local state
 *     true and says why; the next edit sends the whole document again.
 *
 * `savedFilters` and `collapsedLanes` are absent from the document on purpose: a saved filter is one
 * person's way of narrowing a board and a collapsed column is where they left their screen, so they
 * stay in this browser. `autoArchiveDays` travels, because it changes what every person's board does
 * with Done work.
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import type { BoardTemplate, IssueType, KeyResult, Objective } from '@/domain/types'
import { useStore } from '@/store'
import { useAuth } from './auth'
import { reflectAccount } from './workspaceSync'

/** How long the words must stop changing before they are sent, so a typed rename is one write. */
const DEBOUNCE = 700

interface VocabularyState {
  /** The revision of the words as the server last told us. `null` until an instance has answered. */
  rev: number | null
  /** Why the last write did not land — a role, a malformed document, a server that did not answer. */
  error?: string
  /** The list the refusal named, so the edit that caused it can say so where it was made. */
  field?: string
}

export const useVocabulary = create<VocabularyState>(() => ({ rev: null }))

/** The document, and exactly what it carries. */
export interface VocabularyDocument {
  issueTypes: IssueType[]
  boardTemplates: BoardTemplate[]
  objectives: Objective[]
  keyResults: KeyResult[]
  autoArchiveDays?: number
}

/**
 * The document as this browser holds it.
 *
 * The lists are the store's own arrays, so nothing is translated on the way out; the policy is
 * included only when it is set, so "no auto-archive" is absence rather than zero.
 */
export function vocabularyDocument(): VocabularyDocument {
  const state = useStore.getState()
  return {
    issueTypes: state.issueTypes,
    boardTemplates: state.boardTemplates,
    objectives: state.objectives,
    keyResults: state.keyResults,
    // `undefined` is dropped by `JSON.stringify`, so "no policy" is absence rather than zero.
    autoArchiveDays: state.autoArchiveDays,
  }
}

/**
 * What was last known to be on the server.
 *
 * Held outside React because it is about a conversation with a server, not about a render: adoption
 * sets it to what was just read, a successful write to what was just sent. `null` means "nothing is
 * known to be there", which is also how a refusal asks for the next change to try again.
 */
let lastSent: string | null = null

let timer: ReturnType<typeof setTimeout> | undefined

/** Adoption answers this: the words just read are the ones the next write is based on. */
export function noteVocabularyRev(rev: number | null): void {
  useVocabulary.setState({ rev, error: undefined, field: undefined })
  lastSent = rev === null ? null : JSON.stringify(vocabularyDocument())
}

/**
 * Send the document once the edits have settled.
 *
 * The timer is module state rather than an effect's, so a second change replaces the first write
 * instead of racing it: what is sent is the document as it stands when the timer fires.
 */
export function scheduleVocabularyWrite(delay = DEBOUNCE): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    void send()
  }, delay)
}

/** Let a pending write go — what unmounting the watcher does, and what a test starts from. */
export function cancelVocabularyWrite(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
}

async function send(): Promise<void> {
  const rev = useVocabulary.getState().rev
  const user = useAuth.getState().user
  // With nobody signed in there is no server to keep the words on, and with no revision known (the
  // static demo, or before an instance has answered) the browser is the whole workspace.
  if (!user || rev === null) return
  const document = vocabularyDocument()
  const signature = JSON.stringify(document)
  if (signature === lastSent) return

  try {
    const response = await fetch('/api/workspace/vocabulary', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rev, ...document }),
    })

    if (response.status === 409) {
      // Somebody else wrote the words. Theirs are the workspace now: read them, rather than sending
      // ours over theirs. The local edit is dropped here — that is what "a refusal is not retried
      // blind" means — and the screen can say the words moved under it.
      lastSent = null
      useVocabulary.setState({ rev: null, error: 'Somebody else changed the workspace’s words — reading theirs.' })
      await reflectAccount(user.id)
      return
    }

    if (!response.ok) {
      const answer = (await response.json().catch(() => null)) as { error?: string; field?: string } | null
      // A refusal is not a lost edit: the state stays true, and the next change sends it again.
      lastSent = null
      useVocabulary.setState({
        error: answer?.error ?? 'The workspace could not save this.',
        ...(answer?.field ? { field: answer.field } : {}),
      })
      return
    }

    const answer = (await response.json()) as { rev: number }
    useVocabulary.setState({ rev: answer.rev, error: undefined, field: undefined })
    lastSent = signature
    // Something landed while this write was in flight: the words are due again, and the revision is
    // the one just answered.
    if (JSON.stringify(vocabularyDocument()) !== signature) scheduleVocabularyWrite()
  } catch {
    // A write that did not reach the server stays in this browser; the next change sends it again.
    lastSent = null
  }
}

/**
 * Watch the words and keep them on the server. Mounted once, above the app.
 *
 * The five fields are selected one by one rather than the whole store: a card moving does not touch
 * the vocabulary, and sending a document because a card moved would bump a revision for nothing.
 */
export function useVocabularySync(): void {
  const signedIn = useAuth((s) => Boolean(s.user))
  const rev = useVocabulary((s) => s.rev)
  const issueTypes = useStore((s) => s.issueTypes)
  const boardTemplates = useStore((s) => s.boardTemplates)
  const objectives = useStore((s) => s.objectives)
  const keyResults = useStore((s) => s.keyResults)
  const autoArchiveDays = useStore((s) => s.autoArchiveDays)

  useEffect(() => {
    if (!signedIn || rev === null) return
    const signature = JSON.stringify(vocabularyDocument())
    // Adoption already recorded the document it read: nothing has changed since.
    if (signature === lastSent) return
    scheduleVocabularyWrite()
  }, [signedIn, rev, issueTypes, boardTemplates, objectives, keyResults, autoArchiveDays])
}
