/**
 * An external link on a card: where the work lives somewhere else.
 *
 * A card can name a ticket, a design, a contract or a page — a label the team chose and the address
 * it points at. The link is a **reference, not a relationship**: nothing about it affects status,
 * rollup, WIP or a dependency, the app never fetches the address, and the other system cannot push
 * anything back through it.
 *
 * Two rules live here because both the store and the server need them: what an address may be, and
 * what the chip says when the team gave no label.
 */

import type { Item } from './types'

/**
 * The schemes a link may use. `http` and `https` are the web; anything else — `javascript:`,
 * `data:`, a `file:` path, or a bare string a browser would resolve against this page — is refused,
 * because a card is a thing one person writes and another person presses.
 */
const SAFE = /^https?:\/\//i

/** Whether a string is an address a card may carry. A trimmed copy is returned, or nothing. */
export function safeExternalUrl(value: string | undefined): string | undefined {
  const url = value?.trim()
  if (!url || !SAFE.test(url)) return undefined
  try {
    const parsed = new URL(url)
    // The regex already accepted the scheme; this catches what `new URL` will not parse at all.
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

/** Whether an item carries a usable link. A stored value that is not safe is not a link. */
export function hasExternalLink(item: Pick<Item, 'externalUrl'>): boolean {
  return safeExternalUrl(item.externalUrl) !== undefined
}

/**
 * What the chip says: the label the team wrote, or the site the address points at.
 *
 * A bare address is not a chip — it is a sentence that reflows — so a link with no label reads as
 * the host it goes to (`jira.example.com`), which is what a reader wanted to know anyway.
 */
export function externalLabelOf(item: Pick<Item, 'externalLabel' | 'externalUrl'>): string | undefined {
  const url = safeExternalUrl(item.externalUrl)
  if (!url) return undefined
  return item.externalLabel?.trim() || new URL(url).host
}
