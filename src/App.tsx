import { lazy, Suspense, useEffect } from 'react'
import { BoardView } from './components/BoardView'
import { StorageBanner } from './components/StorageBanner'
import { QuarantineBanner } from './components/QuarantineBanner'
import { StaleTabBanner } from './components/StaleTabBanner'
import { Announcer } from './components/Announcer'

import { Overlays } from './components/Overlays'
import { TopBar } from './components/TopBar'
import { boardCardTypeId, canAddInitiative, initiativeTypeId, isAggregating } from './domain/board'
import { cardsFlows, initiativesFlow } from './domain/flows'
import { leafLanes } from './domain/lanes'
import { useUrl } from './lib/useUrl'
import { useSignedInPerson } from './lib/identity'
import { useStructureSync } from './lib/structure'
import { useVocabularySync } from './lib/vocabularySync'
import { isBoardSurface, useStore } from './store'
import { viewOf } from './lib/url'
import { headingFor } from './lib/title'

/**
 * The board is the app's own path, so it is downloaded with the app. The workspace home — the
 * default screen — and every other screen are fetched the first time they are drawn.
 *
 * The placeholder is full height on purpose. It is what the screen will occupy, so a slow
 * connection shows a gap that is about to fill rather than a page that jumps when it does.
 */
const BoardWorkspace = lazy(() => import('./components/BoardWorkspace').then((m) => ({ default: m.BoardWorkspace })))
const ArchiveView = lazy(() => import('./components/ArchiveView').then((m) => ({ default: m.ArchiveView })))
const MyWorkView = lazy(() => import('./components/MyWorkView').then((m) => ({ default: m.MyWorkView })))
const ManagementDashboard = lazy(() => import('./components/ManagementDashboard').then((m) => ({ default: m.ManagementDashboard })))
const MetricsView = lazy(() => import('./components/MetricsView').then((m) => ({ default: m.MetricsView })))
const TimelineView = lazy(() => import('./components/TimelineView').then((m) => ({ default: m.TimelineView })))
const AdminView = lazy(() => import('./components/AdminView').then((m) => ({ default: m.AdminView })))
const ItemPanel = lazy(() => import('./components/ItemPanel').then((m) => ({ default: m.ItemPanel })))
const CommandPalette = lazy(() => import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette })))
const BoardSettings = lazy(() => import('./components/BoardSettings').then((m) => ({ default: m.BoardSettings })))
const BulkActions = lazy(() => import('./components/BulkActions').then((m) => ({ default: m.BulkActions })))
const FilterPanel = lazy(() => import('./components/FilterPanel').then((m) => ({ default: m.FilterPanel })))
const ConfirmDialog = lazy(() => import('./components/ConfirmDialog').then((m) => ({ default: m.ConfirmDialog })))
const ReasonDialog = lazy(() => import('./components/ReasonDialog').then((m) => ({ default: m.ReasonDialog })))

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
  const showMetrics = useStore((s) => s.showMetrics)
  const showDashboard = useStore((s) => s.showDashboard)
  const showArchive = useStore((s) => s.showArchive)
  const showTimeline = useStore((s) => s.showTimeline)
  const showBoards = useStore((s) => s.showBoards)
  const showAdmin = useStore((s) => s.showAdmin)
  const showMyWork = useStore((s) => s.showMyWork)
  const multiSelect = useStore((s) => s.multiSelect)
  const confirm = useStore((s) => s.confirm)
  const wipPrompt = useStore((s) => s.wipPrompt)
  // The tabs go through the same door the URL does, so a tab and a link mean the same thing.
  const setView = useStore((s) => s.setView)
  const showFilters = useStore((s) => s.showFilters)
  const view = useStore(viewOf)
  const heading = headingFor({ view, board: boards.find((board) => board.id === boardId)?.name })
  // The filter panel belongs to the board surface: it narrows one board, so it does not trail
  // into the dashboard, timeline, archive, objectives, the workspace or My work. Leaving for a
  // view keeps the choice — coming back shows it again.
  const boardSurface = useStore(isBoardSurface)
  const showBoardSettings = useStore((s) => s.showBoardSettings)
  const runAutoArchive = useStore((s) => s.runAutoArchive)
  const lanes = useStore((s) => s.lanes)
  const flows = useStore((s) => s.flows)
  const issueTypes = useStore((s) => s.issueTypes)

  const selectBoard = useStore((s) => s.selectBoard)
  const toggleBoardSettings = useStore((s) => s.toggleBoardSettings)
  const beginEdit = useStore((s) => s.beginEdit)
  const moveCard = useStore((s) => s.moveCard)
  const addCard = useStore((s) => s.addCard)

  // The URL: read once for what the link asked for, then kept in step with where the app is —
  // and followed when the back button moves. See `lib/useUrl`.
  useUrl()

  // Who this browser is, when an account says so: the workspace's own person, kept in step with
  // the session so "My work" and the author of a change read the account that is signed in.
  useSignedInPerson()

  // The board design — boards, lanes, placements — is one document on the server, written when it
  // changes. Items have their own path; this is the half that has no item to hang on.
  useStructureSync()

  // The workspace's words — types, templates, objectives and key results — are a second document,
  // with a revision of its own. Nothing in one write can rename what the other is arranging.
  useVocabularySync()

  // Auto-archive: finished work is filed a week after it is done. A product constant, not a
  // setting, so this runs when the workspace opens rather than when somebody changes a number.
  useEffect(() => {
    runAutoArchive()
  }, [runAutoArchive])

  // Escape, or a click on any empty part of the screen, dismisses the topmost
  // layer: a confirm dialog or card menu handles its own; otherwise the current
  // selection — a multi-select group, or a single card open in the panel.
  // Clicks on a card or an item row (to toggle/open it), the bulk bar, or a panel are left alone.
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
        target?.closest('[data-item-row]') ||
        target?.closest('[data-bulk-actions]') ||
        target?.closest('[data-item-panel]') ||
        target?.closest('[data-item-picker]') ||
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
  // A portfolio connects the initiatives that already exist rather than making new ones,
  // so neither the palette nor the toolbar offers a way to make one there.
  const addsInitiatives = canAddInitiative(boards.find((b) => b.id === boardId))

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
   * A new card, in a cards workflow the toolbar named — or the first one when it has not.
   *
   * The card lands in that flow's first cell: the backlog is where work is made, and the other
   * columns are downstream. The toolbar's chooser is the only place a flow is chosen for this
   * button; the board's own footer sits in the Backlog cell it would add to.
   */
  const cardFlows = cardsFlows(flows, boardId).filter((flow) => leafLanes(lanes, flow.id).length > 0)
  const quickAdd = (flowId?: string) => {
    const flow = cardFlows.find((f) => f.id === flowId) ?? cardFlows[0]
    const lane = flow ? leafLanes(lanes, flow.id)[0] : undefined
    if (lane) onAddCard(lane.id)
  }

  /**
   * A new initiative, in the first cell of the board's initiatives workflow.
   *
   * The mirror of `quickAdd`, and it has to be: an initiative is not a card with a different
   * label — it lives in the other lane tree, in a cell of a section, and the Initiative type is
   * the one type a person never chooses. Which is exactly why the button matters, since until
   * now the only way to make one was to link it from another board.
   *
   * Not on a portfolio, which has no initiative of its own to make: it is read for the ones that
   * already exist, connected to an objective in the strategy map. Refused here, the one door the
   * toolbar's button and the palette's verb both come through.
   */
  const quickAddInitiative = () => {
    if (!addsInitiatives) return
    const typeId = initiativeTypeId(issueTypes)
    const flow = initiativesFlow(flows, boardId)
    const firstLeaf = flow ? leafLanes(lanes, flow.id)[0] : undefined
    if (!typeId || !firstLeaf) return
    addCard({ boardId, typeId, laneId: firstLeaf.id, title: 'New initiative' })
  }

  /**
   * The workspace home is a way out of the board, and an open board design is an unsaved draft.
   * Going home while it is open must say that, and the confirmation is the only thing that ends
   * the draft: cancelling the dialog leaves the reader exactly where they were.
   */
  const goToBoards = () => {
    const state = useStore.getState()
    if (!state.editMode) {
      setView('boards')
      return
    }
    state.askConfirm({
      title: 'Leave design?',
      body: 'Unsaved changes lost.',
      confirmLabel: 'Discard',
      danger: true,
      onConfirm: () => {
        const after = useStore.getState()
        after.cancelEdit()
        after.setView('boards')
      },
    })
  }


  return (
    <div className="flex h-full flex-col">
      {/* One host for the menu and the pick chips, so every surface has them — an aggregating
          board renders no BoardCanvas, and used to get neither. */}
      <Overlays />
      {/* What a sighted person sees, said out loud: a drag that landed, a drop the board
          refused, a warning that arrived. One region for the whole app. */}
      <Announcer />
      {/* One palette for the whole app: boards, cards and the app's own verbs. It answers to the
          same rules the toolbar's buttons do — a board that renders no cards workflow does not make
          cards, and a portfolio connects initiatives rather than making them — so the two ways in
          cannot disagree. */}
      <Suspense fallback={null}>
        <CommandPalette onNewCard={quickAdd} onNewInitiative={quickAddInitiative} onGoToBoards={goToBoards} makesCards={makesCards} addsInitiatives={addsInitiatives} />
      </Suspense>
      <TopBar
        boards={boards}
        boardId={boardId}
        editMode={editMode}
        showDashboard={showDashboard}
        showTimeline={showTimeline}
        showArchive={showArchive}
        showMetrics={showMetrics}
        showBoards={showBoards}
        showAdmin={showAdmin}
        onSelectBoard={selectBoard}
        onShowBoard={() => setView('board')}
        onShowDashboard={() => setView('dashboard')}
        onShowTimeline={() => setView('timeline')}
        onShowMetrics={() => setView('flow')}
        onShowArchive={() => setView('archive')}
        onGoToBoards={goToBoards}
        onEditBoard={beginEdit}
        onSaveEdit={saveEdit}
        onCancelEdit={cancelEdit}
        onOpenBoardSettings={toggleBoardSettings}
        cardFlows={cardFlows.map(({ id, name }) => ({ id, name }))}
        onAddCard={quickAdd}
        onAddInitiative={quickAddInitiative}
      />

      <StorageBanner />
      <QuarantineBanner />
      <StaleTabBanner />

      <div className="flex min-h-0 flex-1">
        <main aria-label={heading} className="min-w-0 flex-1">
          {view !== 'boards' && view !== 'admin' && (
            <h1 className="sr-only">
              {heading}
            </h1>
          )}
          <Suspense fallback={<ViewLoading />}>
            {showBoards ? (
              <BoardWorkspace />
            ) : showArchive ? (
              <ArchiveView />
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
        </main>
        {showMyWork ? (
          <Suspense
            fallback={<aside aria-busy="true" className="h-full w-[420px] shrink-0 border-l border-slate-300 bg-slate-100" />}
          >
            <MyWorkView />
          </Suspense>
        ) : showFilters && boardSurface ? (
          <Suspense fallback={<aside aria-busy="true" className="h-full w-[420px] shrink-0 border-l border-slate-300 bg-slate-100" />}>
            <FilterPanel />
          </Suspense>
        ) : selectedItemId ? (
          <Suspense
            fallback={<aside aria-busy="true" className="h-full w-[460px] shrink-0 border-l border-slate-300 bg-white" />}
          >
            <ItemPanel key={selectedItemId} itemId={selectedItemId} />
          </Suspense>
        ) : null}
      </div>

      {showBoardSettings && (
        <Suspense fallback={null}>
          <BoardSettings />
        </Suspense>
      )}
      {confirm && (
        <Suspense fallback={null}>
          <ConfirmDialog />
        </Suspense>
      )}
      {wipPrompt && (
        <Suspense fallback={null}>
          <ReasonDialog />
        </Suspense>
      )}
      {multiSelect.length > 0 && (
        <Suspense fallback={null}>
          <BulkActions />
        </Suspense>
      )}
    </div>
  )
}
