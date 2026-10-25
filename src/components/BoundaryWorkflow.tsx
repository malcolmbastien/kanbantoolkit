import { useEffect, useState } from 'react'
import { ArrowUpRight, Link2, Rows3 } from 'lucide-react'
import { boundaryInStage, boundaryEntries, type BoundaryEntry } from '@/domain/boundary'
import { STAGES, STAGE_LABELS } from '@/domain/lanes'
import { chipColors, DEP_STATE_STYLES, STAGE_ACCENT, STAGE_DOT, STAGE_SURFACE } from '@/lib/colors'
import { announce } from '@/lib/announce'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType } from '@/domain/types'

/**
 * The boundary workflow (task 174): the external work this board is waiting on, as a flow.
 *
 * It used to be a sticky rail on the right — a list outside the lane tree, with no stages, and thin
 * dashed curves to the cards that waited on it. Both ends of the relationship now say so in words:
 * a boundary card names its dependents, and each dependent card wears a "Waiting on …" chip that
 * targets the boundary card. The workflow is below the cards, in the same four typed stages as
 * everything else, because a reader who has learned the board should not learn a second shape for
 * the edge of it.
 *
 * It is a **lens**, not a third lane tree: no placement is created, nothing is dragged here, and the
 * column a card sits in is the dependency's own rollup, read from the board it lives on. That is why
 * nothing in this file writes.
 */

const SCROLL = { block: 'nearest', behavior: 'smooth' } as const

/** Bring an element into view if it is on screen; a no-op in a test or before paint. */
function reveal(selector: string) {
  try {
    document.querySelector<HTMLElement>(selector)?.scrollIntoView(SCROLL)
  } catch {
    // A surface without layout (a unit test) simply does not scroll.
  }
}

/** Select a boundary card and take the reader to it — the direction a dependent's chip travels. */
export function focusBoundary(dependencyId: string, title: string) {
  announce(`Boundary: ${title}. Its cards on this board are highlighted.`)
  reveal(`[data-boundary-card="${dependencyId}"]`)
}

export function BoundaryWorkflow({ boardId }: { boardId: string }) {
  const items = useStore((s) => s.items)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const boards = useStore((s) => s.boards)
  const issueTypes = useStore((s) => s.issueTypes)
  const edges = useStore((s) => s.edges)
  const boundaryId = useStore((s) => s.boundaryId)

  const graph = { items, edges, links, placements, lanes }
  const entries = boundaryEntries(graph, boardId)

  // A selected boundary card is brought into view when the selection came from elsewhere — a
  // dependent's chip above, or a `?boundary=` deep link. `block: 'nearest'` means a card that is
  // already on screen does not move, so selecting from this workflow never scrolls away from the
  // card that was just pressed.
  useEffect(() => {
    if (boundaryId) reveal(`[data-boundary-card="${boundaryId}"]`)
  }, [boundaryId])

  if (entries.length === 0) return null

  const count = entries.filter((entry) => entry.state !== 'Closed' && entry.state !== 'Satisfied').length
  const boardName = (id: string | undefined) => boards.find((b) => b.id === id)?.name ?? 'another board'
  const typeOf = (id: string): IssueType => issueTypes.find((t) => t.id === id) ?? { id, name: 'Item', color: '#64748b' }

  return (
    <section data-workflow="boundary" aria-labelledby="boundary-workflow-title" className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200/90 bg-amber-50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-600" />
          <h2 id="boundary-workflow-title" className="shrink-0 text-body font-bold uppercase tracking-wide text-slate-900">
            Boundary — waiting on
          </h2>
          <span className="hidden shrink-0 rounded-full bg-white px-2 py-0.5 text-micro font-semibold text-slate-600 ring-1 ring-amber-200 sm:inline">
            {countLabel(entries.length)}
          </span>
          <span className="truncate text-meta text-slate-600">
            external work this board waits on — read from where it lives, never moved here
          </span>
        </div>
        <span className="hidden shrink-0 text-micro text-slate-600 sm:inline">
          {count} open · {entries.length - count} cleared
        </span>
      </div>

      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((stage) => {
          const inStage = boundaryInStage(entries, stage)
          return (
            <div
              key={stage}
              data-boundary-stage={stage}
              role="group"
              aria-label={`${STAGE_LABELS[stage]} — boundary`}
              className={cn('flex min-h-[140px] flex-col overflow-hidden rounded-xl border border-slate-300/80 shadow-sm', STAGE_SURFACE[stage])}
              style={{ borderTop: `4px solid ${STAGE_ACCENT[stage]}` }}
            >
              <div className="mx-1 mt-1 mb-0.5 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1.5 shadow-sm">
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1">
                  <span className={cn('h-1.5 w-1.5 rounded-full', STAGE_DOT[stage])} />
                  <span className="text-center text-meta font-bold uppercase leading-tight tracking-wide text-slate-800">
                    {STAGE_LABELS[stage]}
                  </span>
                  <span className="rounded-full bg-white px-1.5 py-0.5 text-micro font-bold tabular-nums text-slate-600 ring-1 ring-slate-300/70">
                    {inStage.length}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2 p-1.5">
                {inStage.map((entry) => (
                  <BoundaryCard key={entry.dependency.id} entry={entry} homeBoard={boardName(entry.homeBoardId)} type={typeOf(entry.dependency.typeId)} selected={boundaryId === entry.dependency.id} />
                ))}
                {inStage.length === 0 && (
                  <p className="px-1 py-4 text-center text-micro text-slate-500">Nothing waiting here.</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

const countLabel = (n: number) => `${n} ${n === 1 ? 'dependency' : 'dependencies'}`

/**
 * One external dependency, in its own column.
 *
 * Three things, in the order a reader asks them: what is it (type, name), what is the link doing
 * (state), and **which of my cards wait on it** (named, each a real target). The last is the one the
 * rail never gave: it named the first dependent and counted the rest.
 */
function BoundaryCard({
  entry,
  homeBoard,
  type,
  selected,
}: {
  entry: BoundaryEntry
  homeBoard: string
  type: IssueType
  selected: boolean
}) {
  const toggleBoundary = useStore((s) => s.toggleBoundary)
  const openItem = useStore((s) => s.openItem)
  const [expanded, setExpanded] = useState(false)

  const state = DEP_STATE_STYLES[entry.state]
  const chip = chipColors(type.color)
  const dependents = expanded ? entry.dependents : entry.dependents.slice(0, 3)
  const hidden = entry.dependents.length - dependents.length

  const select = () => {
    const wasSelected = selected
    toggleBoundary(entry.dependency.id)
    if (wasSelected) {
      announce('Boundary highlight cleared.')
      return
    }
    focusBoundary(entry.dependency.id, entry.dependency.title)
    // The point of selecting this end is to find the other: bring the first dependent into view.
    const first = entry.dependents[0]
    if (first) reveal(`[data-card-id="${first.id}"]`)
  }

  return (
    <article
      data-boundary-card={entry.dependency.id}
      aria-labelledby={`boundary-${entry.dependency.id}`}
      // The card itself is the way in: pressing anywhere on it selects it and shows the cards on
      // this board that wait for it. The title below is the keyboard's door to the same act — a
      // card that can only be selected with a pointer is half a control.
      onClick={select}
      className={cn(
        'cursor-pointer rounded-lg border bg-white p-2.5 shadow-md transition hover:shadow-lg',
        selected ? 'border-slate-900 ring-2 ring-slate-900' : 'border-slate-300/80 hover:border-slate-400',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 rounded px-1.5 py-px text-micro font-bold uppercase tracking-wide" style={{ backgroundColor: chip.background, color: chip.color }}>
          {type.name}
        </span>
        {selected && (
          <span className="flex shrink-0 items-center gap-0.5 rounded bg-slate-900 px-1.5 py-px text-micro font-semibold text-white">
            <Link2 size={10} /> linked
          </span>
        )}
        <button
          onClick={(event) => {
            event.stopPropagation()
            openItem(entry.dependency.id)
          }}
          className="ml-auto flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-micro font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          title={`Open ${entry.dependency.title} on ${homeBoard}`}
        >
          Open <ArrowUpRight size={11} className="shrink-0" />
        </button>
      </div>

      <h3 id={`boundary-${entry.dependency.id}`} className="mt-1">
        <button
          onClick={(event) => {
            // The card's own click is the same act; stopping here would be pointless, but the
            // button must not fire it twice.
            event.stopPropagation()
            select()
          }}
          aria-pressed={selected}
          className="w-full rounded text-left text-meta font-semibold leading-snug text-slate-900 outline-none transition hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
          title={selected ? 'Clear the highlight' : 'Show the cards on this board that wait on it'}
        >
          <span className="line-clamp-2">{entry.dependency.title}</span>
        </button>
      </h3>

      <div className="mt-1 flex flex-wrap items-center gap-1">
        <span className={cn('shrink-0 rounded px-1.5 py-px text-micro font-semibold ring-1', state.className)}>{state.label}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-micro font-medium text-slate-700" title={`This dependency sits on ${homeBoard}`}>
          {homeBoard}
        </span>
      </div>

      {/* Which of this board's cards wait on it — named, each a way in. "opens/focuses that card". */}
      <div className="mt-2 border-t border-slate-200 pt-1.5">
        <p className="text-micro font-semibold uppercase tracking-wide text-slate-500">
          {entry.dependents.length === 1 ? 'Waited on by' : `Waited on by ${entry.dependents.length} cards`}
        </p>
        <ul className="mt-1 space-y-0.5">
          {dependents.map((dependent) => (
            <li key={dependent.id}>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  openItem(dependent.id)
                }}
                className="flex w-full items-center gap-1 rounded text-left text-micro text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
                title={`Open ${dependent.title}`}
              >
                <Rows3 size={10} className="shrink-0 text-slate-400" />
                <span className="min-w-0 truncate">{dependent.title}</span>
              </button>
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          <button
            onClick={(event) => {
              event.stopPropagation()
              setExpanded(true)
            }}
            className="mt-0.5 text-micro font-medium text-indigo-700 hover:underline"
          >
            +{hidden} more
          </button>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-1 border-t border-slate-200 pt-1.5 text-micro text-slate-600">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STAGE_DOT[entry.stage])} />
        <span className="shrink-0 font-semibold text-slate-700">{STAGE_LABELS[entry.stage]}</span>
        <span className="ml-auto">read-only</span>
        {/* The affordance, not a second control: the card and its name are the control. */}
        <span className={cn('shrink-0', selected ? 'font-semibold text-slate-900' : 'text-slate-500')}>
          · {selected ? 'showing its cards' : 'click to show its cards'}
        </span>
      </div>
    </article>
  )
}
