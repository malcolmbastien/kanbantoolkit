import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bold, Code, Heading2, Italic, Link2, List, ListOrdered, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { renderMarkdown } from '@/lib/markdown'
import { htmlToMarkdown, safeMarkdownUrl } from '@/lib/richText'

/**
 * The card description as one rich surface.
 *
 * A person writes where they read: the editor is the rendered description, not a textarea with a
 * preview somewhere else. The toolbar formats the selection in place, and the DOM is turned back
 * into markdown on every change — so the field's stored value, search, history and export stay
 * plain markdown while the thing on screen is the description itself.
 *
 * The editor is uncontrolled while it has focus. Rewriting its `innerHTML` on each keystroke would
 * move the caret; it is only re-rendered when the value changes from outside (another card, a sync)
 * and the editor is not the active element.
 */
export function DescriptionEditor({
  value,
  onChange,
  onFocus,
  onBlur,
  locked,
}: {
  value: string
  onChange: (markdown: string) => void
  onFocus: () => void
  onBlur: () => void
  locked: boolean
}) {
  const editor = useRef<HTMLDivElement>(null)
  const linkInput = useRef<HTMLInputElement>(null)
  const lastEmitted = useRef<string | null>(null)
  const savedRange = useRef<Range | null>(null)
  // The selection survives a tab to the toolbar (and into the link field), so a keyboard reader
  // can choose a format after selecting words, exactly as a pointer reader can.
  const selectionRange = useRef<Range | null>(null)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState({ bold: false, italic: false, ul: false, ol: false, heading: false })
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState<string | undefined>(undefined)

  /** The editor's DOM, as the markdown the card stores. */
  const sync = () => {
    const element = editor.current
    if (!element) return
    const markdown = htmlToMarkdown(element)
    // Select-all then Backspace inside a list leaves an empty list item, and a heading leaves an
    // empty heading. Clear the block furniture too, so the next word is a paragraph again rather
    // than a list item the Heading command cannot reach.
    if (markdown === '' && element.querySelector('ul, ol, h1, h2, h3, h4, h5, h6, blockquote, pre')) {
      element.innerHTML = '<div><br></div>'
      if (document.activeElement === element) {
        const range = document.createRange()
        range.selectNodeContents(element)
        range.collapse(true)
        const selection = document.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
    }
    if (markdown === lastEmitted.current) return
    lastEmitted.current = markdown
    onChange(markdown)
  }

  // The saved description is rendered once, before paint. After that React must not touch the
  // editor's `innerHTML`: the browser's editing, selection and undo are the source of truth while
  // it has focus. A change from outside (another card, a remote edit) replaces the document only
  // when the editor is not the active element.
  useLayoutEffect(() => {
    const element = editor.current
    if (!element) return
    if (focused) return
    if (htmlToMarkdown(element) === value) {
      lastEmitted.current = value
      return
    }
    element.innerHTML = value ? renderMarkdown(value) : ''
    lastEmitted.current = value
  }, [value, focused])

  // The toolbar's pressed state follows the selection, the way a word processor's does.
  useEffect(() => {
    const refresh = () => {
      const element = editor.current
      const selection = document.getSelection()
      if (!element || !selection?.anchorNode || !element.contains(selection.anchorNode)) return
      if (selection.rangeCount > 0) selectionRange.current = selection.getRangeAt(0).cloneRange()
      const format = String(document.queryCommandValue('formatBlock')).replace(/[<>]/g, '').toLowerCase()
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
        heading: format === 'h2',
      })
    }
    document.addEventListener('selectionchange', refresh)
    return () => document.removeEventListener('selectionchange', refresh)
  }, [])

  useEffect(() => {
    if (linkOpen) linkInput.current?.focus()
  }, [linkOpen])

  /** Put the caret/selection back in the editor before a command acts on it. */
  const restoreSelection = () => {
    const element = editor.current
    if (!element) return
    element.focus()
    if (!selectionRange.current) return
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(selectionRange.current)
  }

  /**
   * A block cannot stand inside a heading or a paragraph. `execCommand` will sometimes produce
   * `<h2><ul>…</ul></h2>` when a list is applied across blocks; lift the list out so the document
   * the editor shows is one markdown can describe.
   */
  const normalizeBlocks = () => {
    const element = editor.current
    if (!element) return
    for (const block of element.querySelectorAll('h1, h2, h3, h4, h5, h6, p')) {
      const nested = [...block.children].filter((child) =>
        /^(UL|OL|PRE|BLOCKQUOTE|H[1-6])$/.test(child.tagName),
      )
      if (!nested.length) continue
      for (const child of nested) block.parentElement?.insertBefore(child, block.nextSibling)
      if (!block.textContent?.trim()) block.remove()
    }
  }

  const run = (command: string, argument?: string) => {
    restoreSelection()
    document.execCommand(command, false, argument)
    normalizeBlocks()
    sync()
  }

  const toggleHeading = () => {
    restoreSelection()
    const format = String(document.queryCommandValue('formatBlock')).replace(/[<>]/g, '').toLowerCase()
    run('formatBlock', format === 'h2' ? 'p' : 'h2')
  }

  /** Inline code has no `execCommand`; wrap or unwrap the selection itself. */
  const toggleCode = () => {
    const element = editor.current
    restoreSelection()
    const selection = document.getSelection()
    if (!element || !selection?.rangeCount) return
    const range = selection.getRangeAt(0)

    let node: Node | null = range.commonAncestorContainer
    let code: HTMLElement | null = null
    while (node && node !== element) {
      if (node instanceof HTMLElement && node.tagName === 'CODE' && node.parentElement?.tagName !== 'PRE') {
        code = node
        break
      }
      node = node.parentNode
    }

    if (code) {
      const parent = code.parentNode
      if (parent) {
        while (code.firstChild) parent.insertBefore(code.firstChild, code)
        parent.removeChild(code)
      }
    } else {
      if (range.collapsed) return
      const wrapper = document.createElement('code')
      wrapper.appendChild(range.extractContents())
      range.insertNode(wrapper)
      const after = document.createRange()
      after.selectNodeContents(wrapper)
      selection.removeAllRanges()
      selection.addRange(after)
    }
    sync()
  }

  const openLink = () => {
    const selection = document.getSelection()
    savedRange.current =
      selectionRange.current ?? (selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null)
    setLinkUrl('')
    setLinkError(undefined)
    setLinkOpen(true)
  }

  const cancelLink = () => {
    setLinkOpen(false)
    setLinkUrl('')
    setLinkError(undefined)
    editor.current?.focus()
  }

  const applyLink = () => {
    const href = safeMarkdownUrl(linkUrl)
    if (!href) {
      setLinkError('Enter an https, http or mailto address.')
      return
    }
    const element = editor.current
    if (!element) return
    // Returning to the editor starts (or continues) the edit the parent records on blur; the link
    // button itself never takes focus away from the selection.
    element.focus()
    const selection = document.getSelection()
    if (savedRange.current) {
      selection?.removeAllRanges()
      selection?.addRange(savedRange.current)
      if (savedRange.current.collapsed) {
        const label = href.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        document.execCommand('insertHTML', false, `<a href="${label.replace(/"/g, '&quot;')}">${label}</a>`)
      } else {
        document.execCommand('createLink', false, href)
      }
    }
    setLinkOpen(false)
    setLinkUrl('')
    setLinkError(undefined)
    sync()
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-white transition',
        locked ? 'border-slate-200' : 'border-slate-200 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-400',
      )}
    >
      {!locked && (
        <div className="flex items-center gap-0.5 border-b border-slate-200 bg-slate-50/80 px-1.5 py-1">
          <Tool label="Bold" pressed={active.bold} onPress={() => run('bold')} disabled={locked}>
            <Bold size={13} />
          </Tool>
          <Tool label="Italic" pressed={active.italic} onPress={() => run('italic')} disabled={locked}>
            <Italic size={13} />
          </Tool>
          <Tool label="Inline code" onPress={toggleCode} disabled={locked}>
            <Code size={13} />
          </Tool>
          <Tool label="Link" onPress={openLink} disabled={locked}>
            <Link2 size={13} />
          </Tool>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-slate-200" />
          <Tool label="Bulleted list" pressed={active.ul} onPress={() => run('insertUnorderedList')} disabled={locked}>
            <List size={13} />
          </Tool>
          <Tool label="Numbered list" pressed={active.ol} onPress={() => run('insertOrderedList')} disabled={locked}>
            <ListOrdered size={13} />
          </Tool>
          <Tool label="Heading" pressed={active.heading} onPress={toggleHeading} disabled={locked}>
            <Heading2 size={13} />
          </Tool>
        </div>
      )}

      {linkOpen && !locked && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            applyLink()
          }}
          className="flex items-center gap-1 border-b border-slate-200 bg-slate-50/80 px-1.5 py-1"
        >
          <input
            ref={linkInput}
            value={linkUrl}
            onChange={(event) => {
              setLinkUrl(event.target.value)
              setLinkError(undefined)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') cancelLink()
            }}
            aria-label="Link address"
            placeholder="https://…"
            className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-micro outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-300"
          />
          <button
            type="submit"
            className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-micro font-medium text-white transition hover:bg-slate-900"
          >
            Add
          </button>
          <button
            type="button"
            onClick={cancelLink}
            aria-label="Cancel link"
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
          >
            <X size={12} />
          </button>
        </form>
      )}
      {linkError && !locked && <p className="border-b border-rose-100 bg-rose-50 px-2 py-1 text-micro text-rose-700">{linkError}</p>}

      <div className="relative">
        <div
          ref={editor}
          data-description-editor
          role="textbox"
          aria-label="Description"
          aria-multiline="true"
          aria-readonly={locked}
          contentEditable={!locked}
          suppressContentEditableWarning
          spellCheck
          onFocus={() => {
            setFocused(true)
            onFocus()
          }}
          onBlur={() => {
            setFocused(false)
            onBlur()
          }}
          onInput={sync}
          onPaste={(event) => {
            // A pasted page brings its own styles and scripts-shaped markup; the description holds
            // words and the marks this editor can serialize, so paste them as text.
            event.preventDefault()
            document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
            sync()
          }}
          onKeyDown={(event) => {
            const command = (event.metaKey || event.ctrlKey) && !event.altKey
            if (!command) return
            if (event.key.toLowerCase() === 'b') {
              event.preventDefault()
              run('bold')
            } else if (event.key.toLowerCase() === 'i') {
              event.preventDefault()
              run('italic')
            }
          }}
          className="rich-text min-h-[96px] max-h-72 overflow-auto px-3 py-2.5 text-meta leading-relaxed text-slate-700 outline-none"
        />
        {!locked && value.trim() === '' && (
          <span className="pointer-events-none absolute left-3 top-2.5 text-meta text-slate-500" aria-hidden>
            Add a description…
          </span>
        )}
        {locked && value.trim() === '' && (
          <span className="pointer-events-none absolute left-3 top-2.5 text-meta text-slate-500">No description.</span>
        )}
      </div>
    </div>
  )
}

/** One toolbar control: the press keeps the selection, so the command acts on what was selected. */
function Tool({
  label,
  pressed,
  onPress,
  disabled,
  children,
}: {
  label: string
  pressed?: boolean
  onPress: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onPress}
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded text-slate-600 transition hover:bg-slate-200 hover:text-slate-900 disabled:opacity-40',
        pressed && 'bg-slate-200 text-slate-900',
      )}
    >
      {children}
    </button>
  )
}
