import { useEffect, useRef, useState } from 'react'
import { LayoutTemplate, Target, X } from 'lucide-react'
import { BAND_STYLES, BOARD_BANDS } from './BandBadge'
import { cn } from '@/lib/utils'
import { useDialogFocus } from '@/lib/useDialogFocus'
import type { BoardBand, BoardTemplate } from '@/domain/types'

/**
 * What each board type means, in the words a person choosing one needs: the longer answer to
 * "which one am I making?". It belongs where the choice is made, because the type decides what
 * the board's surface renders and where the work rolls up.
 */
const BAND_DETAIL: Record<BoardBand, { tagline: string; body: string; useFor: string }> = {
  team: {
    tagline: 'The working board',
    body: 'Columns, cards and WIP limits, plus the initiatives the cards roll up to.',
    useFor: 'A squad delivering work.',
  },
  program: {
    tagline: 'Coordination across teams',
    body: 'A band per linked team, rolled up from their own boards. No cards here.',
    useFor: 'A programme or value stream.',
  },
  portfolio: {
    tagline: 'Strategy and investment',
    body: 'Objectives, the initiatives that serve them, and the coverage gaps. No cards or bands.',
    useFor: 'Leadership steering a portfolio.',
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
  template,
  onCreate,
  onBrowseTemplates,
  onClose,
}: {
  /** The design this board starts from, when the person came here through a template. */
  template?: BoardTemplate
  onCreate: (name: string, band: BoardBand) => void
  /** Offered when the person has not chosen a template: the way to that choice is its own act. */
  onBrowseTemplates?: () => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [band, setBand] = useState<BoardBand>(template?.band ?? 'team')

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
    // A template carries the board's type with it: the design knows whether it is a team board,
    // and there is no second choice to disagree with the columns already chosen.
    onCreate(trimmed, template?.band ?? band)
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
              {template ? 'New board from template' : 'New board'}
            </h2>
            <p className="mt-1 text-meta leading-relaxed text-slate-600">
              {template
                ? `Starts from “${template.name}”: its flows, columns, and WIP policy come across.`
                : 'Change it later in Board settings.'}
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

          {template ? (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className={cn('rounded px-1.5 py-px text-micro font-bold uppercase tracking-wide', (BAND_STYLES[template.band] ?? BAND_STYLES.team).chip)}>
                  {(BAND_STYLES[template.band] ?? BAND_STYLES.team).label}
                </span>
                <span className="text-meta font-semibold text-slate-800">{template.name}</span>
                <span className="ml-auto text-micro text-slate-600">
                  {template.flows.length} flow{template.flows.length === 1 ? '' : 's'} · {template.lanes.length} lanes
                </span>
              </div>
              <p className="mt-1 text-meta text-slate-600">{template.flows.map((flow) => flow.name).join(' · ')}</p>
              {onBrowseTemplates && (
                <button
                  type="button"
                  onClick={onBrowseTemplates}
                  className="mt-1 text-micro font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-800"
                >
                  Choose a different template
                </button>
              )}
            </div>
          ) : (
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
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          {!template && onBrowseTemplates && (
            <button
              type="button"
              onClick={onBrowseTemplates}
              className="mr-auto flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-meta font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700"
              title="Browse the board designs and create from one"
            >
              <LayoutTemplate size={13} aria-hidden /> Start from a template…
            </button>
          )}
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
