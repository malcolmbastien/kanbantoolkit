import {
  blockedBelowItems,
  leafItems,
  openDependenciesOf,
  openDescendants,
  rollupOf,
  stageOf,
  type Graph,
} from './derive'
import { parseDay, STALE_AFTER_DAYS } from './filters'

/**
 * Initiative health: the signals that say an initiative is in trouble, derived and never stored.
 *
 * Every rule reads state the model already keeps — the rollup, the blocked flags, the dependency
 * links, the arrival clock and the decomposition — so there is nothing to set, nothing to keep up
 * to date, and no way for the badge to disagree with the board it describes. A rule that cannot
 * be read from what the app knows says nothing rather than guessing: an initiative whose work
 * carries no arrival stamp is not called stale, because an unknown last movement is not the same
 * as no movement.
 *
 * Two tones, because the difference matters to a reader: `risk` is a hard stop someone else can
 * see (blocked work, a dependency that is not done), `watch` is something to look at (nothing
 * moving, nobody on it, committed over uncommitted).
 *
 * **An initiative with nothing below it raises nothing.** Having no work yet is a state, not a
 * finding: the card already shows it by having no pips and no rollup, and a badge that says
 * "nothing below" is the interface telling a reader what the absence already told them.
 */

export type HealthFlag = 'blocked' | 'waiting' | 'stale' | 'unowned' | 'uncommitted' | 'outlasted'

export interface HealthFlagInfo {
  flag: HealthFlag
  /** The badge: two or three words, the number included. */
  label: string
  /** Why the rule raised it, in the rule's own words — the badge's title. */
  why: string
  tone: 'risk' | 'watch'
  /**
   * The items the rule found, where it found particular ones — what a surface needs to take a
   * reader *to* the work rather than only tell them it exists.
   *
   * Absent where the rule is about the shape of the whole subtree rather than about particular
   * cards (`stale`): listing the entire work below under "nothing has moved" would be a list of
   * everything, which is not navigation. The count in the label is always this list's length when
   * it is here, so a badge and the cards it points at can never disagree.
   */
  items?: string[]
}

export type HealthLevel = 'healthy' | 'watch' | 'atRisk'

export interface InitiativeHealth {
  level: HealthLevel
  /** Risks first, then what to watch. Empty means nothing was found. */
  flags: HealthFlagInfo[]
}

const DAY_MS = 86_400_000
const plural = (n: number) => (n === 1 ? '' : 's')

/**
 * When the work below last *arrived* somewhere: the newest arrival stamp among the open leaves.
 * `undefined` when none of them carries one — the placement clock is deliberately optional, and
 * an initiative nobody has a stamp for must not be accused of standing still.
 */
function newestArrival(id: string, graph: Graph): number | undefined {
  const stamps = openDescendants(id, graph)
    .map((i) => graph.placements.find((p) => p.itemId === i.id)?.laneEnteredAt)
    .filter((t): t is number => typeof t === 'number')
  return stamps.length > 0 ? Math.max(...stamps) : undefined
}

/** The health of one initiative, as the rules find it. */
export function initiativeHealth(id: string, graph: Graph, now = Date.now()): InitiativeHealth {
  const roll = rollupOf(id, graph)
  const open = openDescendants(id, graph)
  const item = graph.items.find((i) => i.id === id)
  const flags: HealthFlagInfo[] = []

  // A hard stop, and the one signal that is a person's own word rather than a derivation.
  const blocked = blockedBelowItems(id, graph)
  if (blocked.length > 0) {
    flags.push({
      flag: 'blocked',
      label: `${blocked.length} blocked`,
      why: `${blocked.length} card${plural(blocked.length)} below ${blocked.length === 1 ? 'is' : 'are'} explicitly blocked`,
      tone: 'risk',
      items: blocked.map((i) => i.id),
    })
  }

  // Dependency risk: work below that waits on something still open.
  const waiting = open.filter((i) => openDependenciesOf(i.id, graph).length > 0)
  if (waiting.length > 0) {
    flags.push({
      flag: 'waiting',
      label: `${waiting.length} waiting`,
      why: `${waiting.length} card${plural(waiting.length)} below ${waiting.length === 1 ? 'waits' : 'wait'} on work that is not done`,
      tone: 'risk',
      items: waiting.map((i) => i.id),
    })
  }

  // Stale progress: committed work nothing has moved for longer than the staleness threshold —
  // the same threshold a card's own aging cue speaks at, so the surfaces agree on "too long".
  const committed = roll.bucket === 'notStarted' || roll.bucket === 'inProgress'
  const newest = newestArrival(id, graph)
  if (committed && newest !== undefined && now - newest >= STALE_AFTER_DAYS * DAY_MS) {
    const days = Math.floor((now - newest) / DAY_MS)
    flags.push({
      flag: 'stale',
      label: `still ${days}d`,
      why: `Nothing below it has moved for ${days} days`,
      tone: 'watch',
    })
  }

  // Uncovered work: committed cards below that nobody owns.
  const unowned = open.filter((i) => stageOf(i.id, graph) !== 'backlog' && (i.assignees ?? []).length === 0)
  if (unowned.length > 0) {
    flags.push({
      flag: 'unowned',
      label: `${unowned.length} unowned`,
      why: `${unowned.length} committed card${plural(unowned.length)} below ${unowned.length === 1 ? 'has' : 'have'} no owner`,
      tone: 'watch',
      items: unowned.map((i) => i.id),
    })
  }

  // The work below, against what the initiative itself says: the work is due after the
  // initiative is. A watch, never a block, and an initiative with nothing below it raises nothing.
  const ownEnd = parseDay(item?.targetEndDate)?.getTime()
  if (ownEnd !== undefined) {
    const later = open.filter((i) => {
      const end = parseDay(i.targetEndDate)?.getTime()
      return end !== undefined && end > ownEnd
    })
    if (later.length > 0) {
      flags.push({
        flag: 'outlasted',
        label: `${later.length} due later`,
        why: `${later.length} card${plural(later.length)} below ${later.length === 1 ? 'is' : 'are'} due after this initiative`,
        tone: 'watch',
        items: later.map((i) => i.id),
      })
    }
  }

  // The rollup anomaly the cards themselves already warn about: committed over uncommitted. The
  // list is taken rather than the count so the badge can point at the cards it means — the same
  // leaves, in the same order, that `rollupOf` counted.
  const backlog = committed ? leafItems(id, graph).filter((l) => stageOf(l.id, graph) === 'backlog') : []
  if (backlog.length > 0) {
    flags.push({
      flag: 'uncommitted',
      label: `${backlog.length} backlog`,
      why: `${backlog.length} card${plural(backlog.length)} below ${backlog.length === 1 ? 'is' : 'are'} still in Backlog while this initiative is committed`,
      tone: 'watch',
      items: backlog.map((i) => i.id),
    })
  }

  const level: HealthLevel = flags.some((f) => f.tone === 'risk')
    ? 'atRisk'
    : flags.length > 0
      ? 'watch'
      : 'healthy'
  return { level, flags }
}

export const HEALTH_META: Record<HealthLevel, { label: string; chip: string }> = {
  atRisk: { label: 'At risk', chip: 'bg-rose-100 text-rose-700 ring-rose-300' },
  watch: { label: 'Watch', chip: 'bg-amber-100 text-amber-800 ring-amber-300' },
  healthy: { label: 'On track', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
}
