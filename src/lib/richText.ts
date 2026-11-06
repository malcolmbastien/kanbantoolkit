/**
 * The bridge between the rich description editor and the markdown the description stores.
 *
 * `renderMarkdown` turns the stored markdown into the HTML the editor shows; this turns the HTML
 * the editor produced back into markdown, so the data model, search, history and export never learn
 * that the panel became a rich editor. It covers the subset the toolbar and `renderMarkdown` share,
 * which is also the subset contenteditable can produce with `execCommand`.
 */

const BLOCK = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE'])

const text = (node: Node): string => (node.textContent ?? '').replace(/\u00a0/g, ' ')

/** One inline run: the text with the markers its elements stood for. */
function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return text(node)
  if (!(node instanceof HTMLElement)) return ''

  const inner = [...node.childNodes].map(inline).join('')
  switch (node.tagName) {
    case 'BR':
      return '\n'
    case 'STRONG':
    case 'B':
      return inner.trim() ? `**${inner}**` : inner
    case 'EM':
    case 'I':
      return inner.trim() ? `*${inner}*` : inner
    case 'CODE': {
      // Code is literal: emphasis inside it is text, not a mark. A fence already says "code".
      const body = text(node).replace(/\s*\n\s*/g, ' ').trim()
      return node.closest('pre') || !body ? body : `\`${body}\``
    }
    case 'A': {
      const href = node.getAttribute('href')?.trim()
      return href && inner.trim() ? `[${inner}](${href})` : inner
    }
    default:
      return inner
  }
}

/** One list, with its children indented — a nested list is a list, not part of the line above it. */
function list(element: HTMLElement, depth = 0): string {
  const ordered = element.tagName === 'OL'
  const lines: string[] = []
  let index = 1

  for (const child of element.children) {
    if (!(child instanceof HTMLLIElement)) continue
    const nested = [...child.children].filter((node) => node.tagName === 'UL' || node.tagName === 'OL')

    // Text and inline marks only: the nested lists are appended at their own depth, not folded
    // into the line that contains them.
    const clone = child.cloneNode(true) as HTMLLIElement
    for (const node of clone.querySelectorAll(':scope > ul, :scope > ol')) node.remove()
    const body = inline(clone).trim()
    // An item with nothing in it, and nothing under it, is the browser's empty line after a
    // select-all delete — not a bullet with no words. Dropping it lets the editor reset cleanly.
    if (body || nested.length) {
      lines.push(`${'  '.repeat(depth)}${ordered ? `${index}.` : '-'}${body ? ` ${body}` : ''}`)
      for (const node of nested) lines.push(list(node as HTMLElement, depth + 1))
    }
    index += 1
  }

  return lines.join('\n')
}

/** One block element, as the markdown block it stands for. */
function block(node: Node): string | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = text(node).trim()
    return value || null
  }
  if (!(node instanceof HTMLElement)) return null

  switch (node.tagName) {
    case 'UL':
    case 'OL':
      return list(node) || null
    case 'PRE': {
      const code = text(node).replace(/\n$/, '')
      return code.trim() ? `\`\`\`\n${code}\n\`\`\`` : null
    }
    case 'BLOCKQUOTE': {
      const inner = [...node.childNodes]
        .map(block)
        .filter((part): part is string => Boolean(part?.trim()))
        .join('\n\n')
      return inner
        ? inner
            .split('\n')
            .map((line) => (line ? `> ${line}` : '>'))
            .join('\n')
        : null
    }
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      // Some browser edits (a list applied across blocks) can leave a block inside a heading.
      // Lift it out rather than flattening its list items into one heading line.
      if ([...node.children].some((child) => BLOCK.has(child.tagName))) {
        const parts = [...node.childNodes]
          .map(block)
          .filter((part): part is string => Boolean(part?.trim()))
        return parts.length ? parts.join('\n\n') : null
      }
      // A heading is one line even when the selection spanned two paragraphs: its breaks become
      // spaces, so the markdown that reloads is still a heading.
      const body = inline(node).replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim()
      return body ? `${'#'.repeat(Number(node.tagName[1]))} ${body}` : null
    }
    case 'P':
    case 'DIV': {
      // contenteditable nests a block when a list or heading is inserted inside a line; each
      // child is its own block then, rather than one paragraph with the list's words in it.
      if ([...node.children].some((child) => BLOCK.has(child.tagName))) {
        const parts = [...node.childNodes]
          .map(block)
          .filter((part): part is string => Boolean(part?.trim()))
        return parts.length ? parts.join('\n\n') : null
      }
      const body = inline(node).trim()
      return body || null
    }
    default: {
      const body = inline(node).trim()
      return body || null
    }
  }
}

/**
 * The editor's DOM as the markdown a description stores.
 *
 * Blocks are separated by a blank line, inline marks by their markdown spelling. Empty blocks —
 * the `<div><br></div>` a browser leaves behind after Backspace — disappear rather than becoming
 * blank paragraphs, so clearing the editor really clears the description.
 */
export function htmlToMarkdown(root: HTMLElement): string {
  return [...root.childNodes]
    .map(block)
    .filter((part): part is string => Boolean(part?.trim()))
    .join('\n\n')
    .trim()
}

/** The URL a link may point at: the web and mail, never a script scheme. */
export function safeMarkdownUrl(value: string): string | undefined {
  const raw = value.trim()
  if (!raw) return undefined
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}
