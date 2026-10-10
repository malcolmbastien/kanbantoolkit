import { useEffect, useState } from 'react'
import { BoardView } from './components/BoardView'
import { DemoGuide } from './components/DemoGuide'
import { ItemPanel } from './components/ItemPanel'
import { ReasonDialog } from './components/ReasonDialog'
import { TopBar } from './components/TopBar'
import { TypeEditor } from './components/TypeEditor'
import { leafLanes } from './domain/lanes'
import { useStore } from './store'
import type { Lane } from './domain/types'

interface Pending {
  title: string
  lane: Lane
  count: number
  run: (reason: string) => void
}

export default function App() {
  const boards = useStore((s) => s.boards)
  const boardId = useStore((s) => s.boardId)
  const search = useStore((s) => s.search)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const showDemoGuide = useStore((s) => s.showDemoGuide)
  const showTypeEditor = useStore((s) => s.showTypeEditor)
  const items = useStore((s) => s.items)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)

  const selectBoard = useStore((s) => s.selectBoard)
  const setSearch = useStore((s) => s.setSearch)
  const resetDemo = useStore((s) => s.resetDemo)
  const toggleDemoGuide = useStore((s) => s.toggleDemoGuide)
  const toggleTypeEditor = useStore((s) => s.toggleTypeEditor)
  const openItem = useStore((s) => s.openItem)
  const moveCard = useStore((s) => s.moveCard)
  const addCard = useStore((s) => s.addCard)

  const [pending, setPending] = useState<Pending | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const b = params.get('board')
    const it = params.get('item')
    if (b) selectBoard(b)
    if (it) openItem(it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const requestMove = (itemId: string, bId: string, columnLaneId: string, rowLaneId: string | null) => {
    const item = items.find((i) => i.id === itemId)
    const res = moveCard(itemId, bId, columnLaneId, rowLaneId)
    if (!res.ok && 'needsReason' in res) {
      setPending({
        title: item?.title ?? 'Card',
        lane: res.lane,
        count: res.count,
        run: (reason) => moveCard(itemId, bId, columnLaneId, rowLaneId, reason),
      })
    } else if (!res.ok && 'blocked' in res) {
      window.alert('Hard WIP limit reached — the move is not allowed.')
    }
  }

  const onAddCard = (columnLaneId: string, rowLaneId: string | null) => {
    const typeId = issueTypes[0]?.id
    if (!typeId) return
    addCard({ boardId, typeId, columnLaneId, rowLaneId, title: 'New card' })
  }

  const quickAdd = () => {
    const firstCol = leafLanes(lanes, boardId, 'vertical')[0]
    const firstRow = leafLanes(lanes, boardId, 'horizontal')[0]
    if (firstCol) onAddCard(firstCol.id, firstRow?.id ?? null)
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar
        boards={boards}
        boardId={boardId}
        search={search}
        showDemoGuide={showDemoGuide}
        onSelectBoard={selectBoard}
        onSearch={setSearch}
        onToggleDemoGuide={toggleDemoGuide}
        onOpenTypes={toggleTypeEditor}
        onAddCard={quickAdd}
        onReset={resetDemo}
      />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <BoardView requestMove={requestMove} onAddCard={onAddCard} />
        </div>
        {selectedItemId && <ItemPanel itemId={selectedItemId} />}
      </div>

      <DemoGuide />
      {showTypeEditor && <TypeEditor />}

      {pending && (
        <ReasonDialog
          title={pending.title}
          lane={pending.lane}
          count={pending.count}
          onCancel={() => setPending(null)}
          onSubmit={(reason) => {
            pending.run(reason)
            setPending(null)
          }}
        />
      )}
    </div>
  )
}
