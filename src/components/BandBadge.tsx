import { Layers, Network, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BoardBand } from '@/domain/types'

export const BOARD_BANDS: BoardBand[] = ['team', 'program', 'portfolio']

export const BAND_STYLES: Record<BoardBand, { label: string; hint: string; chip: string; icon: LucideIcon }> = {
  team: {
    label: 'Team',
    hint: 'L1 — a team’s flow: lanes, cards, WIP',
    chip: 'bg-emerald-700 text-white',
    icon: Users,
  },
  program: {
    label: 'Program',
    hint: 'L2 — coordinates teams: a value stream, line of business or programme',
    chip: 'bg-sky-700 text-white',
    icon: Network,
  },
  portfolio: {
    label: 'Portfolio',
    hint: 'L3 — demand vs capability across the organisation',
    chip: 'bg-violet-700 text-white',
    icon: Layers,
  },
}

/**
 * Flight-level band badge. Read-only — the band is a board *setting*, changed in
 * Board settings, so the header never edits it.
 */
export function BandBadge({ band }: { band: BoardBand }) {
  // Defensive: persisted boards from before bands existed default to Team.
  const style = BAND_STYLES[band] ?? BAND_STYLES.team
  const Icon = style.icon

  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-bold', style.chip)}
      title={`Flight level: ${style.hint}`}
    >
      <Icon size={12} /> {style.label}
    </span>
  )
}
