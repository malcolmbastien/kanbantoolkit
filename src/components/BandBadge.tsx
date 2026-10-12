import { ChevronDown, Layers, Network, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BoardBand } from '@/domain/types'

export const BOARD_BANDS: BoardBand[] = ['operational', 'coordination', 'strategic']

export const BAND_STYLES: Record<BoardBand, { label: string; hint: string; chip: string; icon: LucideIcon }> = {
  operational: {
    label: 'Operational',
    hint: 'L1 — a team’s flow: lanes, cards, WIP',
    chip: 'bg-emerald-500 text-white',
    icon: Users,
  },
  coordination: {
    label: 'Coordination',
    hint: 'L2 — a value stream or line of business: the interface between teams',
    chip: 'bg-sky-500 text-white',
    icon: Network,
  },
  strategic: {
    label: 'Strategic',
    hint: 'L3 — demand vs capability across the organisation',
    chip: 'bg-violet-500 text-white',
    icon: Layers,
  },
}

/** Flight-level band badge. Pass onChange to make it an inline selector. */
export function BandBadge({ band, onChange }: { band: BoardBand; onChange?: (b: BoardBand) => void }) {
  // Defensive: persisted boards from before bands existed default to Operational.
  const style = BAND_STYLES[band] ?? BAND_STYLES.operational
  const Icon = style.icon

  if (!onChange) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', style.chip)}
        title={`Flight-level band: ${style.hint}`}
      >
        <Icon size={12} /> {style.label}
      </span>
    )
  }

  return (
    <span
      className={cn('relative inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', style.chip)}
      title="Flight-level band"
    >
      <Icon size={12} />
      <select
        value={band}
        onChange={(e) => onChange(e.target.value as BoardBand)}
        className="cursor-pointer appearance-none bg-transparent pr-3 font-bold text-inherit outline-none"
      >
        {BOARD_BANDS.map((b) => (
          <option key={b} value={b} className="bg-white text-slate-800">
            {BAND_STYLES[b].label}
          </option>
        ))}
      </select>
      <ChevronDown size={10} className="pointer-events-none absolute right-1" />
    </span>
  )
}
