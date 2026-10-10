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

const SELECT_CLS =
  'rounded-md border border-slate-700 bg-slate-800 px-1.5 py-1 text-[12px] font-medium text-slate-100 outline-none focus:ring-2 focus:ring-indigo-400'
const SELECT_OPT = 'bg-slate-800 text-slate-100'

export function TopBar(props: Props) {
  const {
    boards, scopes, boardId, resolution, scopeId, search, showDemoGuide,
    onSelectBoard, onSetResolution, onSetScope, onSearch, onReset, onToggleDemoGuide,
    onAddEpic, onAddStory,
  } = props

  const streams = scopes.filter((s) => s.kind === 'value_stream')
  const teams = scopes.filter((s) => s.kind === 'team')

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-950/50 bg-slate-900 px-3 py-2 text-slate-200 shadow-md">
      <div className="flex items-center gap-2">
        <div className="grid h-6 w-6 place-items-center rounded bg-indigo-500 text-white shadow-sm">
          <LayoutGrid size={14} />
        </div>
        <span className="text-sm font-semibold tracking-tight text-white">Flowline</span>
      </div>

      <div className="h-5 w-px bg-slate-700" />

      <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
        Board
        <select value={boardId} onChange={(e) => onSelectBoard(e.target.value)} className={SELECT_CLS}>
          {boards.map((b) => (
            <option key={b.id} value={b.id} className={SELECT_OPT}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
        Scope
        <select value={scopeId} onChange={(e) => onSetScope(e.target.value)} className={SELECT_CLS}>
          <option value="ent" className={SELECT_OPT}>Enterprise</option>
          {streams.map((s) => (
            <option key={s.id} value={s.id} className={SELECT_OPT}>{s.name}</option>
          ))}
          {teams.map((t) => (
            <option key={t.id} value={t.id} className={SELECT_OPT}>↳ {t.name}</option>
          ))}
        </select>
      </label>

      {/* Resolution switcher — changes the column set AND the counting unit. Scope does not change. */}
      <div className="flex items-center gap-0.5 rounded-md border border-slate-700 bg-slate-800 p-0.5">
        {RESOLUTIONS.map((r) => (
          <button
            key={r}
            onClick={() => onSetResolution(r)}
            title={`${LIFECYCLES[r].label} resolution — ${RES_HINT[r]}`}
            className={cn(
              'rounded px-2 py-1 text-[11px] font-medium transition',
              resolution === r
                ? 'bg-indigo-500 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-100',
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
            className="w-36 rounded-md border border-slate-700 bg-slate-800 py-1 pl-7 pr-2 text-[12px] text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>

        {resolution === 'L2' && (
          <button
            onClick={onAddEpic}
            className="flex items-center gap-1 rounded-md bg-indigo-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-indigo-400"
          >
            <Plus size={13} /> Epic
          </button>
        )}
        {resolution === 'L3' && (
          <button
            onClick={onAddStory}
            className="flex items-center gap-1 rounded-md bg-indigo-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-indigo-400"
          >
            <Plus size={13} /> Story
          </button>
        )}

        <button
          onClick={onToggleDemoGuide}
          className={cn(
            'flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition',
            showDemoGuide
              ? 'border-amber-400/50 bg-amber-400/20 text-amber-200'
              : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-100',
          )}
          title="Toggle the demo guide"
        >
          <Sparkles size={13} /> Guide
        </button>

        <button
          onClick={onReset}
          className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[12px] font-medium text-slate-400 hover:text-slate-100"
          title="Reset the demo data"
        >
          <RotateCcw size={13} /> Reset
        </button>
      </div>
    </header>
  )
}
