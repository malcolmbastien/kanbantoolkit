import { LayoutGrid, Plus, RotateCcw, Search, Sparkles } from 'lucide-react'
import { LIFECYCLES, RESOLUTIONS } from '@/domain/lifecycles'
import { cn } from '@/lib/utils'
import type { Board, Resolution, Scope } from '@/domain/types'

interface Props {
  boards: Board[]
  scopes: Scope[]
  boardId: string
  resolution: Resolution
  scopeId: string
  search: string
  showDemoGuide: boolean
  onSelectBoard: (id: string) => void
  onSetResolution: (r: Resolution) => void
  onSetScope: (id: string) => void
  onSearch: (q: string) => void
  onReset: () => void
  onToggleDemoGuide: () => void
  onAddEpic: () => void
  onAddStory: () => void
}

const RES_HINT: Record<Resolution, string> = {
  L1: 'initiative lifecycle',
  L2: 'epic workflow',
  L3: 'team flow',
}

export function TopBar(props: Props) {
  const {
    boards, scopes, boardId, resolution, scopeId, search, showDemoGuide,
    onSelectBoard, onSetResolution, onSetScope, onSearch, onReset, onToggleDemoGuide,
    onAddEpic, onAddStory,
  } = props

  const streams = scopes.filter((s) => s.kind === 'value_stream')
  const teams = scopes.filter((s) => s.kind === 'team')

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="grid h-6 w-6 place-items-center rounded bg-slate-800 text-white">
          <LayoutGrid size={14} />
        </div>
        <span className="text-sm font-semibold tracking-tight text-slate-800">Flowline</span>
      </div>

      <div className="h-5 w-px bg-slate-200" />

      <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
        Board
        <select
          value={boardId}
          onChange={(e) => onSelectBoard(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[12px] font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-400"
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
        Scope
        <select
          value={scopeId}
          onChange={(e) => onSetScope(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[12px] font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="ent">Enterprise</option>
          {streams.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              ↳ {t.name}
            </option>
          ))}
        </select>
      </label>

      {/* Resolution switcher — changes the column set AND the counting unit. Scope does not change. */}
      <div className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 p-0.5">
        {RESOLUTIONS.map((r) => (
          <button
            key={r}
            onClick={() => onSetResolution(r)}
            title={`${LIFECYCLES[r].label} resolution — ${RES_HINT[r]}`}
            className={cn(
              'rounded px-2 py-1 text-[11px] font-medium transition',
              resolution === r
                ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <span className="font-semibold">{r}</span>{' '}
            <span className="hidden sm:inline">{LIFECYCLES[r].label}</span>
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Filter cards…"
            className="w-36 rounded-md border border-slate-200 bg-white py-1 pl-7 pr-2 text-[12px] outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>

        {resolution === 'L2' && (
          <button
            onClick={onAddEpic}
            className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-indigo-700"
          >
            <Plus size={13} /> Epic
          </button>
        )}
        {resolution === 'L3' && (
          <button
            onClick={onAddStory}
            className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-indigo-700"
          >
            <Plus size={13} /> Story
          </button>
        )}

        <button
          onClick={onToggleDemoGuide}
          className={cn(
            'flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium',
            showDemoGuide
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-slate-200 bg-white text-slate-500 hover:text-slate-700',
          )}
          title="Toggle the demo guide"
        >
          <Sparkles size={13} /> Guide
        </button>

        <button
          onClick={onReset}
          className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] font-medium text-slate-500 hover:text-slate-700"
          title="Reset the demo data"
        >
          <RotateCcw size={13} /> Reset
        </button>
      </div>
    </header>
  )
}
