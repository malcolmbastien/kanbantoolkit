import { STAGE_COLOR } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { STAGE_LABELS } from '@/domain/lanes'
import type { Stage } from '@/domain/types'

/**
 * The stage distribution of an initiative's leaves, as one bar.
 *
 * A single fill answered "how much is done" and threw the rest away. This bar keeps the whole
 * answer: the shares of Done, In Progress, Not Started and Backlog, in the order a reader moves
 * through the work. Discarded work is not in the counts at all — it was thrown away, so it is not
 * a status of the plan — and the same rollup that computes the percentage supplies every segment,
 * so the bar and the number cannot disagree.
 *
 * The colour is never the only meaning: the bar carries a title and an accessible label naming
 * every count, and every surface that draws it has the percentage and the numbers beside it.
 */
export interface StageCounts {
  /** Leaves that count toward progress. Discarded leaves are already out of this total. */
  total: number
  backlog: number
  notStarted: number
  inProgress: number
  done: number
}

/** The counts the bar needs, from the one rollup the percentage comes from. */
export function stageCountsOf(roll: {
  total: number
  uncommitted: number
  notStarted: number
  inProgress: number
  done: number
}): StageCounts {
  return {
    total: roll.total,
    backlog: roll.uncommitted,
    notStarted: roll.notStarted,
    inProgress: roll.inProgress,
    done: roll.done,
  }
}

/**
 * Done first, then the work under way, then what has not begun. Backlog is the quiet tail rather
 * than another strong colour, so the eye reads how much is finished before it reads how much is
 * planned.
 */
const SEGMENTS: Array<{ stage: Stage; color: string }> = [
  { stage: 'done', color: STAGE_COLOR.done },
  { stage: 'inProgress', color: STAGE_COLOR.inProgress },
  { stage: 'notStarted', color: STAGE_COLOR.notStarted },
  { stage: 'backlog', color: '#cbd5e1' },
]

/** The order the bar and the initiative pips read in: delivered, under way, not begun, backlog. */
export const PROGRESS_STAGE_ORDER: Stage[] = SEGMENTS.map((segment) => segment.stage)

export function StageProgressBar({
  counts,
  className,
  height = 'h-2',
}: {
  counts: StageCounts
  className?: string
  /** The bar's thickness. The default is a little heavier than a checklist's, so it reads as the
   * initiative's own summary rather than as one more row of detail. */
  height?: string
}) {
  if (counts.total <= 0) return null
  const parts = SEGMENTS.filter((segment) => counts[segment.stage] > 0)
  const summary = SEGMENTS.map((segment) => `${counts[segment.stage]} ${STAGE_LABELS[segment.stage].toLowerCase()}`).join(', ')
  const noun = counts.total === 1 ? 'leaf' : 'leaves'
  return (
    <div
      data-stage-progress
      role="img"
      aria-label={`${counts.done} of ${counts.total} ${noun} done — ${summary}`}
      title={`${counts.done} of ${counts.total} done · ${summary}`}
      className={cn('flex w-full overflow-hidden rounded-full bg-slate-200', height, className)}
    >
      {parts.map((segment) => (
        <span
          key={segment.stage}
          data-stage-segment={segment.stage}
          style={{ width: `${(counts[segment.stage] / counts.total) * 100}%`, backgroundColor: segment.color }}
          className="h-full shrink-0 transition-all"
        />
      ))}
    </div>
  )
}
