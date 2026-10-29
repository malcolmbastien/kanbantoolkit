import { useState } from 'react'
import { Archive, ArchiveRestore, ArrowRight, ChartNoAxesGantt, CopyPlus, Database, LayoutDashboard, LayoutTemplate, MoreVertical, Plus, Ruler, Search, Trash2, Users } from 'lucide-react'
import { BAND_STYLES, BOARD_BANDS } from './BandBadge'
import { NewBoardDialog } from './NewBoardDialog'
import { TemplateEditor } from './TemplateEditor'
import { boardsByBand } from '@/domain/board'
import { useMay } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Board, BoardBand } from '@/domain/types'

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
  const askConfirm = useStore((s) => s.askConfirm)
  const setView = useStore((s) => s.setView)
  // The role's half of the matrix: this screen is the way into every board, so a Viewer must not
  // be offered a New board, a duplicate or a template that would answer 403.
  const may = useMay()
  const canCreate = may('board.create')
  const canManage = may('board.settings')
  const canDelete = may('board.delete')
  const canTemplates = may('template.manage')
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
  const [newTemplateId, setNewTemplateId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  // The home is two sections: the boards, and the designs boards are made from. A workspace with
  // many boards should not bury its templates under the list.
  const [homeTab, setHomeTab] = useState<'boards' | 'templates'>('boards')
  const activeTab = homeTab === 'templates' && canTemplates ? 'templates' : 'boards'

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

  /** A name nobody has used, so two untouched templates are not both “Untitled template”. */
  const untitledTemplateName = () => {
    const base = 'Untitled template'
    if (!boardTemplates.some((template) => template.name === base)) return base
    let n = 2
    while (boardTemplates.some((template) => template.name === `${base} ${n}`)) n += 1
    return `${base} ${n}`
  }

  /**
   * New template opens the template editor itself, on a template that begins as the standard
   * columns. The editor is the one place its name, type, flow and card types are set; Cancel there
   * takes the just-made template back out.
   */
  const createTemplate = () => {
    const id = newBoardTemplate(untitledTemplateName(), 'team')
    if (!id) return
    setNewTemplateId(id)
    setPreviewId(id)
  }

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
        <div className="mb-3 rounded-lg border border-slate-300 bg-white">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2 px-4 py-3">
          <div>
            <h1 className="text-heading font-semibold text-slate-800">Workspace Home</h1>
            <p className="mt-0.5 text-meta text-slate-600">Every board in the organisation, and the designs behind them.</p>
            {activeTab === 'boards' && (
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
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {activeTab === 'boards' && canCreate && (
              <button
                onClick={() => setShowNewBoard(true)}
                className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-meta font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                title="Create a board in this organisation"
              >
                <Plus size={14} /> New board
              </button>
            )}
            {activeTab === 'boards' && (
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
            )}
            {activeTab === 'boards' && archivedCount > 0 && (
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
          <nav role="tablist" aria-label="Workspace home sections" className="flex gap-1 border-t border-slate-100 px-3">
            {[
              { id: 'boards' as const, label: 'Boards', count: boards.length },
              ...(canTemplates ? [{ id: 'templates' as const, label: 'Templates', count: boardTemplates.length }] : []),
            ].map((entry) => (
              <button
                key={entry.id}
                id={`home-tab-${entry.id}`}
                role="tab"
                aria-selected={activeTab === entry.id}
                aria-controls={`home-panel-${entry.id}`}
                onClick={() => setHomeTab(entry.id)}
                className={cn(
                  '-mb-px border-b-2 px-2.5 py-1.5 text-meta font-medium',
                  activeTab === entry.id
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-600 hover:text-slate-900',
                )}
              >
                {entry.label}
                <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-px text-micro font-bold tabular-nums text-slate-600">
                  {entry.count}
                </span>
              </button>
            ))}
          </nav>
        </div>

        {activeTab === 'boards' && (
          <div id="home-panel-boards" role="tabpanel" aria-labelledby="home-tab-boards">
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

          </div>
        )}

        {/* Templates — board designs, reusable when creating boards. A design is the
            administrator's, so a role that may not manage one is not shown the list. */}
        {activeTab === 'templates' && canTemplates && (
          <div id="home-panel-templates" role="tabpanel" aria-labelledby="home-tab-templates">
          <section>
            <div className="mb-1 flex items-center gap-2 px-1">
              <LayoutTemplate size={12} className="text-slate-400" />
              <span className="text-micro font-bold uppercase tracking-wide text-slate-600">Templates</span>
              <span className="text-micro font-semibold tabular-nums text-slate-600">{boardTemplates.length}</span>
              <button
                onClick={createTemplate}
                className="ml-auto flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-meta font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
                title="Create a template to start boards from"
              >
                <Plus size={13} /> New template
              </button>
            </div>

            {boardTemplates.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-100 p-6 text-center text-meta text-slate-600">
                No templates yet. Create one here, or save a board’s design from its settings.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {boardTemplates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setPreviewId(t.id)}
                    className="group flex flex-col rounded-xl border border-dashed border-sky-300 bg-white p-3 text-left shadow-sm transition hover:border-sky-400 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                    title={`Open the ${t.name} template`}
                  >
                    <span className="flex items-center justify-between">
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-100 text-sky-700">
                        <Ruler size={16} />
                      </span>
                      <span className="rounded bg-white/70 px-1.5 py-px text-micro font-semibold uppercase tracking-wide text-sky-700 ring-1 ring-sky-200">
                        {BAND_STYLES[t.band].label}
                      </span>
                    </span>

                    <span className="mt-3 truncate text-title font-semibold text-slate-800">{t.name}</span>
                    <span className="mt-0.5 text-meta text-slate-600">
                      {t.lanes.length} lane{t.lanes.length === 1 ? '' : 's'} · a board design
                    </span>
                    <span className="mt-2 flex items-center gap-1 text-micro font-medium text-sky-700">
                      Open design <ArrowRight size={11} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
          </div>
        )}


      </div>

      {showNewBoard && (
        <NewBoardDialog
          templates={boardTemplates}
          onCreate={createBoard}
          onClose={() => setShowNewBoard(false)}
        />
      )}

      {preview && (
        <TemplateEditor
          template={preview}
          isNew={newTemplateId === preview.id}
          startEditing={newTemplateId === preview.id}
          onClose={() => {
            setPreviewId(null)
            setNewTemplateId(null)
          }}
        />
      )}
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
