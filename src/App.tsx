import { useEffect, useState } from 'react'
import { BoardView } from './components/BoardView'
import { DemoGuide } from './components/DemoGuide'
import { ItemPanel } from './components/ItemPanel'
import { PortfolioStrip } from './components/PortfolioStrip'
import { ReasonDialog } from './components/ReasonDialog'
import { TopBar } from './components/TopBar'
import { homeScopeId } from './domain/board'
import { useStore } from './store'
import type { Item, LimitPolicy } from './domain/types'

interface Pending {
  label: string
  policy: LimitPolicy
  count: number
  run: (reason: string) => void
}

export default function App() {
  const boards = useStore((s) => s.boards)
  const scopes = useStore((s) => s.scopes)
  const items = useStore((s) => s.items)
  const boardId = useStore((s) => s.boardId)
  const resolution = useStore((s) => s.resolution)
  const scopeId = useStore((s) => s.scopeId)
  const search = useStore((s) => s.search)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const showDemoGuide = useStore((s) => s.showDemoGuide)

  const selectBoard = useStore((s) => s.selectBoard)
  const setResolution = useStore((s) => s.setResolution)
  const setScope = useStore((s) => s.setScope)
  const setSearch = useStore((s) => s.setSearch)
  const resetDemo = useStore((s) => s.resetDemo)
  const toggleDemoGuide = useStore((s) => s.toggleDemoGuide)
  const moveItem = useStore((s) => s.moveItem)
  const addEpic = useStore((s) => s.addEpic)
  const addItem = useStore((s) => s.addItem)
  const setItemFields = useStore((s) => s.setItemFields)
  const openItem = useStore((s) => s.openItem)

  const [pending, setPending] = useState<Pending | null>(null)

  // Deep links: ?board=<id>&item=<id>&resolution=L2 — one graph, addressable views.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const b = params.get('board')
    const it = params.get('item')
    const r = params.get('resolution')
    if (b) selectBoard(b)
    if (r) setResolution(r as typeof resolution)
    if (it) openItem(it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Resolve a scope id into the (value stream, team) an item should carry. */
  const targetScope = (sid: string): { valueStreamId: string; teamId: string | null } => {
    const scope = scopes.find((s) => s.id === sid)
    const firstStream = scopes.find((s) => s.kind === 'value_stream')!.id
    if (!scope) return { valueStreamId: firstStream, teamId: null }
    if (scope.kind === 'team') return { valueStreamId: scope.parentId ?? firstStream, teamId: scope.id }
    if (scope.kind === 'value_stream') return { valueStreamId: scope.id, teamId: null }
    return { valueStreamId: firstStream, teamId: null }
  }

  const applyMove = (itemId: string, toScopeId: string, toState: string, reason?: string) => {
    const item = items.find((i) => i.id === itemId)
    if (!item) return { ok: true } as const
    const curHome = homeScopeId(item, resolution)
    let patch: Partial<Item> = {}
    if (toScopeId && toScopeId !== curHome && toScopeId !== item.valueStreamId) {
      const scope = scopes.find((s) => s.id === toScopeId)
      if (scope?.kind === 'team') patch = { teamId: scope.id, valueStreamId: scope.parentId ?? item.valueStreamId }
      else if (scope?.kind === 'value_stream') patch = { teamId: null, valueStreamId: scope.id }
    }
    const res = moveItem(itemId, toState, reason)
    if (res.ok && Object.keys(patch).length) setItemFields(itemId, patch)
    return res
  }

  const requestMove = (itemId: string, toScopeId: string, toState: string) => {
    const item = items.find((i) => i.id === itemId)
    const res = applyMove(itemId, toScopeId, toState)
    if (!res.ok && 'needsReason' in res) {
      setPending({
        label: item?.title ?? 'Card',
        policy: res.policy,
        count: res.count,
        run: (reason) => applyMove(itemId, toScopeId, toState, reason),
      })
    } else if (!res.ok && 'blocked' in res) {
      window.alert('Hard limit reached — the move is not allowed.')
    }
  }

  const requestAddEpic = () => {
    const { valueStreamId, teamId } = targetScope(scopeId)
    const title = 'New epic'
    const res = addEpic(valueStreamId, teamId, title)
    if (!res.ok && 'needsReason' in res) {
      setPending({
        label: `New epic in ${scopes.find((s) => s.id === valueStreamId)?.name ?? valueStreamId}`,
        policy: res.policy,
        count: res.count,
        run: (reason) => addEpic(valueStreamId, teamId, title, reason),
      })
    }
  }

  const requestAddStory = () => {
    const { valueStreamId, teamId } = targetScope(scopeId)
    addItem({ type: 'story', valueStreamId, teamId, title: 'New story' })
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar
        boards={boards}
        scopes={scopes}
        boardId={boardId}
        resolution={resolution}
        scopeId={scopeId}
        search={search}
        showDemoGuide={showDemoGuide}
        onSelectBoard={selectBoard}
        onSetResolution={setResolution}
        onSetScope={setScope}
        onSearch={setSearch}
        onReset={resetDemo}
        onToggleDemoGuide={toggleDemoGuide}
        onAddEpic={requestAddEpic}
        onAddStory={requestAddStory}
      />

      {resolution === 'L1' && <PortfolioStrip />}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <BoardView requestMove={requestMove} />
        </div>
        {selectedItemId && <ItemPanel itemId={selectedItemId} requestMove={requestMove} />}
      </div>

      <DemoGuide />

      {pending && (
        <ReasonDialog
          title={pending.label}
          policy={pending.policy}
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
