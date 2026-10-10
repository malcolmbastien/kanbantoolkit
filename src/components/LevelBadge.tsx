import { ChevronDown, Layers, Target, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BoardLevel } from '@/domain/types'

export const BOARD_LEVELS: BoardLevel[] = ['portfolio', 'project', 'team']

export const LEVEL_STYLES: Record<BoardLevel, { label: string; chip: string; icon: LucideIcon }> = {
  portfolio: { label: 'Portfolio', chip: 'bg-violet-500 text-white', icon: Layers },
  project: { label: 'Project', chip: 'bg-sky-500 text-white', icon: Target },
  team: { label: 'Team', chip: 'bg-emerald-500 text-white', icon: Users },
}

/** Kanban flight-level badge. Pass onChange to make it an inline selector. */
export function LevelBadge({ level, onChange }: { level: BoardLevel; onChange?: (l: BoardLevel) => void }) {
  // Defensive: persisted boards from before this field existed default to Team.
  const style = LEVEL_STYLES[level] ?? LEVEL_STYLES.team
  const Icon = style.icon

  if (!onChange) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', style.chip)}
        title={`Kanban flight level: ${style.label}`}
      >
        <Icon size={12} /> {style.label}
      </span>
    )
  }

  return (
    <span
      className={cn('relative inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', style.chip)}
      title="Kanban flight level"
    >
      <Icon size={12} />
      <select
        value={level}
        onChange={(e) => onChange(e.target.value as BoardLevel)}
        className="cursor-pointer appearance-none bg-transparent pr-3 font-bold text-inherit outline-none"
      >
        {BOARD_LEVELS.map((l) => (
          <option key={l} value={l} className="bg-white text-slate-800">
            {LEVEL_STYLES[l].label}
          </option>
        ))}
      </select>
      <ChevronDown size={10} className="pointer-events-none absolute right-1" />
    </span>
  )
}
