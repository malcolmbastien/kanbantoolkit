import { useRef, useState } from 'react'
import { Archive, ArchiveRestore, ArrowRight, ChartNoAxesGantt, Columns3, CopyPlus, Database, Download, Eye, LayoutDashboard, LayoutTemplate, MoreVertical, Pencil, Plus, Search, Target, Trash2, Upload, Users } from 'lucide-react'
import { BAND_STYLES, BOARD_BANDS } from './BandBadge'
import { InlineEdit } from './InlineEdit'
import { NewBoardDialog } from './NewBoardDialog'
import { TemplateEditor } from './TemplateEditor'
import { boardsByBand } from '@/domain/board'
import { useMay } from '@/lib/permissions'
import { readWorkspaceFile } from '@/domain/workspace'
import { downloadWorkspace } from '@/lib/exportWorkspace'
import { formatBytes, requestPersistence, useStorageStatus } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { PERSIST_VERSION, useStore } from '@/store'
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
  const setTimeline = useStore((s) => s.setTimeline)
  const newBoardTemplate = useStore((s) => s.newBoardTemplate)
  const renameBoardTemplate = useStore((s) => s.renameBoardTemplate)
  const removeBoardTemplate = useStore((s) => s.removeBoardTemplate)
  const askConfirm = useStore((s) => s.askConfirm)
  const importWorkspace = useStore((s) => s.importWorkspace)
  const setObjectives = useStore((s) => s.setObjectives)
  const setView = useStore((s) => s.setView)
  const objectives = useStore((s) => s.objectives)
  const keyResults = useStore((s) => s.keyResults)
  // The ring of workspace copies, read on open and after a restore. The ring is written by the
  // schedule in `main.tsx`; this panel is where a person reaches for one.
  const storageUsage = useStorageStatus((s) => s.usage)
  const storageQuota = useStorageStatus((s) => s.quota)
  const storagePersisted = useStorageStatus((s) => s.persisted)
  // The role's half of the matrix: this screen is the way into every board, so a Viewer must not
  // be offered a New board, a duplicate, a template or an import that would answer 403.
  const may = useMay()
  const canCreate = may('board.create')
  const canManage = may('board.settings')
  const canDelete = may('board.delete')
  const canTemplates = may('template.manage')
  const canImport = may('workspace.import')
  const [q, setQ] = useState('')
  const [showNewBoard, setShowNewBoard] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  // The browser's primary cut is the flight level, so it is a filter rather than a
  // section header you scroll past.
  const [bandFilter, setBandFilter] = useState<BoardBand | 'all'>('all')
  // Which card's kebab menu is open. Board admin lives behind it, so the card face is
  // about the board rather than about what you can do to it.
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const boardTemplates = useStore((s) => s.boardTemplates)
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateBand, setTemplateBand] = useState<BoardBand>('team')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const allGroups = boardsByBand(boards, q, showArchived)
  const groups = bandFilter === 'all' ? allGroups : allGroups.filter((g) => g.band === bandFilter)
  const bandCount = (b: BoardBand) => allGroups.find((g) => g.band === b)?.boards.length ?? 0
  const shown = groups.reduce((n, g) => n + g.boards.length, 0)
  const archivedCount = boards.filter((b) => b.archived).length
  const lastBoard = boards.length <= 1

  const createBoard = (name: string, band: BoardBand, templateId?: string) => {
    // `open: false` — creating here is browsing, so the board lands in the list rather
    // than switching to it in edit mode the way the TopBar's create does.
    addBoard(name, band, false, templateId)
    setShowNewBoard(false)
    setQ('')
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

  /** Download the workspace — the same file the banner offers when saving has stopped. */
  const exportWorkspace = () => downloadWorkspace()

  const onImportFile = async (file: File | undefined) => {
    if (!file) return
    let json: unknown
    try {
      json = JSON.parse(await file.text())
    } catch {
      setImportError('That file is not valid JSON.')
      return
    }
    const read = readWorkspaceFile(json, PERSIST_VERSION)
    if (!read.ok || !read.state) {
      setImportError(read.error ?? 'That file is not a Kanban Toolkit workspace.')
      return
    }
    setImportError(null)
    const boards = read.state.boards as { name: string; archived?: boolean }[]
    const items = (read.state.items as unknown[]).length
    askConfirm({
      title: `Import “${file.name}”?`,
      body: `It replaces this workspace: ${boards.length} board${boards.length === 1 ? '' : 's'}, ${items} work item${items === 1 ? '' : 's'}. The current workspace is overwritten — export first if you want to keep it.`,
      confirmLabel: 'Import',
      danger: true,
      onConfirm: () => importWorkspace(read.state!, read.version!),
    })
  }

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
        {/* The other thing at this altitude. Boards are where work is arranged; objectives are
            what it is for, and until now the only way in was a portfolio board's corner. */}
        <button
          onClick={() => setObjectives(true)}
          className="mb-3 flex w-full items-center gap-3 rounded-lg border border-violet-300 bg-violet-50/70 px-4 py-2.5 text-left transition hover:border-violet-400 hover:bg-violet-50"
          title="Open Objectives & Key Results"
        >
          <Target size={16} className="shrink-0 text-violet-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-meta font-bold uppercase tracking-wide text-violet-700">Objectives &amp; Key Results</span>
            <span className="block text-meta text-slate-600">
              {objectives.length} objective{objectives.length === 1 ? '' : 's'} · {keyResults.length} key result{keyResults.length === 1 ? '' : 's'} — what the work is for, and the strategic initiatives that serve it
            </span>
          </span>
          <ArrowRight size={14} className="shrink-0 text-violet-500" />
        </button>

        <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2 rounded-lg border border-slate-300 bg-white px-4 py-3">
          <div>
            <div className="flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-indigo-600">
              <Columns3 size={12} /> Boards
              <span className="rounded-full bg-indigo-50 px-1.5 py-px text-micro font-bold tabular-nums text-indigo-700 ring-1 ring-indigo-200">
                {shown}
              </span>
            </div>
            <div className="text-heading font-semibold text-slate-800">Every board in the organisation</div>
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
                      'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-meta font-medium transition',
                      on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
                    )}
                  >
                    {style && <span className={cn('h-2 w-2 rounded-full', style.chip.split(' ')[0])} />}
                    {b === 'all' ? 'All' : style?.label}
                    <span className={cn('tabular-nums', on ? 'text-indigo-500' : 'text-slate-600')}>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {canCreate && (
              <button
                onClick={() => setShowNewBoard(true)}
                className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-meta font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
                title="Create a board in this organisation"
              >
                <Plus size={13} /> New board
              </button>
            )}
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search boards…"
                aria-label="Search boards"
                className="w-56 rounded-md border border-slate-300 py-1 pl-7 pr-2 text-meta outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            {archivedCount > 0 && (
              <button
                onClick={() => setShowArchived((v) => !v)}
                className={cn(
                  'flex items-center gap-1 rounded-md border px-2.5 py-1 text-meta font-medium transition',
                  showArchived
                    ? 'border-slate-400 bg-slate-200 text-slate-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:text-slate-700',
                )}
                title={showArchived ? 'Hide retired boards' : 'Show retired boards'}
              >
                <Archive size={13} /> {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
              </button>
            )}
            {/* The way into Admin, and the only one: it belongs to the organisation, not to a
                board, so a board's toolbar does not offer it. */}
            <button
              onClick={() => setView('admin')}
              className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-meta font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
              title="Admin — the copies of this workspace this browser keeps, and its storage"
            >
              <Database size={13} /> Admin
            </button>
          </div>
        </div>

        {boards.length === 0 ? (
          <div className="rounded-xl border border-slate-300 bg-white px-6 py-10 text-center">
            <p className="text-title font-semibold text-slate-900">This workspace is empty</p>
            <p className="mx-auto mt-1 max-w-md text-meta text-slate-600">
              A board is where the work lives: its stages, its columns and the cards in them. Make the
              first one, then bring people in — the board is no use to a team of one.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {canCreate && (
                <button
                  onClick={() => setShowNewBoard(true)}
                  className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-meta font-semibold text-white transition hover:bg-indigo-500"
                >
                  <Plus size={13} /> New board
                </button>
              )}
              {canManage && (
                <button
                  onClick={() => setView('admin')}
                  className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-meta font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700"
                >
                  <Users size={13} /> Invite people
                </button>
              )}
            </div>
            <p className="mt-3 text-micro text-slate-500">
              An empty workspace is a real one: nothing is seeded behind your back.
            </p>
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-100 p-8 text-center text-meta text-slate-600">
            No board matches “{q.trim()}”.
          </div>
        ) : null}

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
                        className={cn('flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-micro font-bold uppercase tracking-wide', style.chip)}
                      >
                        {style.label}
                      </span>
                    </div>

                    <div className="flex min-w-0 items-center gap-1.5">
                      <button
                        onClick={() => selectBoard(b.id)}
                        className="min-w-0 truncate text-left text-title font-semibold text-slate-800 transition hover:text-indigo-600"
                        title={`Open ${b.name}`}
                      >
                        {b.name}
                      </button>
                      {b.archived && (
                        <span className="shrink-0 rounded bg-slate-200 px-1 py-px text-micro font-semibold uppercase tracking-wide text-slate-600">
                          archived
                        </span>
                      )}
                    </div>

                    <div className="mt-auto flex items-center gap-1 border-t border-slate-100 pt-2">
                      <button
                        onClick={() => selectBoard(b.id)}
                        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-meta font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
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
                          className="rounded p-1 text-slate-600 transition hover:text-slate-700"
                          title={`Open ${b.name}'s dashboard — a summary of its initiatives`}
                        >
                          <LayoutDashboard size={13} />
                        </a>

                        <a
                          href={`?board=${b.id}&view=timeline`}
                          onClick={(e) => {
                            e.preventDefault()
                            selectBoard(b.id)
                            setTimeline(true)
                          }}
                          className="rounded p-1 text-slate-600 transition hover:text-slate-700"
                          title={`Open ${b.name}'s timeline — its initiatives over time`}
                        >
                          <ChartNoAxesGantt size={13} />
                        </a>

                        {(canCreate || canManage || canDelete) && (
                          <div className="relative">
                            <button
                              onClick={() => setMenuFor(menuFor === b.id ? null : b.id)}
                              className={cn(
                                'grid h-6 w-6 place-items-center rounded transition',
                                menuFor === b.id ? 'bg-slate-100 text-slate-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-700',
                              )}
                              title={`More — ${b.name}`}
                            >
                              <MoreVertical size={14} />
                            </button>

                            {menuFor === b.id && (
                              <>
                                <div className="fixed inset-0 z-20" onClick={() => setMenuFor(null)} />
                                <div className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-0.5 shadow-xl">
                                  {canCreate && (
                                    <MenuRow
                                      icon={<CopyPlus size={13} />}
                                      label="Duplicate"
                                      hint="columns and settings, not its cards"
                                      onClick={() => { duplicateBoard(b.id); setMenuFor(null) }}
                                    />
                                  )}
                                  {canManage && (
                                    <MenuRow
                                      icon={b.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                                      label={b.archived ? 'Restore' : 'Archive'}
                                      hint={b.archived ? 'put it back in play' : 'file it away, keep its links'}
                                      onClick={() => {
                                        if (b.archived) unarchiveBoard(b.id)
                                        else archiveBoard(b.id)
                                        setMenuFor(null)
                                      }}
                                    />
                                  )}
                                  {canDelete && (
                                    <MenuRow
                                      icon={<Trash2 size={13} />}
                                      label="Delete"
                                      hint={lastBoard ? 'the last board cannot be deleted' : 'permanent'}
                                      danger
                                      disabled={lastBoard}
                                      onClick={() => { setMenuFor(null); remove(b) }}
                                    />
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </span>
                    </div>
                  </div>
                )
              }),
            )}
          </div>
        </div>

        {/* Templates — board designs, reusable when creating boards. A design is the
            administrator's, so a role that may not manage one is not shown the list. */}
        {canTemplates && (
          <section className="mt-4">
            <div className="mb-1 flex items-center gap-2 px-1">
              <LayoutTemplate size={12} className="text-slate-400" />
              <span className="text-micro font-bold uppercase tracking-wide text-slate-600">Templates</span>
              <span className="text-micro font-semibold tabular-nums text-slate-600">{boardTemplates.length}</span>
              <button
                onClick={() => (creatingTemplate ? cancelCreateTemplate() : setCreatingTemplate(true))}
                className={cn(
                  'ml-auto flex items-center gap-1 rounded-md border px-2.5 py-1 text-meta font-medium transition',
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
                  className="w-56 rounded-md border border-slate-300 px-2 py-1 text-meta outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <select
                  value={templateBand}
                  onChange={(e) => setTemplateBand(e.target.value as BoardBand)}
                  aria-label="New template board type"
                  className="rounded-md border border-slate-300 px-1.5 py-1 text-meta outline-none focus:ring-2 focus:ring-indigo-300"
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
                  className="rounded-md bg-indigo-500 px-2.5 py-1 text-meta font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
                >
                  Create
                </button>
                <button
                  onClick={cancelCreateTemplate}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-meta font-medium text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <span className="text-meta text-slate-600">The board type it will create, and its starting columns.</span>
              </div>
            )}

            {boardTemplates.length === 0 && !creatingTemplate ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-100 p-6 text-center text-meta text-slate-600">
                No templates yet. Create one here, or save a board’s design from its settings.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
                {boardTemplates.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0 hover:bg-slate-200"
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
                        inputClassName="w-full rounded border border-indigo-300 px-1.5 py-0.5 text-body font-semibold text-slate-800 outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => setRenamingId(t.id)}
                        className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        title={`Rename ${t.name}`}
                      >
                        <span className="truncate text-body font-semibold text-slate-800">{t.name}</span>
                        <Pencil size={11} className="shrink-0 text-slate-300 transition group-hover:text-indigo-500" />
                      </button>
                    )}

                    <button
                      onClick={() => setPreviewId(t.id)}
                      className="flex shrink-0 items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-meta font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
                      title={`Preview ${t.name}`}
                    >
                      <Eye size={11} /> Preview
                    </button>

                    <button
                      onClick={() => removeTemplate(t)}
                      className="shrink-0 rounded p-1 text-slate-600 transition hover:text-rose-500"
                      title={`Delete ${t.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Workspace data — the organisation, out and back into files. The export is what
            the app persists, at the shape it was written in; the import replaces everything,
            after the file passes the shape check and the person confirms. */}
        <section data-workspace-data className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-slate-600">
                <Download size={12} /> Workspace data
              </div>
              <p className="mt-0.5 text-meta text-slate-600">
                Export downloads every board, card and initiative as a JSON file; importing one replaces this workspace
                with what the file carries.
              </p>
              {/* What the browser says about the space, and whether it has promised to keep it.
                  A browser that will not promise may evict the workspace after a quiet week. */}
              <p data-storage-figures className="mt-1 text-micro text-slate-600">
                Storage: <span className="tabular-nums">{formatBytes(storageUsage)}</span> used
                {storageQuota !== null && <> of {formatBytes(storageQuota)}</>}
                {' · '}
                {storagePersisted === true
                  ? 'the browser will keep it'
                  : storagePersisted === false
                    ? 'the browser may evict it'
                    : 'persistence not yet requested'}
                {storagePersisted === false && (
                  <button
                    onClick={() => void requestPersistence(true)}
                    className="ml-1.5 rounded border border-slate-300 px-1.5 py-0.5 font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
                    title="Ask the browser to keep this workspace instead of evicting it under pressure"
                  >
                    Ask the browser to keep it
                  </button>
                )}
              </p>
              {importError && <p className="mt-1 text-meta font-medium text-rose-600">{importError}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={exportWorkspace}
                className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-meta font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
                title="Download the whole workspace as JSON"
              >
                <Download size={13} /> Export
              </button>
              {canImport && (
                <>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-meta font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
                    title="Import a workspace file — replaces everything here"
                  >
                    <Upload size={13} /> Import…
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      void onImportFile(e.target.files?.[0])
                      // Reading the same file again must fire again.
                      e.target.value = ''
                    }}
                  />
                </>
              )}
            </div>
          </div>
        </section>

      </div>

      {showNewBoard && (
        <NewBoardDialog
          templates={boardTemplates}
          onCreate={createBoard}
          onClose={() => setShowNewBoard(false)}
        />
      )}

      {preview && <TemplateEditor template={preview} onClose={() => setPreviewId(null)} />}
    </div>
  )
}

function MenuRow({
  icon,
  label,
  hint,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cn(
        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta transition disabled:cursor-not-allowed disabled:opacity-40',
        danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50',
      )}
    >
      <span className={cn('shrink-0', danger ? 'text-rose-500' : 'text-slate-600')}>{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  )
}
