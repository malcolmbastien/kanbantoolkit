import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Code, Heading2, Italic, Link2, List, ListOrdered, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { renderMarkdown } from '@/lib/markdown'
import { htmlToMarkdown, safeMarkdownUrl } from '@/lib/richText'

/**
 * The card description as one rich surface, on TipTap.
 *
 * TipTap brings the editing model — a real document with a selection, undo, and the markdown input
 * rules that turn `# ` into a heading and `- ` into a list as it is typed. The value a card stores
 * is still markdown: the editor is seeded with `renderMarkdown(value)`, and `htmlToMarkdown` turns
 * the editor's HTML back into the same markdown search, history, export and the server read.
 *
 * The extensions are limited to the markdown this app can render again: blockquotes, horizontal
 * rules, strikethrough, underline and hard breaks are off, because they would round-trip into text
 * the rest of the app cannot draw.
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
  const onChangeRef = useRef(onChange)
  const onFocusRef = useRef(onFocus)
  const onBlurRef = useRef(onBlur)
  onChangeRef.current = onChange
  onFocusRef.current = onFocus
  onBlurRef.current = onBlur

  const lastEmitted = useRef(value)
  const [focused, setFocused] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState<string | undefined>(undefined)
  const linkInput = useRef<HTMLInputElement>(null)

  const markdownOf = (ed: { getHTML(): string }) => {
    const container = document.createElement('div')
    container.innerHTML = ed.getHTML()
    return htmlToMarkdown(container)
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        hardBreak: false,
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          validate: (href) => Boolean(safeMarkdownUrl(href)),
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        },
      }),
    ],
    content: renderMarkdown(value),
    editable: !locked,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        'aria-label': 'Description',
        'aria-multiline': 'true',
        'aria-readonly': String(locked),
        role: 'textbox',
        spellcheck: 'true',
        'data-description-editor': '',
        class:
          'rich-text min-h-[96px] max-h-72 overflow-auto px-3 py-2.5 text-meta leading-relaxed text-slate-700 outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      const markdown = markdownOf(editor)
      if (markdown === lastEmitted.current) return
      lastEmitted.current = markdown
      onChangeRef.current(markdown)
    },
    onFocus: () => {
      setFocused(true)
      onFocusRef.current()
    },
    onBlur: () => {
      setFocused(false)
      onBlurRef.current()
    },
  })

  // The toolbar's pressed state follows ProseMirror's selection, the way a word processor's does.
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive('bold') ?? false,
      italic: editor?.isActive('italic') ?? false,
      code: editor?.isActive('code') ?? false,
      ul: editor?.isActive('bulletList') ?? false,
      ol: editor?.isActive('orderedList') ?? false,
      heading: editor?.isActive('heading') ?? false,
    }),
  })

  // A lock can arrive after the panel opened (another tab takes the lease); the surface follows.
  useEffect(() => {
    if (!editor) return
    editor.setEditable(!locked)
    if (locked) setLinkOpen(false)
  }, [editor, locked])

  // An outside change — another card, a remote edit — replaces the document. Never while a person
  // is typing into it: ProseMirror's own selection and undo are the truth then.
  useEffect(() => {
    if (!editor || focused) return
    if (lastEmitted.current === value) return
    editor.commands.setContent(renderMarkdown(value), { emitUpdate: false })
    lastEmitted.current = value
  }, [editor, value, focused])

  useEffect(() => {
    if (linkOpen) linkInput.current?.focus()
  }, [linkOpen])

  const openLink = () => {
    if (!editor) return
    const existing = editor.isActive('link') ? (editor.getAttributes('link').href as string | undefined) : undefined
    setLinkUrl(existing ?? '')
    setLinkError(undefined)
    setLinkOpen(true)
  }

  const cancelLink = () => {
    setLinkOpen(false)
    setLinkUrl('')
    setLinkError(undefined)
    editor?.chain().focus().run()
  }

  const applyLink = () => {
    if (!editor) return
    const href = safeMarkdownUrl(linkUrl)
    if (!href) {
      setLinkError('Enter an https, http or mailto address.')
      return
    }
    if (editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
        .run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    setLinkOpen(false)
    setLinkUrl('')
    setLinkError(undefined)
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
          <Tool label="Bold" pressed={active.bold} onPress={() => editor?.chain().focus().toggleBold().run()}>
            <Bold size={13} />
          </Tool>
          <Tool label="Italic" pressed={active.italic} onPress={() => editor?.chain().focus().toggleItalic().run()}>
            <Italic size={13} />
          </Tool>
          <Tool label="Inline code" pressed={active.code} onPress={() => editor?.chain().focus().toggleCode().run()}>
            <Code size={13} />
          </Tool>
          <Tool label="Link" onPress={openLink}>
            <Link2 size={13} />
          </Tool>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-slate-200" />
          <Tool label="Bulleted list" pressed={active.ul} onPress={() => editor?.chain().focus().toggleBulletList().run()}>
            <List size={13} />
          </Tool>
          <Tool label="Numbered list" pressed={active.ol} onPress={() => editor?.chain().focus().toggleOrderedList().run()}>
            <ListOrdered size={13} />
          </Tool>
          <Tool
            label="Heading"
            pressed={active.heading}
            onPress={() => {
              if (!editor) return
              if (editor.isActive('heading')) editor.chain().focus().setParagraph().run()
              else editor.chain().focus().setHeading({ level: 2 }).run()
            }}
          >
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
        <EditorContent editor={editor} />
        {!locked && !focused && value.trim() === '' && (
          <span
            data-description-placeholder
            className="pointer-events-none absolute left-3 top-2.5 text-meta text-slate-500"
            aria-hidden
          >
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
