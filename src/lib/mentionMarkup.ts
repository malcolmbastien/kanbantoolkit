import type { User } from '@/domain/types'
import { renderMarkdown } from './markdown'

/** Text that may sit before an `@` without making it an email address. */
const BEFORE = /[\s([{"'`]/
/** Text that ends a name in a sentence. */
const AFTER = /[\s.,!?;:()[\]{}"'`]/

const PILL =
  'rounded-full bg-indigo-50 px-1.5 py-px text-micro font-medium text-indigo-700 ring-1 ring-indigo-200'

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A comment's markdown, with the people it mentions marked as pills in the sentence.
 *
 * The words are what was written (`@Riley Kim`), and the entry records who that was. The pill is
 * therefore a rendering of the sentence, not a second list repeating it — the mention row that
 * used to sit under the comment said the same name twice. The boundary rules are the ones
 * `mentionedIds` uses, so an email address or a name without the `@` is left alone.
 */
export function renderCommentMarkdown(
  markdown: string,
  mentionIds: readonly string[],
  users: readonly User[],
): string {
  const html = renderMarkdown(markdown)
  if (!mentionIds.length || typeof document === 'undefined') return html

  const names = mentionIds
    .map((id) => users.find((user) => user.id === id)?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => b.length - a.length)
  if (!names.length) return html

  const container = document.createElement('div')
  container.innerHTML = html

  const pattern = new RegExp(`@(${names.map(escape).join('|')})`, 'gi')
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)

  for (const node of nodes) {
    // Code is literal: a name in a code span is not a mention rendered by this layer.
    if (node.parentElement?.closest('code, pre')) continue
    const value = node.nodeValue ?? ''
    const fragment = document.createDocumentFragment()
    let last = 0
    let match: RegExpExecArray | null
    pattern.lastIndex = 0
    while ((match = pattern.exec(value))) {
      const at = match.index
      if (at > 0 && !BEFORE.test(value[at - 1])) continue
      const after = value[at + match[0].length]
      if (after !== undefined && !AFTER.test(after)) continue
      fragment.append(value.slice(last, at))
      const pill = document.createElement('span')
      pill.className = PILL
      pill.dataset.mentionPill = ''
      pill.textContent = match[0]
      fragment.append(pill)
      last = at + match[0].length
    }
    if (last === 0) continue
    fragment.append(value.slice(last))
    node.replaceWith(fragment)
  }

  return container.innerHTML
}
