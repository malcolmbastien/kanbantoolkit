/**
 * The due date, as a reading rather than a field.
 *
 * A card's due date is one day and a promise; every surface that shows it — the card, the drawer,
 * My work, the dashboard, the filter — has to agree about what "overdue" and "due soon" mean, so
 * the arithmetic lives here once. It is derived on every read and never stored: nothing has to be
 * cleared when the day passes, and no rule can disagree with the date it describes.
 *
 * A due date never affects status, rollup, WIP or a dependency, and an initiative may carry one —
 * the no-estimate rule is about size, not deadlines.
 */

import { DUE_SOON_DAYS, parseDay } from './filters'
import type { Stage } from './types'

export type DueTone = 'overdue' | 'soon' | 'later'

export interface DueState {
  /** The day, as stored — ISO 'YYYY-MM-DD'. */
  date: string
  /** Whole days from today: negative has passed, 0 is today, 1 is tomorrow. */
  days: number
  /**
   * `overdue` when the day has passed and the work is unfinished, `soon` within the week the
   * board's own "due soon" filter names, and `later` otherwise — including for finished work,
   * where a passed date is a fact and no longer a risk.
   */
  tone: DueTone
}

/**
 * The state of one item's due date, or nothing when it has none (or holds something that is not a
 * day — an imported value the reader cannot make sense of says nothing rather than guessing).
 *
 * `complete` is the item's own finished state, not the stage of a card below it: a card is overdue
 * until *it* is done, whatever is above it.
 */
export function dueState(dueDate: string | undefined, complete = false, now = Date.now()): DueState | undefined {
  const day = dayOf(dueDate)
  if (!day) return undefined
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  // Rounded rather than floored: the two midnights are a whole number of days apart except across
  // a daylight-saving change, where an hour either way must not move the answer by a day.
  const days = Math.round((day.getTime() - today.getTime()) / 86_400_000)
  const tone: DueTone = complete ? 'later' : days < 0 ? 'overdue' : days < DUE_SOON_DAYS ? 'soon' : 'later'
  return { date: dueDate!, days, tone }
}

/** A day, or nothing — a value that is not a date says nothing rather than "Invalid Date". */
function dayOf(iso: string | undefined): Date | undefined {
  const day = parseDay(iso)
  return day && !Number.isNaN(day.getTime()) ? day : undefined
}

const plural = (n: number) => (n === 1 ? '' : 's')

/** The day as a reader writes it: "12 Mar". A year nobody needs at a glance stays out of it. */
export function dueDay(iso: string): string {
  return dayOf(iso)?.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) ?? iso
}

/**
 * What a chip says. The words come from the state, so the card, the drawer, My work and the
 * dashboard cannot phrase the same date two ways: "3d overdue", "Due today", "Due in 2d", or the
 * day itself when there is nothing to raise a voice about.
 */
export function dueLabel(state: DueState): string {
  if (state.tone === 'overdue') return `${-state.days}d overdue`
  if (state.tone === 'soon') return state.days === 0 ? 'Due today' : `Due in ${state.days}d`
  return `Due ${dueDay(state.date)}`
}

/** The chip's title: the whole sentence behind the words, with the date it is about. */
export function dueWhy(state: DueState): string {
  if (state.tone === 'overdue') {
    return `Due ${dueDay(state.date)} — ${-state.days} day${plural(-state.days)} past its due date`
  }
  if (state.tone === 'soon') {
    return state.days === 0 ? `Due today — ${dueDay(state.date)}` : `Due ${dueDay(state.date)} — in ${state.days} day${plural(state.days)}`
  }
  return `Due ${dueDay(state.date)}`
}

/** The stages in which the board's own word is "this has not begun". */
const NOT_STARTED = new Set<Stage>(['backlog', 'notStarted'])

/**
 * The day a planned start slipped, or nothing.
 *
 * The board's stage is the record of whether work began, the same reading WIP, rollup and
 * staleness use; the plan is only a date. A day still to come, a stage that has begun, or no
 * planned start at all all say nothing. This is the one rule the attention list and the card's
 * own badge read, so "late start" cannot mean two things on two surfaces.
 */
export function lateStartDay(startDate: string | undefined, stage: Stage | undefined, now = Date.now()): string | undefined {
  if (!stage || !NOT_STARTED.has(stage)) return undefined
  const start = parseDay(startDate)
  if (!start) return undefined
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (start.getTime() >= today.getTime()) return undefined
  return dueDay(startDate!)
}
