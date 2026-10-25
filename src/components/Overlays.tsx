import { lazy, Suspense } from 'react'
import { CornerDownRight, X } from 'lucide-react'
import { CardMenu } from './CardMenu'
import { useStore } from '@/store'
import { useMay } from '@/lib/permissions'

/**
 * The consent screen is only ever seen from a link a tool printed, so it is not part of the first
 * download: a board must not carry a dialog about credentials it will not show.
 */
const ApprovalPrompt = lazy(() => import('./ApprovalPrompt').then((m) => ({ default: m.ApprovalPrompt })))

/**
 * The code this page was opened with, read once at module load.
 *
 * Before any effect runs, because the app's own URL state normalises the query as it starts (`useUrl`
 * writes the board and the view it settles on) and a parameter that arrived in a link must survive
 * that. A tool's approval is the one thing on this page that came from outside it.
 */
const APPROVAL_CODE = (() => {
  try {
    return new URLSearchParams(window.location.search).get('approve')
  } catch {
    return null
  }
})()

/**
 * The things that float above whatever board you are looking at: the card menu, and the chip
 * that says what a pick mode is waiting for.
 *
 * They used to be rendered by `BoardCanvas`, which meant an aggregating board had neither — a
 * right-click on a Program board opened nothing at all, because the menu had nowhere to appear.
 * One host, mounted once, so every surface gets them.
 */
export function Overlays() {
  const cardMenu = useStore((s) => s.cardMenu)
  const closeCardMenu = useStore((s) => s.closeCardMenu)
  const multiSelect = useStore((s) => s.multiSelect)
  const parentPickId = useStore((s) => s.parentPickId)
  const cancelParentPick = useStore((s) => s.cancelParentPick)
  const childPickId = useStore((s) => s.childPickId)
  const cancelChildPick = useStore((s) => s.cancelChildPick)
  const items = useStore((s) => s.items)
  // Every line in the card menu changes a card, and a Viewer changes none — so the menu does not
  // open. Reading is unaffected: the card, its panel and its history are still there.
  const may = useMay()

  const chip =
    'fixed bottom-4 left-4 z-40 flex max-w-[min(26rem,80vw)] items-center gap-2 rounded-lg border border-indigo-400/60 bg-indigo-600 px-3 py-2 text-meta font-medium text-white shadow-2xl'

  return (
    <>
      {childPickId && (
        <div data-child-pick className={chip}>
          <CornerDownRight size={13} className="-scale-x-100 shrink-0" />
          <span className="min-w-0">
            <span className="text-indigo-200">
              Connect to {items.find((i) => i.id === childPickId)?.title ?? 'this initiative'}:
            </span>{' '}
            click the card
          </span>
          <button
            onClick={cancelChildPick}
            className="shrink-0 rounded p-0.5 text-indigo-100 transition hover:bg-white/15 hover:text-white"
            title="Cancel"
          >
            <X size={12} />
          </button>
        </div>
      )}
      {parentPickId && (
        <div data-parent-pick className={chip}>
          <CornerDownRight size={13} className="shrink-0" />
          <span className="min-w-0">
            <span className="text-indigo-200">Set parent:</span> click the initiative this card rolls up to
          </span>
          <button
            onClick={cancelParentPick}
            className="shrink-0 rounded p-0.5 text-indigo-100 transition hover:bg-white/15 hover:text-white"
            title="Cancel"
          >
            <X size={12} />
          </button>
        </div>
      )}
      {/* A tool asking to be connected: a question about the person, not about a board, so it is
          above whatever is being looked at. Loaded only when the address says so. */}
      {APPROVAL_CODE && (
        <Suspense fallback={null}>
          <ApprovalPrompt code={APPROVAL_CODE} />
        </Suspense>
      )}
      {cardMenu && may('item.write') && (
        <CardMenu
          itemIds={multiSelect.includes(cardMenu.itemId) ? multiSelect : [cardMenu.itemId]}
          x={cardMenu.x}
          y={cardMenu.y}
          onClose={closeCardMenu}
        />
      )}
    </>
  )
}
