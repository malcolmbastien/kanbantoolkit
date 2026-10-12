import { useEffect } from 'react'
import { ArchiveView } from './components/ArchiveView'
import { BoardWorkspace } from './components/BoardWorkspace'
import { BoardView } from './components/BoardView'
import { BulkActions } from './components/BulkActions'
import { BoardSettings } from './components/BoardSettings'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ReasonDialog } from './components/ReasonDialog'
import { FilterPanel } from './components/FilterPanel'
import { ItemPanel } from './components/ItemPanel'
import { ManagementDashboard } from './components/ManagementDashboard'
import { ObjectivesView } from './components/ObjectivesView'
import { TopBar } from './components/TopBar'
import { TypeEditor } from './components/TypeEditor'
import { boardCardTypeId } from './domain/board'
import { activeFilterCount } from './domain/filters'
import { leafLanes } from './domain/lanes'
import { useStore } from './store'

export default function App() {
  const boards = useStore((s) => s.boards)
  const boardId = useStore((s) => s.boardId)
  const boardBand = boards.find((b) => b.id === boardId)?.band ?? 'team'
  const selectedItemId = useStore((s) => s.selectedItemId)
  const showTypeEditor = useStore((s) => s.showTypeEditor)
  const editMode = useStore((s) => s.editMode)
  const showObjectives = useStore((s) => s.showObjectives)
  const toggleObjectives = useStore((s) => s.toggleObjectives)
  const setObjectives = useStore((s) => s.setObjectives)
  const showDashboard = useStore((s) => s.showDashboard)
  const toggleDashboard = useStore((s) => s.toggleDashboard)
  const setDashboard = useStore((s) => s.setDashboard)
  const showArchive = useStore((s) => s.showArchive)
  const toggleArchive = useStore((s) => s.toggleArchive)
  const showBoards = useStore((s) => s.showBoards)
  const toggleBoards = useStore((s) => s.toggleBoards)
  const setBoards = useStore((s) => s.setBoards)
  const setArchive = useStore((s) => s.setArchive)
  const showFilters = useStore((s) => s.showFilters)
  const filters = useStore((s) => s.filters)
  const toggleFilters = useStore((s) => s.toggleFilters)
  const askConfirm = useStore((s) => s.askConfirm)
  const showBoardSettings = useStore((s) => s.showBoardSettings)
  const toggleCollapse = useStore((s) => s.toggleCollapse)
  const autoArchiveDays = useStore((s) => s.autoArchiveDays)
  const runAutoArchive = useStore((s) => s.runAutoArchive)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)

  const selectBoard = useStore((s) => s.selectBoard)
  const setSearch = useStore((s) => s.setSearch)
  const resetDemo = useStore((s) => s.resetDemo)
  const toggleTypeEditor = useStore((s) => s.toggleTypeEditor)
  const toggleBoardSettings = useStore((s) => s.toggleBoardSettings)
  const beginEdit = useStore((s) => s.beginEdit)
  const saveEdit = useStore((s) => s.saveEdit)
  const cancelEdit = useStore((s) => s.cancelEdit)
  const openItem = useStore((s) => s.openItem)
  const moveCard = useStore((s) => s.moveCard)
  const addCard = useStore((s) => s.addCard)
  const addBoard = useStore((s) => s.addBoard)
  const removeBoard = useStore((s) => s.removeBoard)
  const setLens = useStore((s) => s.setLens)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const b = params.get('board')
    const it = params.get('item')
    if (b) selectBoard(b)
    if (params.get('edit')) beginEdit()
    if (it) openItem(it)
    const lens = params.get('lens')
    if (lens) setLens(lens)
    const boundary = params.get('boundary')
    if (boundary && useStore.getState().boundaryId !== boundary) useStore.getState().toggleBoundary(boundary)
    // ?select=id1,id2 pre-selects cards in the multi-select group.
    const select = params.get('select')
    if (select) {
      for (const id of select.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!useStore.getState().multiSelect.includes(id)) useStore.getState().toggleMultiSelect(id)
      }
    }
    const q = params.get('q')
    if (q) setSearch(q)
    // ?filters=1 opens the panel; ?filters=blocked,overdue also applies those filters.
    const filtersParam = params.get('filters')
    if (filtersParam) {
      const store = useStore.getState()
      if (!store.showFilters) store.toggleFilters()
      const flags = filtersParam.split(',').map((f) => f.trim().toLowerCase())
      store.setFilters({
        ...(flags.includes('blocked') ? { blocked: true } : {}),
        ...(flags.includes('overdue') ? { overdue: true } : {}),
        ...(flags.includes('unassigned') ? { unassigned: true } : {}),
      })
    }
    // Idempotent: StrictMode double-invokes this effect, and toggleCollapse would flip twice.
    for (const id of params.getAll('collapse')) {
      if (!useStore.getState().collapsedLanes[id]) toggleCollapse(id)
    }
    if (params.get('view') === 'objectives') setObjectives(true)
    if (params.get('view') === 'dashboard') setDashboard(true)
    if (params.get('view') === 'archive') setArchive(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-archive (a user-set rule): file Done items once they age past the threshold.
  useEffect(() => {
    runAutoArchive()
  }, [autoArchiveDays, runAutoArchive])

  // Escape, or a click on any empty part of the screen, dismisses the topmost
  // layer: a confirm dialog or card menu handles its own; otherwise the current
  // selection — a multi-select group, or a single card open in the panel.
  // Clicks on a card (to toggle/open it), the bulk bar, or a panel are left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = useStore.getState()
      if (s.confirm) return // the confirm dialog handles Escape
      if (s.cardMenu) {
        s.closeCardMenu()
        return
      }
      if (s.multiSelect.length > 0) s.clearMultiSelect()
      else if (s.selectedItemId) s.openItem(null)
    }
    const onDown = (e: MouseEvent) => {
      const s = useStore.getState()
      if (s.multiSelect.length === 0 && !s.selectedItemId) return
      const target = e.target as HTMLElement | null
      if (
        target?.closest('[data-card-id]') ||
        target?.closest('[data-bulk-actions]') ||
        target?.closest('[data-item-panel]') ||
        target?.closest('[data-confirm-dialog]') ||
        target?.closest('[data-lane-settings]') ||
        target?.closest('[data-board-settings]') ||
        target?.closest('[data-reason-dialog]') ||
        target?.closest('[data-card-menu]')
      ) {
        return
      }
      if (s.multiSelect.length > 0) s.clearMultiSelect()
      else s.openItem(null)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [])

  const requestMove = (itemId: string, bId: string, laneId: string) => moveCard(itemId, bId, laneId)

  const onAddCard = (laneId: string) => {
    const typeId = boardCardTypeId(boards.find((b) => b.id === boardId), issueTypes)
    if (!typeId) return
    addCard({ boardId, typeId, laneId, title: 'New card' })
  }

  const quickAdd = () => {
    const firstLeaf = leafLanes(lanes, boardId)[0]
    if (firstLeaf) onAddCard(firstLeaf.id)
  }

  const onNewBoard = (name: string) => addBoard(name)
  const onDeleteBoard = () =>
    askConfirm({
      title: 'Delete this board?',
      body: 'The board and its cards are removed. Cards that also live on another board survive there.',
      confirmLabel: 'Delete board',
      danger: true,
      onConfirm: () => removeBoard(boardId),
    })

  return (
    <div className="flex h-full flex-col">
      <TopBar
        boards={boards}
        boardId={boardId}
        boardBand={boardBand}
        editMode={editMode}
        showObjectives={showObjectives}
        showDashboard={showDashboard}
        showArchive={showArchive}
        showBoards={showBoards}
        showFilters={showFilters}
        activeFilterCount={activeFilterCount(filters)}
        onSelectBoard={selectBoard}
        onToggleObjectives={toggleObjectives}
        onToggleDashboard={toggleDashboard}
        onToggleArchive={toggleArchive}
        onToggleBoards={toggleBoards}
        onGoToBoards={() => setBoards(true)}
        onToggleFilters={toggleFilters}
        onEditBoard={beginEdit}
        onSaveEdit={saveEdit}
        onCancelEdit={cancelEdit}
        onOpenTypes={toggleTypeEditor}
        onOpenBoardSettings={toggleBoardSettings}
        onAddCard={quickAdd}
        onNewBoard={onNewBoard}
        onDeleteBoard={onDeleteBoard}
        onReset={resetDemo}
      />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {showBoards ? (
            <BoardWorkspace />
          ) : showArchive ? (
            <ArchiveView />
          ) : showObjectives ? (
            <ObjectivesView />
          ) : showDashboard && boardBand === 'portfolio' ? (
            <ManagementDashboard boardId={boardId} />
          ) : (
            <BoardView requestMove={requestMove} />
          )}
        </div>
        {showFilters ? <FilterPanel /> : selectedItemId ? <ItemPanel itemId={selectedItemId} /> : null}
      </div>

      {showTypeEditor && <TypeEditor />}
      {showBoardSettings && <BoardSettings />}
      <ConfirmDialog />
      <ReasonDialog />
      <BulkActions />
    </div>
  )
}
