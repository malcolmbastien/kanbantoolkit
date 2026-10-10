import { X } from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

const CHECKS: { n: number; text: string; jump?: { boardId: string; itemId?: string } }[] = [
  {
    n: 1,
    text: 'Custom types — open Types; rename/add a type and recolour it. A card can be any type.',
    jump: { boardId: 'b-core' },
  },
  {
    n: 2,
    text: 'Generic hierarchy — open a card; set its parent or add a child. One parent, many children; depth updates.',
    jump: { boardId: 'b-core', itemId: 'st-form' },
  },
  {
    n: 3,
    text: 'LeanKit lanes — split the “In Progress” column (or “Team Alpha” row), then drag a card into a sub-lane.',
    jump: { boardId: 'b-core' },
  },
  {
    n: 4,
    text: 'One card, two boards — “New signup flow” sits on Core Experience and Portfolio. Open it to see both placements.',
    jump: { boardId: 'b-core', itemId: 'it-signup' },
  },
  {
    n: 5,
    text: 'Dependency self-cleans — set “API decision” to Done; the blocked story flips to Satisfied untouched.',
    jump: { boardId: 'b-platform', itemId: 'it-api' },
  },
  {
    n: 6,
    text: 'Attribution never inflates — “Build signup form” serves 2 objectives; WIP stays 1.',
    jump: { boardId: 'b-core', itemId: 'st-form' },
  },
  {
    n: 7,
    text: 'WIP limit works — drag a card into a lane that is at its limit; a reason is required.',
    jump: { boardId: 'b-core' },
  },
]

export function DemoGuide() {
  const show = useStore((s) => s.showDemoGuide)
  const toggle = useStore((s) => s.toggleDemoGuide)
  const selectBoard = useStore((s) => s.selectBoard)
  const openItem = useStore((s) => s.openItem)

  if (!show) return null

  return (
    <div className="fixed bottom-3 left-3 z-40 w-[340px] rounded-lg border border-amber-200 bg-amber-50/95 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2 border-b border-amber-200/70 px-3 py-2">
        <span className="text-[12px] font-semibold text-amber-800">Demo guide — what to try</span>
        <button onClick={toggle} className="ml-auto text-amber-700/70 hover:text-amber-900">
          <X size={14} />
        </button>
      </div>
      <ol className="space-y-1 px-3 py-2">
        {CHECKS.map((c) => (
          <li key={c.n}>
            <button
              onClick={() => {
                if (c.jump) {
                  selectBoard(c.jump.boardId)
                  if (c.jump.itemId) setTimeout(() => openItem(c.jump!.itemId!), 0)
                }
              }}
              className={cn('flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-[11px] text-amber-900', c.jump && 'hover:bg-amber-100')}
            >
              <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-amber-200 text-[9px] font-bold text-amber-800">{c.n}</span>
              <span>{c.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
