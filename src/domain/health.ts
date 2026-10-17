import {
  blockedBelow,
  descendants,
  openDependenciesOf,
  openDescendants,
  rollupOf,
  stageOf,
  uncommittedBelow,
  type Graph,
} from './derive'
import { STALE_AFTER_DAYS } from './filters'

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
 * moving, nobody on it, nothing underneath, committed over uncommitted).
 */

export type HealthFlag = 'blocked' | 'waiting' | 'stale' | 'unowned' | 'unplanned' | 'uncommitted'

export interface HealthFlagInfo {
  flag: HealthFlag
  /** The badge: two or three words, the number included. */
  label: string
  /** Why the rule raised it, in the rule's own words — the badge's title. */
  why: string
  tone: 'risk' | 'watch'
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
  const flags: HealthFlagInfo[] = []

  // A hard stop, and the one signal that is a person's own word rather than a derivation.
  const blocked = blockedBelow(id, graph)
  if (blocked > 0) {
    flags.push({
      flag: 'blocked',
      label: `${blocked} blocked`,
      why: `${blocked} card${plural(blocked)} below ${blocked === 1 ? 'is' : 'are'} explicitly blocked`,
      tone: 'risk',
    })
  }

  // Dependency risk: work below that waits on something still open.
  const waiting = open.filter((i) => openDependenciesOf(i.id, graph).length > 0).length
  if (waiting > 0) {
    flags.push({
      flag: 'waiting',
      label: `${waiting} waiting`,
      why: `${waiting} card${plural(waiting)} below wait on work that is not done`,
      tone: 'risk',
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
  const unowned = open.filter((i) => stageOf(i.id, graph) !== 'backlog' && (i.assignees ?? []).length === 0).length
  if (unowned > 0) {
    flags.push({
      flag: 'unowned',
      label: `${unowned} unowned`,
      why: `${unowned} committed card${plural(unowned)} below ${unowned === 1 ? 'has' : 'have'} no owner`,
      tone: 'watch',
    })
  }

  // Nothing underneath at all: an initiative with no decomposition has nothing to roll up.
  if (descendants(id, graph).length === 0) {
    flags.push({
      flag: 'unplanned',
      label: 'nothing below',
      why: 'No work sits under it yet, so nothing rolls up to it',
      tone: 'watch',
    })
  }

  // The rollup anomaly the cards themselves already warn about: committed over uncommitted.
  const uncommitted = uncommittedBelow(id, graph)
  if (uncommitted > 0) {
    flags.push({
      flag: 'uncommitted',
      label: `${uncommitted} backlog`,
      why: `${uncommitted} card${plural(uncommitted)} below ${uncommitted === 1 ? 'is' : 'are'} still in Backlog while this initiative is committed`,
      tone: 'watch',
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
