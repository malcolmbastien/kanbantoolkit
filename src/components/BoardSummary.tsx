import { useRef, useState } from 'react'
import { Card, type CardParent } from './Card'
import { DroppableCell } from './DroppableCell'
import { LaneSettings } from './LaneSettings'
import {
  blockedBelow,
  checklistProgress,
  decompositionChildren,
  decompositionParent,
  dependenciesOf,
  dependentsOf,
  depth as depthOf,
  lensRole,
  openDescendants,
  rollupOf,
  statusOf,
  uncommittedBelow,
  type Graph,
} from '@/domain/derive'
import { buildRefs, initiativeCellOf } from '@/domain/board'
import { isLeaf, leavesUnder, topLevelLanes } from '@/domain/lanes'
import { BAND_ACCENT, STAGE_ACCENT } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType, Item, Lane, Stage } from '@/domain/types'

type Accent = (typeof BAND_ACCENT)['team']

/**
 * A summary band for the management view: only the board's initiative-level work
 * (items of the Initiative type), grouped by the typed columns of the board's flow.
 *
 * The *section* an initiative sits in is derived — `rollupOf(item).bucket` picks the
 * typed column, so an initiative can never claim a stage its work doesn't have. The
 * *cell* within that section is the user's: their placement names it, and if that
 * placement is stale (the work below moved the rollup on) the initiative simply falls
 * back to the section's first cell. Arrangement, not truth.
 */
export function BoardSummary({
  boardId,
  rootsOnly,
  variant = 'team',
  interactive = false,
}: {
  boardId: string
  rootsOnly?: boolean
  variant?: 'initiatives' | 'team'
  /** Own surface: drag initiatives between cells and edit the flow. Linked bands set this false. */
  interactive?: boolean
}) {
  const boards = useStore((s) => s.boards)
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)
  const users = useStore((s) => s.users)
  const links = useStore((s) => s.links)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const openItem = useStore((s) => s.openItem)
  const lensId = useStore((s) => s.lensId)
  const toggleLens = useStore((s) => s.toggleLens)
  const editMode = useStore((s) => s.editMode)
  const moveInitiative = useStore((s) => s.moveInitiative)

  const graph: Graph = { items, edges, links, placements, lanes }
  const refs = buildRefs(items, issueTypes)
  const accent = BAND_ACCENT[boards.find((b) => b.id === boardId)?.band ?? 'team']
  const typeOf = (typeId: string): IssueType =>
    issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const onBoard = placements
    .filter((p) => p.boardId === boardId)
    .map((p) => items.find((i) => i.id === p.itemId))
    .filter((i): i is Item => Boolean(i))

  // Initiative-level work only — items of the Initiative type. `rootsOnly` restricts to a
  // board's *local* top-level initiatives: ones whose parent is not on this same board, so
  // an initiative can roll up to a top-level initiative on another management board and
  // still appear as top-level on its own board.
  const onBoardIds = new Set(onBoard.map((i) => i.id))
  const initiativeTypeId = issueTypes.find((t) => t.name === 'Initiative')?.id
  const initiatives = (initiativeTypeId
    ? onBoard.filter((i) => i.typeId === initiativeTypeId)
    : onBoard.filter((i) => decompositionChildren(i.id, edges).length > 0)
  ).filter((i) => !i.archived).filter((i) => {
    if (!rootsOnly) return true
    const parent = decompositionParent(i.id, edges)
    return !parent || !onBoardIds.has(parent)
  })

  // A section is a typed column; its cells are its leaves — itself, until it's split.
  const sections = topLevelLanes(lanes, boardId)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((section) => {
      const stage = (section.stage ?? 'inProgress') as Stage
      const cells = leavesUnder(lanes, section.id)
      const inSection = initiatives.filter((i) => initiativeCellOf(i.id, boardId, graph)?.sectionId === section.id)
      const byCell = new Map<string, Item[]>(cells.map((c) => [c.id, []]))
      for (const i of inSection) {
        const cellId = initiativeCellOf(i.id, boardId, graph)?.cellId
        if (cellId && byCell.has(cellId)) byCell.get(cellId)!.push(i)
      }
      return { section, stage, cells, byCell, total: inSection.length }
    })

  if (sections.length === 0) return <p className="p-3 text-[12px] text-slate-500">This board has no typed columns.</p>

  const isInitiatives = variant === 'initiatives'
  const drop = (itemId: string, laneId: string) => moveInitiative(itemId, boardId, laneId)

  const initiativeCard = (c: Item) => {
    const pid = decompositionParent(c.id, edges)
    const p = pid ? items.find((i) => i.id === pid) : undefined
    const parent: CardParent | undefined = p
      ? { id: p.id, ref_: refs.get(p.id) ?? '', title: p.title, type: typeOf(p.typeId) }
      : undefined
    const childItems = decompositionChildren(c.id, edges)
      .map((id) => items.find((i) => i.id === id))
      .filter((i): i is Item => Boolean(i))
      .filter((i) => !i.archived)
    // Symbols summarise the direct children — team initiatives for a top-level
    // initiative, cards for a team-level one — coloured by their status.
    const symbols = childItems.map((ci) => ({ bucket: rollupOf(ci.id, graph).bucket, title: ci.title }))
    return (
      <Card
        key={c.id}
        item={c}
        type={typeOf(c.typeId)}
        ref_={refs.get(c.id) ?? ''}
        depth={depthOf(c.id, graph)}
        parent={parent}
        wide
        users={users}
        symbols={symbols}
        blockedTone={isInitiatives ? 'aggregate' : 'detail'}
        selected={selectedItemId === c.id}
        lens={lensRole(c.id, lensId, graph)}
        onLens={toggleLens}
        draggable={interactive}
        locked={editMode}
        onOpen={openItem}
        summary={{
          childCount: decompositionChildren(c.id, edges).length,
          dependentsCount: dependentsOf(c.id, graph).filter((d) => !statusOf(d.dependent.id, graph).resolved).length,
          linksCount: dependenciesOf(c.id, graph).length + dependentsOf(c.id, graph).length,
          blockedBelow: blockedBelow(c.id, graph),
          uncommittedBelow: uncommittedBelow(c.id, graph),
          openDescendants: openDescendants(c.id, graph).length,
          rollupPercent: rollupOf(c.id, graph).percent,
          checklist: checklistProgress(c),
        }}
      />
    )
  }

  const empty = <p className="px-1 py-2 text-[10px] text-slate-400">No initiatives</p>

  return (
    <div className="flex gap-2 p-2">
      {sections.map(({ section, stage, cells, byCell, total }) => {
        const split = cells.length > 1
        return (
          <Cell
            key={section.id}
            lane={section}
            isSection
            primary
            count={total}
            droppable={!split}
            isInitiatives={isInitiatives}
            accent={accent}
            interactive={interactive}
            editMode={editMode}
            onDrop={(itemId) => drop(itemId, section.id)}
            style={{ borderTop: `4px solid ${STAGE_ACCENT[stage]}` }}
            className={cn(
              'flex flex-1 basis-0 flex-col overflow-hidden rounded-md border',
              // An unsplit section is the column; a split one grows to fit its cells.
              !split && 'min-w-[320px]',
              isInitiatives ? accent.column : 'border-slate-300 bg-slate-100',
            )}
          >
            {split
              ? cells.map((cell) => {
                  const cards = byCell.get(cell.id) ?? []
                  return (
                    <Cell
                      key={cell.id}
                      lane={cell}
                      count={cards.length}
                      droppable
                      isInitiatives={isInitiatives}
                      accent={accent}
                      interactive={interactive}
                      editMode={editMode}
                      onDrop={(itemId) => drop(itemId, cell.id)}
                    >
                      {cards.map(initiativeCard)}
                      {cards.length === 0 && empty}
                    </Cell>
                  )
                })
              : (() => {
                  const cards = byCell.get(section.id) ?? []
                  return (
                    <>
                      {cards.map(initiativeCard)}
                      {cards.length === 0 && empty}
                    </>
                  )
                })()}
          </Cell>
        )
      })}
    </div>
  )
}

/**
 * One cell of the initiatives flow. An unsplit section's cell *is* the column, so it
 * wears the column header; a split section's cells get the lighter sub-header.
 */
function Cell({
  lane,
  isSection,
  primary,
  count,
  droppable,
  isInitiatives,
  accent,
  interactive,
  editMode,
  onDrop,
  className,
  style,
  children,
}: {
  lane: Lane
  isSection?: boolean
  primary?: boolean
  count: number
  droppable: boolean
  isInitiatives: boolean
  accent: Accent
  interactive: boolean
  editMode: boolean
  onDrop: (itemId: string) => void
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const lanes = useStore((s) => s.lanes)
  const splitLane = useStore((s) => s.splitLane)
  const removeLane = useStore((s) => s.removeLane)
  const renameLane = useStore((s) => s.renameLane)
  const setLaneWip = useStore((s) => s.setLaneWip)
  const setLaneDescription = useStore((s) => s.setLaneDescription)
  const askConfirm = useStore((s) => s.askConfirm)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const editable = interactive && editMode
  const leaf = isLeaf(lanes, lane.id)

  const head = primary
    ? cn('flex items-center gap-1.5 px-2 py-1', isInitiatives ? accent.columnHeader : 'bg-slate-700 text-slate-100')
    : 'mb-1 flex items-center gap-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-slate-600'

  const removeWithConfirm = () => {
    const kids = leavesUnder(lanes, lane.id).filter((l) => l.id !== lane.id)
    const target = kids[0]
    askConfirm({
      title: `Remove ${lane.name || 'this cell'}?`,
      body: target
        ? `Its initiatives move to "${target.name}", and the cell is deleted.`
        : 'Its initiatives move to a neighbouring cell, and the cell is deleted.',
      confirmLabel: 'Remove',
      onConfirm: () => removeLane(lane.id),
    })
  }

  return (
    <div className={className ?? 'flex min-w-[300px] flex-1 basis-0 flex-col'} style={style}>
      <div className={head}>
        <span className={cn('truncate font-bold uppercase tracking-wide', primary ? 'text-[11px]' : 'text-[10px]')}>
          {lane.name}
        </span>
        {editable && (
          <span className="flex shrink-0 items-center gap-0.5">
            {leaf && (
              <>
                <Ctl light={!primary} title="Split this cell into columns" onClick={() => splitLane(lane.id, 'columns')}>
                  ▤
                </Ctl>
                <Ctl light={!primary} title="Split this cell into rows" onClick={() => splitLane(lane.id, 'rows')}>
                  ▥
                </Ctl>
              </>
            )}
            <Ctl
              light={!primary}
              btnRef={btnRef}
              active={settingsOpen}
              title="Lane settings — name, WIP limit, policy"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              ⚙
            </Ctl>
          </span>
        )}
        <span
          className={cn(
            'ml-auto shrink-0 text-[10px] font-semibold tabular-nums',
            primary ? (isInitiatives ? accent.columnCount : 'text-slate-300/80') : 'text-slate-500',
          )}
        >
          {count}
        </span>
      </div>

      {droppable ? (
        <DroppableCell laneId={lane.id} enabled={interactive && !editMode} onDropItem={onDrop}>
          {children}
        </DroppableCell>
      ) : (
        <div className="flex min-w-min flex-1 gap-2 p-2">{children}</div>
      )}

      {settingsOpen && (
        <LaneSettings
          lane={lane}
          top={Boolean(isSection)}
          anchorRef={btnRef}
          onClose={() => setSettingsOpen(false)}
          rename={(name) => renameLane(lane.id, name)}
          setWip={(w) => setLaneWip(lane.id, w)}
          setPolicy={(text) => setLaneDescription(lane.id, text)}
          remove={() => {
            setSettingsOpen(false)
            removeWithConfirm()
          }}
        />
      )}
    </div>
  )
}

/** A tiny edit button. `light` for the pale sub-headers, dark otherwise. */
function Ctl({
  children,
  onClick,
  title,
  active,
  light,
  btnRef,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  active?: boolean
  light?: boolean
  btnRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={btnRef}
      onClick={onClick}
      title={title}
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-semibold transition',
        active
          ? 'bg-indigo-400 text-white'
          : light
            ? 'bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50'
            : 'bg-white/10 text-slate-200 hover:bg-white/25',
      )}
    >
      {children}
    </button>
  )
}
