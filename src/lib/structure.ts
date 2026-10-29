/**
 * The board design, kept on the server.
 *
 * Items have their own write path — one card, one revision, one patch. The design does not: boards,
 * lanes and placements are one tree, so they are written as one document with one revision, and a
 * design that has moved since the sender read it is refused rather than half-applied.
 *
 * This is the client half. It watches the three lists the design is made of, sends the document a
 * moment after they stop changing, and keeps the revision the server answered. Three rules keep it
 * honest:
 *
 *   - **wait for the items.** A placement points at a card, and a card travels its own way. While
 *     an item write is in flight or its queue is not empty, the design waits, so the server is never
 *     asked to place a card it has not met. The server skips such a placement rather than refusing
 *     the design; waiting is how a skip stays rare — and how an item never ends up on no board.
 *   - **one write at a time.** A second design sent before the first answers would be based on a
 *     revision the first is about to replace. The signature is taken when the write is sent, so the
 *     next change is noticed after the answer, not beside it.
 *   - **a refusal is not retried blind.** A 409 means somebody else designed the board; the answer
 *     is to read theirs, not to send ours again.
 *
 * With nobody signed in there is no server to keep this on, and with no revision known (the static
 * demo, or before an instance has answered) the hook does nothing: the browser is the workspace.
 */

import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { useAuth } from './auth'
import { useSync } from './sync'
import { useStore } from '@/store'
import { queue } from './queue'

interface StructureState {
  /** The revision of the design as the server last told us. `null` until an instance has answered. */
  rev: number | null
  /** The revision a refusal named, so the screen can say the board moved rather than hiding it. */
  movedTo: number | null
}

export const useStructure = create<StructureState>(() => ({ rev: null, movedTo: null }))

/** The design as a string, for "has this changed since we sent it?" — cheap, and total. */
function designOf(): { boards: unknown[]; lanes: unknown[]; placements: unknown[] } {
  const state = useStore.getState()
  return { boards: state.boards, lanes: state.lanes, placements: state.placements }
}

/**
 * What was last known to be on the server.
 *
 * Held outside React because it is about a conversation with a server, not about a render: adoption
 * sets it to what was just read, a successful write sets it to what was just sent.
 */
let lastSent: string | null = null

/**
 * The design was accepted without everything in it.
 *
 * A placement for a card the server had not met is skipped, and the design that carried it is no
 * longer the truth this browser holds. The flag survives until a write takes the whole design, and
 * the card arriving is what wakes the hook up to try again.
 */
let dirty = false

/** Adoption answers this: the design just read is the one the next write is based on. */
export function noteStructureRev(rev: number | null): void {
  useStructure.setState({ rev, movedTo: null })
  lastSent = rev === null ? null : JSON.stringify(designOf())
  dirty = false
}

async function send(rev: number): Promise<void> {
  try {
    const response = await fetch('/api/workspace/structure', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rev, design: designOf() }),
    })

    if (response.status === 409) {
      // Somebody else designed the board. Their design is the workspace now; the caller re-reads it
      // rather than sending ours over theirs, and the screen says why the board changed under them.
      const body = (await response.json().catch(() => null)) as { rev?: number } | null
      lastSent = null
      dirty = false
      useStructure.setState({ rev: null, movedTo: body?.rev ?? null })
      return
    }
    if (!response.ok) return

    const body = (await response.json()) as { rev: number; skipped?: number }
    useStructure.setState({ rev: body.rev, movedTo: null })
    // A placement the server skipped was one for a card it had not met yet. The design was accepted
    // without it, so what was sent is *not* what this browser holds: the next attempt carries it
    // again, and the card arriving is what makes there be a next attempt.
    dirty = (body.skipped ?? 0) > 0
  } catch {
    // A design that did not reach the server stays in this browser; the next change sends it again.
    dirty = true
  }
}

/**
 * Watch the design and keep it on the server. Mounted once, above the app.
 *
 * The debounce is what turns a drag that moves a card between columns into one write rather than one
 * per frame; the queue check is what keeps a placement behind the card it places.
 */
export function useStructureSync(): void {
  const signedIn = useAuth((s) => Boolean(s.user))
  const boards = useStore((s) => s.boards)
  const lanes = useStore((s) => s.lanes)
  const placements = useStore((s) => s.placements)
  // The card count, because a placement waits for its card: when one lands, the design is due again.
  const cards = useStore((s) => s.items.length)
  const waiting = useSync((s) => s.waiting)
  const pending = useSync((s) => s.pending)
  const retry = useRef(0)

  useEffect(() => {
    const rev = useStructure.getState().rev
    if (!signedIn || rev === null) return
    const signature = JSON.stringify(designOf())
    // The first design after adoption is the one the server already has.
    if (lastSent === null && !dirty) {
      lastSent = signature
      return
    }
    if (signature === lastSent && !dirty) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const attempt = () => {
      if (cancelled) return
      // A card travels its own way; placing one the server has not met would be a skip. `pending`
      // is the write that is in flight right now, `waiting` the one held for a connection.
      if (queue.size() > 0 || useSync.getState().waiting > 0 || useSync.getState().pending > 0) {
        retry.current += 1
        if (retry.current > 40) return
        timer = setTimeout(attempt, 500)
        return
      }
      retry.current = 0
      lastSent = JSON.stringify(designOf())
      dirty = false
      void send(rev)
    }

    timer = setTimeout(attempt, 700)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [signedIn, boards, lanes, placements, cards, waiting, pending])
}
