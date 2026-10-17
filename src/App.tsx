import { useEffect } from 'react'
import { ArchiveView } from './components/ArchiveView'
import { MyWorkView } from './components/MyWorkView'
import { BoardWorkspace } from './components/BoardWorkspace'
import { BoardView } from './components/BoardView'
import { BulkActions } from './components/BulkActions'
import { BoardSettings } from './components/BoardSettings'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ReasonDialog } from './components/ReasonDialog'
import { FilterPanel } from './components/FilterPanel'
import { BoardLegend } from './components/BoardLegend'
import { ItemPanel } from './components/ItemPanel'
import { FocusChip } from './components/FocusChip'
import { ManagementDashboard } from './components/ManagementDashboard'
import { TimelineView } from './components/TimelineView'
import { MetricsView } from './components/MetricsView'
import { ObjectivesView } from './components/ObjectivesView'
import { Overlays } from './components/Overlays'
import { TopBar } from './components/TopBar'
import { boardCardTypeId, defaultDropLane, initiativeTypeId } from './domain/board'
import { filtersFromParam } from './domain/filters'
import { leafLanes } from './domain/lanes'
import { isBoardSurface, useStore } from './store'

export default function App() {
  const boards = useStore((s) => s.boards)
  const boardId = useStore((s) => s.boardId)
  const saveEdit = useStore((s) => s.saveEdit)
  const cancelEdit = useStore((s) => s.cancelEdit)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const editMode = useStore((s) => s.editMode)
  const showObjectives = useStore((s) => s.showObjectives)
  const setObjectives = useStore((s) => s.setObjectives)
  const showMetrics = useStore((s) => s.showMetrics)
  const setMetrics = useStore((s) => s.setMetrics)
  const showDashboard = useStore((s) => s.showDashboard)
  const setBoard = useStore((s) => s.setBoard)
  const setDashboard = useStore((s) => s.setDashboard)
  const setTimeline = useStore((s) => s.setTimeline)
  const showArchive = useStore((s) => s.showArchive)
  const showTimeline = useStore((s) => s.showTimeline)
  const setArchive = useStore((s) => s.setArchive)
  const showBoards = useStore((s) => s.showBoards)
  const setBoards = useStore((s) => s.setBoards)
  const showMyWork = useStore((s) => s.showMyWork)
  const setMyWork = useStore((s) => s.setMyWork)
  const showLegend = useStore((s) => s.showLegend)
  const showFilters = useStore((s) => s.showFilters)
  // The side panels belong to the board surface: the legend and the filters narrow or explain
  // one board, so neither trails into the dashboard, timeline, archive, objectives, the
  // workspace or My work. Leaving for a view keeps the choice — coming back shows it again.
  const boardSurface = useStore(isBoardSurface)
  const showBoardSettings = useStore((s) => s.showBoardSettings)
  const toggleCollapse = useStore((s) => s.toggleCollapse)
  const autoArchiveDays = useStore((s) => s.autoArchiveDays)
  const runAutoArchive = useStore((s) => s.runAutoArchive)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)

  const selectBoard = useStore((s) => s.selectBoard)
  const setSearch = useStore((s) => s.setSearch)
  const resetDemo = useStore((s) => s.resetDemo)
  const toggleBoardSettings = useStore((s) => s.toggleBoardSettings)
  const beginEdit = useStore((s) => s.beginEdit)
  const openItem = useStore((s) => s.openItem)
  const moveCard = useStore((s) => s.moveCard)
  const addCard = useStore((s) => s.addCard)
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
    if (q) {
      setSearch(q)
      // A deep-linked ?q= meant a narrowed board, and the top-bar search no longer filters
      // the columns — narrowing by text is the filter panel's criterion now. Both get the
      // query: the finder keeps its results, the board keeps its narrowing.
      useStore.getState().setFilters({ text: q })
    }
    // ?filters=1 opens the panel; ?filters=blocked,overdue also applies those filters.
    const filtersParam = params.get('filters')
    if (filtersParam) {
      const store = useStore.getState()
      if (!store.showFilters) store.toggleFilters()
      const parsed = filtersFromParam(filtersParam)
      if (parsed) store.setFilters(parsed)
    }
    // Idempotent: StrictMode double-invokes this effect, and toggleCollapse would flip twice.
    for (const id of params.getAll('collapse')) {
      if (!useStore.getState().collapsedLanes[id]) toggleCollapse(id)
    }
    if (params.get('view') === 'objectives') setObjectives(true)
    if (params.get('view') === 'dashboard') setDashboard(true)
    if (params.get('view') === 'timeline') setTimeline(true)
    if (params.get('view') === 'metrics') setMetrics(true)
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
      if (s.parentPickId) {
        s.cancelParentPick()
        return
      }
      if (s.childPickId) {
        s.cancelChildPick()
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

  /**
   * A new card, in the board's default drop column — or the first leaf if it has never said.
   *
   * Falling back rather than failing matters here: a cell the board named can be deleted or
   * split away, and a board that has lost its answer should still be able to take a card.
   */
  const quickAdd = () => {
    const lane = defaultDropLane(boards.find((b) => b.id === boardId), lanes, boardId)
    if (lane) onAddCard(lane.id)
  }

  /**
   * A new initiative, in the first cell of the board's initiatives workflow.
   *
   * The mirror of `quickAdd`, and it has to be: an initiative is not a card with a different
   * label — it lives in the other lane tree, in a cell of a section, and the Initiative type is
   * the one type a person never chooses. Which is exactly why the button matters, since until
   * now the only way to make one was to link it from another board.
   */
  const quickAddInitiative = () => {
    const typeId = initiativeTypeId(issueTypes)
    const firstLeaf = leafLanes(lanes, boardId, 'initiatives')[0]
    if (!typeId || !firstLeaf) return
    addCard({ boardId, typeId, laneId: firstLeaf.id, title: 'New initiative' })
  }


  return (
    <div className="flex h-full flex-col">
      {/* One host for the menu and the pick chips, so every surface has them — an aggregating
          board renders no BoardCanvas, and used to get neither. */}
      <Overlays />
      <TopBar
        boards={boards}
        boardId={boardId}
        editMode={editMode}
        showDashboard={showDashboard}
        showTimeline={showTimeline}
        showArchive={showArchive}
        showObjectives={showObjectives}
        showMetrics={showMetrics}
        showBoards={showBoards}
        showMyWork={showMyWork}
        onSelectBoard={selectBoard}
        onShowBoard={setBoard}
        onShowDashboard={() => setDashboard(true)}
        onShowTimeline={() => setTimeline(true)}
        onShowMetrics={() => setMetrics(true)}
        onShowArchive={() => setArchive(true)}
        onShowMyWork={() => setMyWork(true)}
        onGoToBoards={() => setBoards(true)}
        onEditBoard={beginEdit}
        onSaveEdit={saveEdit}
        onCancelEdit={cancelEdit}
        onOpenBoardSettings={toggleBoardSettings}
        onAddCard={quickAdd}
        onAddInitiative={quickAddInitiative}
        onReset={resetDemo}
      />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {showBoards ? (
            <BoardWorkspace />
          ) : showArchive ? (
            <ArchiveView />
          ) : showMyWork ? (
            <MyWorkView />
          ) : showObjectives ? (
            <ObjectivesView />
          ) : showDashboard ? (
            <ManagementDashboard boardId={boardId} />
          ) : showMetrics ? (
            <MetricsView boardId={boardId} />
          ) : showTimeline ? (
            <TimelineView boardId={boardId} />
          ) : (
            <BoardView requestMove={requestMove} />
          )}
        </div>
        {showLegend && boardSurface ? <BoardLegend /> : showFilters && boardSurface ? <FilterPanel /> : selectedItemId ? <ItemPanel itemId={selectedItemId} /> : null}
      </div>

      {showBoardSettings && <BoardSettings />}
      <FocusChip />
      <ConfirmDialog />
      <ReasonDialog />
      <BulkActions />
    </div>
  )
}
