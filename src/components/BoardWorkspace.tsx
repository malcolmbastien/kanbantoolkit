import { useState } from 'react'
import { Archive, ArchiveRestore, ArrowRight, Columns3, CopyPlus, Eye, LayoutDashboard, LayoutTemplate, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { BAND_STYLES, BOARD_BANDS } from './BandBadge'
import { InlineEdit } from './InlineEdit'
import { TemplateEditor } from './TemplateEditor'
import { boardsByBand } from '@/domain/board'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Board, BoardBand, BoardTemplate } from '@/domain/types'

/**
 * The board workspace: every board in the organisation, grouped by flight level, with a
 * name filter.
 *
 * Each board appears **exactly once** — the aggregation graph is a DAG, so nesting a
 * board under one of its parents would either duplicate it or pick a parent and lie.
 *
 * Browsing is the point; opening a board leaves the workspace. Board admin also stays
 * inside each board: this is another way in, not the only one.
 */
export function BoardWorkspace() {
  const boards = useStore((s) => s.boards)
  const selectBoard = useStore((s) => s.selectBoard)
  const removeBoard = useStore((s) => s.removeBoard)
  const addBoard = useStore((s) => s.addBoard)
  const archiveBoard = useStore((s) => s.archiveBoard)
  const unarchiveBoard = useStore((s) => s.unarchiveBoard)
  const duplicateBoard = useStore((s) => s.duplicateBoard)
  const setDashboard = useStore((s) => s.setDashboard)
  const newBoardTemplate = useStore((s) => s.newBoardTemplate)
  const renameBoardTemplate = useStore((s) => s.renameBoardTemplate)
  const removeBoardTemplate = useStore((s) => s.removeBoardTemplate)
  const askConfirm = useStore((s) => s.askConfirm)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [band, setBand] = useState<BoardBand>('team')
  const [templateId, setTemplateId] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  // The browser's primary cut is the flight level, so it is a filter rather than a
  // section header you scroll past.
  const [bandFilter, setBandFilter] = useState<BoardBand | 'all'>('all')
  const boardTemplates = useStore((s) => s.boardTemplates)
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateBand, setTemplateBand] = useState<BoardBand>('team')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)

  const allGroups = boardsByBand(boards, q, showArchived)
  const groups = bandFilter === 'all' ? allGroups : allGroups.filter((g) => g.band === bandFilter)
  const bandCount = (b: BoardBand) => allGroups.find((g) => g.band === b)?.boards.length ?? 0
  const shown = groups.reduce((n, g) => n + g.boards.length, 0)
  const archivedCount = boards.filter((b) => b.archived).length
  const lastBoard = boards.length <= 1

  const create = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    // `open: false` — creating here is browsing, so the board lands in the list rather
    // than switching to it in edit mode the way the TopBar's create does.
    addBoard(trimmed, band, false, templateId || undefined)
    setName('')
    setBand('team')
    setTemplateId('')
    setCreating(false)
    setQ('')
  }

  const cancelCreate = () => {
    setName('')
    setBand('team')
    setTemplateId('')
    setCreating(false)
  }

  const createTemplate = () => {
    const trimmed = templateName.trim()
    if (!trimmed) return
    newBoardTemplate(trimmed, templateBand)
    setTemplateName('')
    setTemplateBand('team')
    setCreatingTemplate(false)
  }

  const cancelCreateTemplate = () => {
    setTemplateName('')
    setTemplateBand('team')
    setCreatingTemplate(false)
  }

  const removeTemplate = (template: BoardTemplate) =>
    askConfirm({
      title: `Delete template “${template.name}”?`,
      body: 'Boards already created from it are untouched.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => removeBoardTemplate(template.id),
    })

  const preview = boardTemplates.find((t) => t.id === previewId)

  const remove = (board: Board) =>
    askConfirm({
      title: `Delete “${board.name}”?`,
      body: 'Its lanes, cards and placements go with it, and any board that links it is unlinked. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => removeBoard(board.id),
    })

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-slate-200 p-4">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2 rounded-lg border border-slate-300 bg-white px-4 py-3">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-600">
              <Columns3 size={12} /> Boards
              <span className="rounded-full bg-indigo-50 px-1.5 py-px text-[10px] font-bold tabular-nums text-indigo-700 ring-1 ring-indigo-200">
                {shown}
              </span>
            </div>
            <div className="text-[16px] font-semibold text-slate-800">Every board in the organisation</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {(['all', ...BOARD_BANDS] as (BoardBand | 'all')[]).map((b) => {
                const on = bandFilter === b
                const count = b === 'all' ? shown : bandCount(b)
                const style = b === 'all' ? undefined : BAND_STYLES[b] ?? BAND_STYLES.team
                return (
                  <button
                    key={b}
                    onClick={() => setBandFilter(b)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition',
                      on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
                    )}
                  >
                    {style && <span className={cn('h-2 w-2 rounded-full', style.chip.split(' ')[0])} />}
                    {b === 'all' ? 'All' : style?.label}
                    <span className={cn('tabular-nums', on ? 'text-indigo-500' : 'text-slate-400')}>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => (creating ? cancelCreate() : setCreating(true))}
              className={cn(
                'flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-medium transition',
                creating
                  ? 'border-indigo-400/60 bg-indigo-50 text-indigo-700'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700',
              )}
              title="Create a board in this organisation"
            >
              <Plus size={13} /> New board
            </button>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search boards…"
                aria-label="Search boards"
                className="w-56 rounded-md border border-slate-300 py-1 pl-7 pr-2 text-[12px] outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            {archivedCount > 0 && (
              <button
                onClick={() => setShowArchived((v) => !v)}
                className={cn(
                  'flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-medium transition',
                  showArchived
                    ? 'border-slate-400 bg-slate-200 text-slate-700'
                    : 'border-slate-300 bg-white text-slate-500 hover:text-slate-700',
                )}
                title={showArchived ? 'Hide retired boards' : 'Show retired boards'}
              >
                <Archive size={13} /> {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
              </button>
            )}
          </div>

          {creating && (
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') create()
                  else if (e.key === 'Escape') cancelCreate()
                }}
                placeholder="Board name…"
                aria-label="New board name"
                className="w-56 rounded-md border border-slate-300 px-2 py-1 text-[12px] outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <select
                value={band}
                onChange={(e) => setBand(e.target.value as BoardBand)}
                aria-label="New board flight level"
                className="rounded-md border border-slate-300 px-1.5 py-1 text-[12px] outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {BOARD_BANDS.map((b) => (
                  <option key={b} value={b}>
                    {BAND_STYLES[b].label}
                  </option>
                ))}
              </select>
              <select
                value={templateId}
                onChange={(e) => {
                  const id = e.target.value
                  setTemplateId(id)
                  // A template carries a flight level, so offer it as the default.
                  const chosen = boardTemplates.find((t) => t.id === id)
                  if (chosen) setBand(chosen.band)
                }}
                aria-label="New board template"
                className="rounded-md border border-slate-300 px-1.5 py-1 text-[12px] outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="">Standard columns</option>
                {boardTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                onClick={create}
                disabled={!name.trim()}
                className="rounded-md bg-indigo-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
              >
                Create
              </button>
              <button
                onClick={cancelCreate}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-[12px] font-medium text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <span className="text-[11px] text-slate-400">
                {templateId
                  ? 'Uses that template’s columns, card types and WIP policy.'
                  : 'Starts as the standard Backlog → Done columns; shape it after.'}
              </span>
            </div>
          )}
        </div>

        {groups.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-100 p-8 text-center text-[12px] text-slate-500">
            {boards.length === 0 ? 'No boards yet.' : `No board matches “${q.trim()}”.`}
          </div>
        )}

        <div className="space-y-3">
          {/* A card per board. The flight level is a chip on the card and a filter above,
              so the list is flat — grouping by band as well would say it twice. */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {groups.flatMap(({ band, boards: inBand }) =>
              inBand.map((b) => {
                const style = BAND_STYLES[band] ?? BAND_STYLES.team
                const BandIcon = style.icon
                return (
                  <div
                    key={b.id}
                    className={cn(
                      'flex flex-col gap-2.5 rounded-xl border border-slate-300 bg-white p-3 shadow-sm transition',
                      b.archived ? 'opacity-60' : 'hover:border-indigo-300 hover:shadow-md',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', style.chip)}>
                        <BandIcon size={17} />
                      </span>
                      <span
                        className={cn('flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', style.chip)}
                      >
                        {style.label}
                      </span>
                    </div>

                    <div className="flex min-w-0 items-center gap-1.5">
                      <button
                        onClick={() => selectBoard(b.id)}
                        className="min-w-0 truncate text-left text-[14px] font-semibold text-slate-800 transition hover:text-indigo-600"
                        title={`Open ${b.name}`}
                      >
                        {b.name}
                      </button>
                      {b.archived && (
                        <span className="shrink-0 rounded bg-slate-200 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                          archived
                        </span>
                      )}
                    </div>

                    <div className="mt-auto flex items-center gap-1 border-t border-slate-100 pt-2">
                      <button
                        onClick={() => selectBoard(b.id)}
                        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                      >
                        Open board <ArrowRight size={12} />
                      </button>

                      <span className="ml-auto flex shrink-0 items-center gap-0.5">
                        {/* A real link — the URL carries the board and the view, so it can be
                            copied or opened in a new tab; the click itself stays in-app. */}
                        <a
                          href={`?board=${b.id}&view=dashboard`}
                          onClick={(e) => {
                            e.preventDefault()
                            selectBoard(b.id)
                            setDashboard(true)
                          }}
                          className="rounded p-1 text-slate-400 transition hover:text-slate-700"
                          title={`Open ${b.name}'s dashboard — a summary of its initiatives`}
                        >
                          <LayoutDashboard size={13} />
                        </a>
                        <button
                          onClick={() => duplicateBoard(b.id)}
                          className="rounded p-1 text-slate-400 transition hover:text-slate-700"
                          title={`Duplicate ${b.name} — its columns and settings, not its cards`}
                        >
                          <CopyPlus size={13} />
                        </button>
                        <button
                          onClick={() => (b.archived ? unarchiveBoard(b.id) : archiveBoard(b.id))}
                          className="rounded p-1 text-slate-400 transition hover:text-slate-700"
                          title={b.archived ? `Restore ${b.name}` : `Archive ${b.name}`}
                        >
                          {b.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                        </button>
                        <button
                          onClick={() => remove(b)}
                          disabled={lastBoard}
                          className="rounded p-1 text-slate-300 transition hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-30"
                          title={lastBoard ? 'The last board cannot be deleted' : `Delete ${b.name}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    </div>
                  </div>
                )
              }),
            )}
          </div>
        </div>

        {/* Templates — board designs, reusable when creating boards. */}
        <section className="mt-4">
          <div className="mb-1 flex items-center gap-2 px-1">
            <LayoutTemplate size={12} className="text-slate-400" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Templates</span>
            <span className="text-[10px] font-semibold tabular-nums text-slate-400">{boardTemplates.length}</span>
            <button
              onClick={() => (creatingTemplate ? cancelCreateTemplate() : setCreatingTemplate(true))}
              className={cn(
                'ml-auto flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-medium transition',
                creatingTemplate
                  ? 'border-indigo-400/60 bg-indigo-50 text-indigo-700'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700',
              )}
              title="Create a template to start boards from"
            >
              <Plus size={13} /> New template
            </button>
          </div>

          {creatingTemplate && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2">
              <input
                autoFocus
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createTemplate()
                  else if (e.key === 'Escape') cancelCreateTemplate()
                }}
                placeholder="Template name…"
                aria-label="New template name"
                className="w-56 rounded-md border border-slate-300 px-2 py-1 text-[12px] outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <select
                value={templateBand}
                onChange={(e) => setTemplateBand(e.target.value as BoardBand)}
                aria-label="New template board type"
                className="rounded-md border border-slate-300 px-1.5 py-1 text-[12px] outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {BOARD_BANDS.map((b) => (
                  <option key={b} value={b}>
                    {BAND_STYLES[b].label}
                  </option>
                ))}
              </select>
              <button
                onClick={createTemplate}
                disabled={!templateName.trim()}
                className="rounded-md bg-indigo-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
              >
                Create
              </button>
              <button
                onClick={cancelCreateTemplate}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-[12px] font-medium text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <span className="text-[11px] text-slate-400">The board type it will create, and its starting columns.</span>
            </div>
          )}

          {boardTemplates.length === 0 && !creatingTemplate ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-100 p-6 text-center text-[12px] text-slate-500">
              No templates yet. Create one here, or save a board’s design from its settings.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
              {boardTemplates.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0 hover:bg-slate-50"
                >
                  {renamingId === t.id ? (
                    <InlineEdit
                      autoEdit
                      value={t.name}
                      ariaLabel="Template name"
                      onSave={(next) => {
                        renameBoardTemplate(t.id, next)
                        setRenamingId(null)
                      }}
                      onDone={() => setRenamingId(null)}
                      className="min-w-0 flex-1"
                      inputClassName="w-full rounded border border-indigo-300 px-1.5 py-0.5 text-[13px] font-semibold text-slate-800 outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => setRenamingId(t.id)}
                      className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      title={`Rename ${t.name}`}
                    >
                      <span className="truncate text-[13px] font-semibold text-slate-800">{t.name}</span>
                      <Pencil size={11} className="shrink-0 text-slate-300 transition group-hover:text-indigo-500" />
                    </button>
                  )}

                  <button
                    onClick={() => setPreviewId(t.id)}
                    className="flex shrink-0 items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
                    title={`Preview ${t.name}`}
                  >
                    <Eye size={11} /> Preview
                  </button>

                  <button
                    onClick={() => removeTemplate(t)}
                    className="shrink-0 rounded p-1 text-slate-300 transition hover:text-rose-500"
                    title={`Delete ${t.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {preview && <TemplateEditor template={preview} onClose={() => setPreviewId(null)} />}
    </div>
  )
}
