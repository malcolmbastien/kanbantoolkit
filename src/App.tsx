import { lazy, Suspense, useEffect } from 'react'
import { BoardView } from './components/BoardView'
import { BulkActions } from './components/BulkActions'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ReasonDialog } from './components/ReasonDialog'
import { FilterPanel } from './components/FilterPanel'
import { StorageBanner } from './components/StorageBanner'
import { QuarantineBanner } from './components/QuarantineBanner'
import { StaleTabBanner } from './components/StaleTabBanner'
import { BoardLegend } from './components/BoardLegend'

import { FocusChip } from './components/FocusChip'

import { Overlays } from './components/Overlays'
import { TopBar } from './components/TopBar'
import { boardCardTypeId, defaultDropLane, initiativeTypeId, isAggregating } from './domain/board'
import { leafLanes } from './domain/lanes'
import { useUrl } from './lib/useUrl'
import { isBoardSurface, useStore } from './store'

/**
 * The board is what the app opens on, so it is downloaded with the app. Every other screen is a
 * file a person may never open: it is fetched the first time they do.
 *
 * The placeholder is full height on purpose. It is what the screen will occupy, so a slow
 * connection shows a gap that is about to fill rather than a page that jumps when it does.
 */
const BoardWorkspace = lazy(() => import('./components/BoardWorkspace').then((m) => ({ default: m.BoardWorkspace })))
const ArchiveView = lazy(() => import('./components/ArchiveView').then((m) => ({ default: m.ArchiveView })))
const MyWorkView = lazy(() => import('./components/MyWorkView').then((m) => ({ default: m.MyWorkView })))
const ObjectivesView = lazy(() => import('./components/ObjectivesView').then((m) => ({ default: m.ObjectivesView })))
const ManagementDashboard = lazy(() => import('./components/ManagementDashboard').then((m) => ({ default: m.ManagementDashboard })))
const MetricsView = lazy(() => import('./components/MetricsView').then((m) => ({ default: m.MetricsView })))
const TimelineView = lazy(() => import('./components/TimelineView').then((m) => ({ default: m.TimelineView })))
const AdminView = lazy(() => import('./components/AdminView').then((m) => ({ default: m.AdminView })))
const ItemPanel = lazy(() => import('./components/ItemPanel').then((m) => ({ default: m.ItemPanel })))
const CommandPalette = lazy(() => import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette })))
const BoardSettings = lazy(() => import('./components/BoardSettings').then((m) => ({ default: m.BoardSettings })))

function ViewLoading() {
  return <div aria-busy="true" className="h-full w-full" />
}

export default function App() {
  const boards = useStore((s) => s.boards)
  const boardId = useStore((s) => s.boardId)
  const saveEdit = useStore((s) => s.saveEdit)
  const cancelEdit = useStore((s) => s.cancelEdit)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const editMode = useStore((s) => s.editMode)
  const showObjectives = useStore((s) => s.showObjectives)
  const showMetrics = useStore((s) => s.showMetrics)
  const showDashboard = useStore((s) => s.showDashboard)
  const showArchive = useStore((s) => s.showArchive)
  const showTimeline = useStore((s) => s.showTimeline)
  const showBoards = useStore((s) => s.showBoards)
  const showAdmin = useStore((s) => s.showAdmin)
  const showMyWork = useStore((s) => s.showMyWork)
  // The tabs go through the same door the URL does, so a tab and a link mean the same thing.
  const setView = useStore((s) => s.setView)
  const showLegend = useStore((s) => s.showLegend)
  const showFilters = useStore((s) => s.showFilters)
  // The side panels belong to the board surface: the legend and the filters narrow or explain
  // one board, so neither trails into the dashboard, timeline, archive, objectives, the
  // workspace or My work. Leaving for a view keeps the choice — coming back shows it again.
  const boardSurface = useStore(isBoardSurface)
  const showBoardSettings = useStore((s) => s.showBoardSettings)
  const autoArchiveDays = useStore((s) => s.autoArchiveDays)
  const runAutoArchive = useStore((s) => s.runAutoArchive)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)

  const selectBoard = useStore((s) => s.selectBoard)
  const resetDemo = useStore((s) => s.resetDemo)
  const toggleBoardSettings = useStore((s) => s.toggleBoardSettings)
  const beginEdit = useStore((s) => s.beginEdit)
  const moveCard = useStore((s) => s.moveCard)
  const addCard = useStore((s) => s.addCard)

  // The URL: read once for what the link asked for, then kept in step with where the app is —
  // and followed when the back button moves. See `lib/useUrl`.
  useUrl()

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
      else if (s.selectedItemId || s.lensId) s.openItem(null)
    }
    const onDown = (e: MouseEvent) => {
      const s = useStore.getState()
      if (s.multiSelect.length === 0 && !s.selectedItemId && !s.lensId) return
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
      if (s.multiSelect.length > 0) {
        s.clearMultiSelect()
        s.clearLens()
      } else s.openItem(null)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [])

  // A card belongs to a board that renders a cards workflow; a coordination board does not.
  const makesCards = !isAggregating(boards.find((b) => b.id === boardId))

  /**
   * The seam a board's WIP policy intercepts. The place a drop offered travels with it, because
   * a drop is a move *and* a position: a `justify` board holds the move until a reason arrives,
   * and the card must land where it was dropped when the answer comes.
   */
  const requestMove = (itemId: string, bId: string, laneId: string, index?: number) =>
    moveCard(itemId, bId, laneId, { index })

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
      {/* One palette for the whole app: boards, cards and the app's own verbs. It answers to the
          same rule the toolbar's buttons do — a board that renders no cards workflow does not make
          cards — so the two ways in cannot disagree. */}
      <Suspense fallback={null}>
        <CommandPalette onNewCard={quickAdd} onNewInitiative={quickAddInitiative} makesCards={makesCards} />
      </Suspense>
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
        showAdmin={showAdmin}
        showMyWork={showMyWork}
        onSelectBoard={selectBoard}
        onShowBoard={() => setView('board')}
        onShowDashboard={() => setView('dashboard')}
        onShowTimeline={() => setView('timeline')}
        onShowMetrics={() => setView('flow')}
        onShowArchive={() => setView('archive')}
        onShowMyWork={() => setView('mywork')}
        onShowObjectives={() => setView('objectives')}
        onGoToBoards={() => setView('boards')}
        onEditBoard={beginEdit}
        onSaveEdit={saveEdit}
        onCancelEdit={cancelEdit}
        onOpenBoardSettings={toggleBoardSettings}
        onAddCard={quickAdd}
        onAddInitiative={quickAddInitiative}
        onReset={resetDemo}
      />

      <StorageBanner />
      <QuarantineBanner />
      <StaleTabBanner />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <Suspense fallback={<ViewLoading />}>
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
            ) : showAdmin ? (
              <AdminView />
            ) : (
              <BoardView requestMove={requestMove} />
            )}
          </Suspense>
        </div>
        {showLegend && boardSurface ? (
          <BoardLegend />
        ) : showFilters && boardSurface ? (
          <FilterPanel />
        ) : selectedItemId ? (
          <Suspense
            fallback={<aside aria-busy="true" className="h-full w-[460px] shrink-0 border-l border-slate-300 bg-white" />}
          >
            <ItemPanel itemId={selectedItemId} />
          </Suspense>
        ) : null}
      </div>

      {showBoardSettings && (
        <Suspense fallback={null}>
          <BoardSettings />
        </Suspense>
      )}
      <FocusChip />
      <ConfirmDialog />
      <ReasonDialog />
      <BulkActions />
    </div>
  )
}
