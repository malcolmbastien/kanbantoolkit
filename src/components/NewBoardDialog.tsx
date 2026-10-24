import { useEffect, useRef, useState } from 'react'
import { Target, X } from 'lucide-react'
import { BAND_STYLES, BOARD_BANDS } from './BandBadge'
import { cn } from '@/lib/utils'
import { useDialogFocus } from '@/lib/useDialogFocus'
import type { BoardBand, BoardTemplate } from '@/domain/types'

/**
 * What each flight level means, in the words a person choosing one needs. The short `hint`
 * beside the badge is enough once a board exists; this is the longer answer to "which one am
 * I making?", and it belongs where the choice is made.
 */
const BAND_DETAIL: Record<BoardBand, { tagline: string; body: string; useFor: string }> = {
  team: {
    tagline: 'The working board',
    body: 'The team’s working board: columns, cards and WIP limits, plus the initiatives its cards roll up to.',
    useFor: 'A squad or delivery team doing the work.',
  },
  program: {
    tagline: 'Coordination across teams',
    body: 'A coordination board for a programme or value stream. Linked teams roll their initiatives up here as bands. No cards workflow.',
    useFor: 'A programme or value stream coordinating several teams.',
  },
  portfolio: {
    tagline: 'Strategy and investment',
    body: 'The organisation’s strategy view: objectives with the strategic initiatives that serve them, and coverage gaps. No cards workflow or bands.',
    useFor: 'Leadership steering a portfolio of programmes.',
  },
}

/**
 * The board workspace's New board flow, as a modal rather than a strip under the header.
 *
 * A board type is not a small choice: it decides what the board's surface renders and where the
 * work rolls up. So the three options are laid out as cards with room for what each one is for,
 * instead of a select whose one-line label assumed the reader already knew the vocabulary.
 */
export function NewBoardDialog({
  templates,
  onCreate,
  onClose,
}: {
  templates: BoardTemplate[]
  onCreate: (name: string, band: BoardBand, templateId?: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [band, setBand] = useState<BoardBand>('team')
  const [templateId, setTemplateId] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const create = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate(trimmed, band, templateId || undefined)
  }

  const dialogRef = useRef<HTMLFormElement>(null)
  // A new board starts with its name: the caret belongs there, and Escape gives the caret back.
  useDialogFocus(dialogRef, onClose, true, 'input')

  return (
    <div
      data-new-board-dialog
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-board-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
        className="my-auto w-full max-w-3xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="new-board-title" className="text-title font-semibold text-slate-800">
              New board
            </h2>
            <p className="mt-1 text-meta leading-relaxed text-slate-600">
              A board’s type decides what the board is for and how its work rolls up. You can change it later in Board
              settings.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-meta font-medium text-slate-600">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Board name…"
              aria-label="New board name"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-meta outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </label>

          <fieldset>
            <legend className="text-meta font-medium text-slate-600">Board type</legend>
            <div className="mt-1.5 grid gap-2 md:grid-cols-3">
              {BOARD_BANDS.map((b) => {
                const style = BAND_STYLES[b] ?? BAND_STYLES.team
                const detail = BAND_DETAIL[b]
                const Icon = style.icon
                const selected = band === b
                return (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setBand(b)}
                    className={cn(
                      'flex h-full flex-col rounded-lg border p-2.5 text-left transition',
                      selected
                        ? 'border-indigo-400 bg-indigo-50/60 ring-1 ring-indigo-300'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', style.chip)}>
                        <Icon size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-meta font-semibold text-slate-800">{style.label}</span>
                        <span className="block text-meta text-slate-500">{detail.tagline}</span>
                      </span>
                    </span>

                    <span className="mt-2 block text-body leading-relaxed text-slate-600">{detail.body}</span>

                    <span className="mt-auto flex gap-1 border-t border-slate-200/70 pt-2 text-meta leading-snug text-slate-600">
                      <Target size={12} className="mt-0.5 shrink-0 text-slate-400" />
                      <span>
                        <span className="font-semibold text-slate-700">Use it for:</span> {detail.useFor}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="text-meta font-medium text-slate-600">Starting columns</span>
            <select
              value={templateId}
              onChange={(e) => {
                const id = e.target.value
                setTemplateId(id)
                // A template carries a flight level, so offer it as the default.
                const chosen = templates.find((t) => t.id === id)
                if (chosen) setBand(chosen.band)
              }}
              aria-label="New board template"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-meta outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">Standard columns</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <span className="text-micro text-slate-600">
              {templateId
                ? 'Uses that template’s columns, card types and WIP policy.'
                : 'Starts as the standard Backlog → Done columns; shape it after.'}
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-meta font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-md bg-indigo-600 px-2.5 py-1 text-meta font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40"
          >
            Create board
          </button>
        </div>
      </form>
    </div>
  )
}
