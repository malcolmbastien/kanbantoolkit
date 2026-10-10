import { X } from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

const CHECKS: { n: number; text: string; jump?: { boardId: string; itemId?: string } }[] = [
  {
    n: 1,
    text: 'One item, three boards — open “New signup flow”; flip resolution L1/L2/L3. Same identity.',
    jump: { boardId: 'b-core-epics', itemId: 'ep-signup' },
  },
  {
    n: 2,
    text: 'Level is computed — in the panel, add a child to a story and watch its level change. No level field.',
    jump: { boardId: 'b-core-flow', itemId: 'st-signup-form' },
  },
  {
    n: 3,
    text: 'Dependency self-cleans — set “API decision” to Done; the blocked story flips to Satisfied untouched.',
    jump: { boardId: 'b-bravo', itemId: 'ep-api' },
  },
  {
    n: 4,
    text: 'Attribution never inflates — “Build signup form” serves 2 objectives; WIP stays 1.',
    jump: { boardId: 'b-core-flow', itemId: 'st-signup-form' },
  },
  {
    n: 5,
    text: 'A limit works — on the Epics board hit + Epic; the soft block demands a reason.',
    jump: { boardId: 'b-core-epics' },
  },
  {
    n: 6,
    text: 'The exec board stops lying — Portfolio: computed status + sponsor recommendation, human-confirmed.',
    jump: { boardId: 'b-portfolio', itemId: 'init-onboarding' },
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
        <span className="text-[12px] font-semibold text-amber-800">Demo guide — the load-bearing bits</span>
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
              className={cn(
                'flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-[11px] text-amber-900',
                c.jump && 'hover:bg-amber-100',
              )}
            >
              <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-amber-200 text-[9px] font-bold text-amber-800">
                {c.n}
              </span>
              <span>{c.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
