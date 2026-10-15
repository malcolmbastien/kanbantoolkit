import { useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  /** Called with the trimmed new value when the edit is committed. */
  onSave: (value: string) => void
  /** Styling for the display (button) state. */
  className?: string
  /** Styling for the input state. */
  inputClassName?: string
  /** Open straight into edit mode (e.g. naming something new). */
  autoEdit?: boolean
  /** Called when editing ends, whether saved or cancelled. */
  onDone?: () => void
  placeholder?: string
  ariaLabel?: string
  title?: string
}

/**
 * Click-to-rename, in place. Enter or a click away commits; Escape reverts.
 * Renders a button in display mode and a focused, selected input in edit mode.
 */
export function InlineEdit({
  value,
  onSave,
  className,
  inputClassName,
  autoEdit,
  onDone,
  placeholder,
  ariaLabel,
  title,
}: Props) {
  const [editing, setEditing] = useState(Boolean(autoEdit))
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = () => {
    const next = draft.trim()
    if (next && next !== value) onSave(next)
    setEditing(false)
    onDone?.()
  }
  const cancel = () => {
    cancelledRef.current = true
    setDraft(value)
    setEditing(false)
    onDone?.()
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
        className={className}
        title={title ?? 'Click to rename'}
        aria-label={ariaLabel}
      >
        {value || <span className="text-slate-600">{placeholder}</span>}
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
      onBlur={() => {
        // Escape already cancelled — don't let the ensuing blur re-commit.
        if (cancelledRef.current) {
          cancelledRef.current = false
          return
        }
        commit()
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={inputClassName}
    />
  )
}
