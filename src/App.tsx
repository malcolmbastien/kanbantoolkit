import { useEffect } from 'react'
import { ArchiveView } from './components/ArchiveView'
import { BoardView } from './components/BoardView'
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
  const boardLevel = boards.find((b) => b.id === boardId)?.level ?? 'team'
  const setBoardLevel = useStore((s) => s.setBoardLevel)
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
  const setArchive = useStore((s) => s.setArchive)
  const showFilters = useStore((s) => s.showFilters)
  const filters = useStore((s) => s.filters)
  const toggleFilters = useStore((s) => s.toggleFilters)
  const toggleCollapse = useStore((s) => s.toggleCollapse)
  const autoArchiveDays = useStore((s) => s.autoArchiveDays)
  const runAutoArchive = useStore((s) => s.runAutoArchive)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)

  const selectBoard = useStore((s) => s.selectBoard)
  const setSearch = useStore((s) => s.setSearch)
  const resetDemo = useStore((s) => s.resetDemo)
  const toggleTypeEditor = useStore((s) => s.toggleTypeEditor)
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

  const onNewBoard = () => {
    const name = window.prompt('New board name', 'New board')
    if (name) addBoard(name)
  }
  const onDeleteBoard = () => {
    if (window.confirm('Delete this board and its cards?')) removeBoard(boardId)
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar
        boards={boards}
        boardId={boardId}
        boardLevel={boardLevel}
        editMode={editMode}
        showObjectives={showObjectives}
        showDashboard={showDashboard}
        showArchive={showArchive}
        showFilters={showFilters}
        activeFilterCount={activeFilterCount(filters)}
        onSelectBoard={selectBoard}
        onSetBoardLevel={(l) => setBoardLevel(boardId, l)}
        onToggleObjectives={toggleObjectives}
        onToggleDashboard={toggleDashboard}
        onToggleArchive={toggleArchive}
        onToggleFilters={toggleFilters}
        onEditBoard={beginEdit}
        onSaveEdit={saveEdit}
        onCancelEdit={cancelEdit}
        onOpenTypes={toggleTypeEditor}
        onAddCard={quickAdd}
        onNewBoard={onNewBoard}
        onDeleteBoard={onDeleteBoard}
        onReset={resetDemo}
      />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {showArchive ? (
            <ArchiveView />
          ) : showObjectives ? (
            <ObjectivesView />
          ) : showDashboard && boardLevel === 'portfolio' ? (
            <ManagementDashboard boardId={boardId} />
          ) : (
            <BoardView requestMove={requestMove} />
          )}
        </div>
        {showFilters ? <FilterPanel /> : selectedItemId ? <ItemPanel itemId={selectedItemId} /> : null}
      </div>

      {showTypeEditor && <TypeEditor />}
    </div>
  )
}
