import { useEffect, useState } from 'react'
import { subscribeAnnouncements } from '@/lib/announce'

/**
 * The app's one speaking voice: a polite live region that stays empty until something happens.
 *
 * Polite, not assertive, because everything announced here is an answer to something the person
 * just did — it can wait for the end of the sentence being read. The node is keyed by a counter so
 * the same sentence twice is two changes to the region rather than one unchanged string, which is
 * how a second refusal of the same drop gets said.
 */
export function Announcer() {
  const [said, setSaid] = useState<{ text: string; n: number } | null>(null)

  useEffect(
    () => subscribeAnnouncements((text) => setSaid((current) => ({ text, n: (current?.n ?? 0) + 1 }))),
    [],
  )

  return (
    <div role="status" aria-live="polite" aria-atomic="true" data-announcer className="sr-only">
      {said && <span key={said.n}>{said.text}</span>}
    </div>
  )
}
