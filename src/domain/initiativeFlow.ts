/**
 * The Flow reading an initiative can honestly carry.
 *
 * An initiative has no clock of its own: its section is derived from the leaves and its progress
 * is their rollup, so a cycle time or a "time in this section" would be a second answer that can
 * disagree with the work. What is true is the age of the initiative, the distribution of its
 * leaves, the oldest one still open, the health rules that point at the cards, and the last time
 * any child moved — when that history was available to read.
 */

import { decompositionChildren, openDescendants, progressLeaves, rollupOf, stageOf, type Graph } from './derive'
import { initiativeHealth } from './health'
import type { StageMove } from './metrics'
import type { Item, Stage } from './types'

/** At least one day has to have passed for a late log to be worth mentioning. */
const DAY_MS = 86_400_000

export interface OldestOpenLeaf {
  id: string
  title: string
  /** How long it has been open by the clock named beside it. */
  ms: number
  /** `commitment` is the work's own first commitment; `column` is when it entered its cell. */
  clock: 'commitment' | 'column'
}

export interface InitiativeFlowReading {
  /** Now, or the archive — the clocks stop when the initiative is filed. */
  stop: number
  openMs: number
  /** The derived section: the rollup bucket, never a stored field. */
  section: Stage
  percent: number
  leaves: {
    total: number
    backlog: number
    notStarted: number
    inProgress: number
    done: number
  }
  oldest?: OldestOpenLeaf
  /** The health rules' counts, from the same flags the drawer and the dashboard read. */
  blocked: number
  waiting: number
  unowned: number
  lastMoveAt?: number
  /**
   * Whether child move history was available. `false` means "not loaded", so the drawer says so
   * rather than treating the initiative's creation as its last movement.
   */
  lastMoveKnown: boolean
  /** Whether the log begins after creation, so the age has a visible caveat. */
  historyFrom?: number
}

/** The first move out of Backlog, or the first recorded move that landed in a committed stage. */
function commitmentOf(moves: readonly StageMove[] | undefined): number | undefined {
  return moves?.find((move) => move.to !== 'backlog')?.at
}

/**
 * Read one initiative for the drawer.
 *
 * `childMoves` is the move history available for the cards below it — the board's read, keyed by
 * item id. Pass `undefined` when that history could not be read at all; the reading then says the
 * last movement is unknown instead of inventing one.
 */
export function initiativeFlowReading(
  item: Item,
  graph: Graph,
  childMoves: Map<string, readonly StageMove[]> | undefined,
  now: number,
): InitiativeFlowReading {
  const stop = Math.max(item.createdAt, Math.min(now, item.archivedAt ?? Number.POSITIVE_INFINITY))
  const hasLeaves = decompositionChildren(item.id, graph.edges).length > 0
  const roll = rollupOf(item.id, graph)
  const open = openDescendants(item.id, graph)
  const openLeaves = hasLeaves
    ? progressLeaves(item.id, graph).filter((leaf) => !leaf.archived && stageOf(leaf.id, graph) !== 'done')
    : []
  const health = initiativeHealth(item.id, graph, now)
  const flagItems = (flag: string) => health.flags.find((entry) => entry.flag === flag)?.items?.length ?? 0

  let oldest: OldestOpenLeaf | undefined
  for (const leaf of openLeaves) {
    const placement = graph.placements.find((entry) => entry.itemId === leaf.id)
    const committed = commitmentOf(childMoves?.get(leaf.id))
    const since = committed ?? placement?.laneEnteredAt
    if (since === undefined) continue
    const ms = Math.max(0, stop - since)
    if (!oldest || ms > oldest.ms) {
      oldest = { id: leaf.id, title: leaf.title, ms, clock: committed === undefined ? 'column' : 'commitment' }
    }
  }

  const lastMoveAt = childMoves
    ? open.reduce<number | undefined>((latest, child) => {
        for (const move of childMoves.get(child.id) ?? []) {
          if (move.at <= stop && (latest === undefined || move.at > latest)) latest = move.at
        }
        return latest
      }, undefined)
    : undefined

  const earliestMove = childMoves
    ? [...childMoves.values()].flat().reduce<number | undefined>(
        (earliest, move) => (earliest === undefined || move.at < earliest ? move.at : earliest),
        undefined,
      )
    : undefined
  const historyFrom =
    earliestMove !== undefined && earliestMove > item.createdAt + DAY_MS ? earliestMove : undefined

  return {
    stop,
    openMs: Math.max(0, stop - item.createdAt),
    section: hasLeaves ? roll.bucket : stageOf(item.id, graph) ?? 'backlog',
    percent: hasLeaves ? roll.percent : 0,
    leaves: hasLeaves
      ? {
          total: roll.total,
          backlog: roll.uncommitted,
          notStarted: roll.notStarted,
          inProgress: roll.inProgress,
          done: roll.done,
        }
      : { total: 0, backlog: 0, notStarted: 0, inProgress: 0, done: 0 },
    ...(oldest ? { oldest } : {}),
    blocked: flagItems('blocked'),
    waiting: flagItems('waiting'),
    unowned: flagItems('unowned'),
    ...(lastMoveAt === undefined ? {} : { lastMoveAt }),
    lastMoveKnown: childMoves !== undefined,
    ...(historyFrom === undefined ? {} : { historyFrom }),
  }
}
