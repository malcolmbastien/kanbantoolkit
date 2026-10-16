import { Info, X } from 'lucide-react'
import { BAND_STYLES } from './BandBadge'
import { cardTypes } from '@/domain/board'
import { childrenOf, laneCardCount, lanePath, rootLane, STAGE_LABELS } from '@/domain/lanes'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Stage } from '@/domain/types'

/**
 * The board legend — everything someone who just arrived needs to read this board, derived
 * from the live graph so it cannot drift from what the board actually is: its description,
 * its band's lens, the typed stages, the card types and their colours, the lane policies
 * and what a WIP limit does here. Nothing time-stamped: it explains the board, not its
 * history.
 */

/** What each typed stage means, in a sentence — the shape above the columns never moves. */
const STAGE_MEANING: Record<Stage, string> = {
  backlog: 'Work nothing is promised for yet.',
  notStarted: 'Committed — the team will pick it up.',
  inProgress: 'Under way right now.',
  done: 'Complete. Needs two kinds of done? Split Done into cells.',
}

export function BoardLegend() {
  const boards = useStore((s) => s.boards)
  const boardId = useStore((s) => s.boardId)
  const lanes = useStore((s) => s.lanes)
  const placements = useStore((s) => s.placements)
  const items = useStore((s) => s.items)
  const links = useStore((s) => s.links)
  const issueTypes = useStore((s) => s.issueTypes)
  const toggleLegend = useStore((s) => s.toggleLegend)

  const board = boards.find((b) => b.id === boardId)
  if (!board) return null

  const here = lanes.filter((l) => l.boardId === boardId)
  const cardsRoot = rootLane(here, boardId, 'cards')
  const columns = cardsRoot ? childrenOf(here, cardsRoot.id) : []
  // The board's own voice, and the places that carry its rules.
  const described = here.filter((l) => (l.description ?? '').trim())
  const limited = here.filter((l) => l.wipLimit !== undefined)
  const linked = (board.linkedBoardIds ?? []).map((id) => boards.find((b) => b.id === id)?.name ?? id)
  const types = cardTypes(issueTypes)
  const defaultType = types.find((t) => t.id === board.defaultCardTypeId)

  // Right now, derived from the graph: anything else would drift or guess.
  const onBoard = new Set(placements.filter((p) => p.boardId === boardId).map((p) => p.itemId))
  const working = items.filter((i) => onBoard.has(i.id) && !i.archived)
  const blocked = working.filter((i) => i.blocked === true).length
  const boardItemIds = new Set(working.map((i) => i.id))
  const touching = links.filter((l) => boardItemIds.has(l.from) && boardItemIds.has(l.to))
  const external = links.filter((l) => boardItemIds.has(l.from) !== boardItemIds.has(l.to))

  return (
    <aside data-board-legend className="flex h-full w-[340px] shrink-0 flex-col border-l border-slate-300 bg-slate-50">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <Info size={15} className="shrink-0 text-indigo-600" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-title font-semibold text-slate-800">{board.name}</div>
          <div className="text-meta text-slate-600">How to read this board</div>
        </div>
        <button onClick={toggleLegend} title="Close the legend">
          <X size={16} className="text-slate-600 hover:text-slate-600" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-meta">
        {/* What this board is — its own voice, written in board settings */}
        <p
          className={cn(
            'rounded-md px-2.5 py-1.5',
            board.description.trim() ? 'bg-white text-slate-700 ring-1 ring-inset ring-slate-200' : 'bg-indigo-50 text-indigo-700',
          )}
        >
          {board.description.trim() || 'No description yet — board settings can add one, in the team’s own words.'}
        </p>

        {/* The lens — a board's band decides what it renders */}
        <section>
          <SectionLabel>The lens</SectionLabel>
          <div className="rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-700">
            <span className={cn('rounded px-1 py-px text-micro font-semibold uppercase tracking-wide', BAND_STYLES[board.band].chip)}>
              {BAND_STYLES[board.band].label}
            </span>
            <span className="ml-1.5 text-micro text-slate-600">{' '}{BAND_STYLES[board.band].hint}</span>
            {linked.length > 0 && (
              <p className="mt-1 text-micro text-slate-600">
                Aggregates {linked.length === 1 ? linked[0] : `${linked.length} boards — ${linked.join(', ')}`}; their initiatives appear here as bands.
              </p>
            )}
          </div>
        </section>

        {/* The flow — the four typed columns, fixed by design */}
        <section>
          <SectionLabel>The flow</SectionLabel>
          <div className="space-y-1">
            {columns.map((c) => (
              <div key={c.id} className="rounded border border-slate-200 bg-white px-2 py-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate font-medium text-slate-700">{c.name || STAGE_LABELS[c.stage ?? 'inProgress']}</span>
                  <span className="min-w-0 flex-1 text-micro text-slate-600">{STAGE_MEANING[c.stage ?? 'inProgress']}</span>
                  <span className="shrink-0 rounded bg-slate-100 px-1 text-micro font-semibold text-slate-700">
                    {`${laneCardCount(here, placements, c.id)} card${laneCardCount(here, placements, c.id) === 1 ? '' : 's'}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1 text-micro text-slate-600">
            The four typed columns never move or multiply — a board reshapes itself by splitting one into cells, and everything
            beneath inherits the stage it sits in.
          </p>
        </section>

        {/* The card vocabulary — workspace-wide, offered here in full */}
        <section>
          <SectionLabel>Card types</SectionLabel>
          <div className="flex flex-wrap gap-1">
            {types.map((t) => (
              <span key={t.id} className="flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-slate-700">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                {t.name}
                {board.defaultCardTypeId === t.id && <span className="text-micro text-slate-600">(new cards)</span>}
              </span>
            ))}
          </div>
          <p className="mt-1 text-micro text-slate-600">
            Types belong to the whole workspace{defaultType ? ` — new cards here start as ${defaultType.name}` : ''}. The
            Initiative type never appears as a card: it lives in the initiatives flow above the cards.
          </p>
        </section>

        {/* The rules of play — gathered from every lane that wrote one */}
        <section>
          <SectionLabel>Lane policies</SectionLabel>
          {described.length === 0 ? (
            <p className="text-micro text-slate-600">
              No lane has written a policy yet. A lane's settings hold its rules of play — what may enter, what may leave, anything
              a newcomer would otherwise have to ask about.
            </p>
          ) : (
            <div className="space-y-1">
              {described.map((l) => {
                const path = lanePath(here, l.id)
                return (
                  <div key={l.id} className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-700">
                    <span className="block text-micro uppercase tracking-wide text-slate-500">{path.join(' / ')}</span>
                    {l.description}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* WIP — what a limit on this board does when it is hit */}
        <section>
          <SectionLabel>WIP limits</SectionLabel>
          {limited.length > 0 ? (
            <div className="space-y-1">
              {limited.map((l) => {
                const n = laneCardCount(here, placements, l.id)
                return (
                  <div key={l.id} className="flex items-baseline gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-slate-700">
                    <span className="min-w-0 flex-1 truncate">{lanePath(here, l.id).join(' / ')}</span>
                    <span
                      className={cn(
                        'shrink-0 rounded px-1 font-semibold',
                        n > (l.wipLimit ?? 0) ? 'bg-rose-100 text-rose-700' : n === l.wipLimit ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700',
                      )}
                    >
                      {n}/{l.wipLimit}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-micro text-slate-600">No lane carries a limit. A lane's settings can set one.</p>
          )}
          <p className="mt-1 text-micro text-slate-600">
            A WIP limit is a signal, never a gate: at or over its count the lane tints, and a move is never refused because of it.
          </p>
        </section>

        {/* Right now — pure counts from the graph */}
        <section>
          <SectionLabel>Right now</SectionLabel>
          <p className="rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-700">
            {blocked === 0 ? 'No blocked cards' : `${blocked} blocked card${blocked === 1 ? '' : 's'}`}
            {' · '}
            {touching.length === 0
              ? 'no links between these cards'
              : `${touching.length} link${touching.length === 1 ? '' : 's'} between these cards`}
            {external.length > 0 && ` · ${external.length} reaching outside the board`}
          </p>
          <p className="mt-1 text-micro text-slate-600">
            Everything here is read from the board itself — rename a type or edit a policy and the legend changes with it.
          </p>
        </section>
      </div>
    </aside>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-meta font-semibold uppercase tracking-wide text-slate-600">{children}</div>
}
