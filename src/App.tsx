import { useEffect } from 'react'
import { ArchiveView } from './components/ArchiveView'
import { BoardView } from './components/BoardView'
import { ItemPanel } from './components/ItemPanel'
import { ManagementDashboard } from './components/ManagementDashboard'
import { ObjectivesView } from './components/ObjectivesView'
import { TopBar } from './components/TopBar'
import { TypeEditor } from './components/TypeEditor'
import { defaultCardTypeId } from './domain/board'
import { leafLanes } from './domain/lanes'
import { useStore } from './store'

export default function App() {
  const boards = useStore((s) => s.boards)
  const boardId = useStore((s) => s.boardId)
  const boardLevel = boards.find((b) => b.id === boardId)?.level ?? 'team'
  const setBoardLevel = useStore((s) => s.setBoardLevel)
  const search = useStore((s) => s.search)
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
    const typeId = defaultCardTypeId(issueTypes)
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
        search={search}
        editMode={editMode}
        showObjectives={showObjectives}
        showDashboard={showDashboard}
        showArchive={showArchive}
        onSelectBoard={selectBoard}
        onSetBoardLevel={(l) => setBoardLevel(boardId, l)}
        onToggleObjectives={toggleObjectives}
        onToggleDashboard={toggleDashboard}
        onToggleArchive={toggleArchive}
        onSearch={setSearch}
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
        {selectedItemId && <ItemPanel itemId={selectedItemId} />}
      </div>

      {showTypeEditor && <TypeEditor />}
    </div>
  )
}
