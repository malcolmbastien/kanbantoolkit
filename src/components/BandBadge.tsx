import { Layers, Network, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BoardBand } from '@/domain/types'

export const BOARD_BANDS: BoardBand[] = ['team', 'program', 'portfolio']

export const BAND_STYLES: Record<BoardBand, { label: string; chip: string; icon: LucideIcon }> = {
  team: {
    label: 'Team',
    chip: 'bg-emerald-700 text-white',
    icon: Users,
  },
  program: {
    label: 'Program',
    chip: 'bg-sky-700 text-white',
    icon: Network,
  },
  portfolio: {
    label: 'Portfolio',
    chip: 'bg-violet-700 text-white',
    icon: Layers,
  },
}

/**
 * A board's type, as a badge — **Team**, **Program** or **Portfolio**. Read-only: a board's type is
 * fixed when it is created, so the badge says which one it is and nothing here is a control.
 */
export function BandBadge({ band }: { band: BoardBand }) {
  // Defensive: persisted boards from before bands existed default to Team.
  const style = BAND_STYLES[band] ?? BAND_STYLES.team
  const Icon = style.icon

  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-bold', style.chip)}
      title={`Board type: ${style.label}`}
    >
      <Icon size={12} /> {style.label}
    </span>
  )
}
