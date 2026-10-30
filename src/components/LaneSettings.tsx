import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Info, Trash2 } from 'lucide-react'
import type { Lane } from '@/domain/types'

/** The settings panel's own width (`w-72`) — the popover clamps against it. */
const PANEL_W = 288

/**
 * A lane's policy, revealed by hovering (or focusing) the info icon in the lane
 * header. Positioned `fixed` so the lane's rounded clipping can't cut it off.
 */
export function LanePolicy({ policy }: { policy: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={show}
        onFocus={show}
        onMouseLeave={() => setPos(null)}
        onBlur={() => setPos(null)}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 rounded p-0.5 text-slate-600 hover:bg-slate-200 hover:text-slate-700"
        title="Lane policy"
        aria-label="Lane policy"
      >
        <Info size={12} />
      </button>
      {pos && (
        <div
          role="tooltip"
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 w-64 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-meta leading-relaxed text-slate-700 shadow-xl"
        >
          <div className="mb-0.5 text-micro font-bold uppercase tracking-wide text-slate-600">Policy</div>
          <p className="whitespace-pre-wrap">{policy}</p>
        </div>
      )}
    </>
  )
}

interface LaneSettingsProps {
  /** Structural on purpose: a template lane edits through this same popover. */
  lane: Pick<Lane, 'name' | 'wipLimit' | 'description'>
  /**
   * Top-level typed columns: their name is the team's own, so it is editable here like any
   * other lane's — only removal is unavailable, because a board must keep one column per stage.
   */
  top: boolean
  /** The settings button, to anchor the popover. */
  anchorRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  rename: (name: string) => void
  setWip: (wipLimit: number | undefined) => void
  setPolicy: (text: string | undefined) => void
  remove: () => void
  /** False when the lane may not be removed — a cards lane with work in it. */
  canRemove?: boolean
  /** Why removal is refused, said beside the disabled button. */
  removeReason?: string
}

/**
 * The lane settings popover: name, WIP limit, policy (description) and remove.
 * Fields commit on blur / Enter; it closes on Escape, a click away, or Done.
 */
export function LaneSettings({ lane, top, anchorRef, onClose, rename, setWip, setPolicy, remove, canRemove = true, removeReason }: LaneSettingsProps) {
  const [name, setNameDraft] = useState(lane.name)
  const [wip, setWipDraft] = useState(lane.wipLimit !== undefined ? String(lane.wipLimit) : '')
  const [policy, setPolicyDraft] = useState(lane.description ?? '')
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Anchor under the settings button; keep it in place while the board scrolls. It is clamped
  // to the viewport on both axes — a popover taller than the room below the button would put
  // its own Done button out of reach.
  const update = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect()
    if (!r) return
    const h = panelRef.current?.offsetHeight ?? 0
    const next = {
      top: Math.max(8, Math.min(r.bottom + 4, h ? window.innerHeight - h - 8 : r.bottom + 4)),
      left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8)),
    }
    setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next))
  }, [anchorRef])

  useEffect(() => {
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [update])

  // Measured once it is on screen — and on every change after that, so a policy being typed
  // into is a panel that re-clamps rather than one that walks off the bottom of the window.
  useLayoutEffect(update)

  // Close on Escape or a click outside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [anchorRef, onClose])

  if (!pos) return null

  // One field style and one label style, and they are the app's: this popover used to be a dark
  // panel of its own, which put its text a step below the rest of the interface and left the
  // labels darker than the surface they sat on.
  const field =
    'w-full rounded border border-slate-200 px-2 py-1.5 text-body text-slate-800 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-400'
  const label = 'mb-1 block text-micro font-bold uppercase tracking-wide text-slate-600'
  const hint = 'mt-1 text-meta text-slate-600'

  return (
    <div
      ref={panelRef}
      data-lane-settings
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-50 w-72 space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-meta text-slate-800 shadow-2xl"
    >
      <div>
        <label className={label} htmlFor="lane-name">
          Name
        </label>
        <input
          id="lane-name"
          value={name}
          onChange={(e) => {
            setNameDraft(e.target.value)
            const v = e.target.value.trim()
            if (v) rename(v)
          }}
          onBlur={() => {
            if (!name.trim()) setNameDraft(lane.name)
          }}
          className={field}
        />
      </div>

      <div>
        <label className={label} htmlFor="lane-wip">
          WIP limit
        </label>
        <input
          id="lane-wip"
          type="number"
          min={0}
          value={wip}
          onChange={(e) => {
            setWipDraft(e.target.value)
            const v = e.target.value.trim()
            setWip(v === '' ? undefined : Math.max(0, Math.floor(Number(v) || 0)))
          }}
          placeholder="none"
          className={`${field} w-20`}
        />
      </div>

      <div>
        <label className={label} htmlFor="lane-policy">
          Policy
        </label>
        <textarea
          id="lane-policy"
          value={policy}
          onChange={(e) => {
            const v = e.target.value
            setPolicyDraft(v)
            setPolicy(v.trim() ? v : undefined)
          }}
          rows={3}
          placeholder="Rules of play — entry / exit criteria…"
          className={`${field} resize-y leading-relaxed`}
        />
        <p className={hint}>Shown to the board via the lane's info icon.</p>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-2">
        {top ? (
          <span />
        ) : (
          <button
            onClick={remove}
            disabled={!canRemove}
            title={canRemove ? 'Remove this lane' : removeReason ?? 'This lane cannot be removed'}
            className="flex items-center gap-1 rounded border border-rose-200 px-2 py-1 font-medium text-rose-700 transition hover:bg-rose-50 disabled:pointer-events-none disabled:border-slate-200 disabled:text-slate-400"
          >
            <Trash2 size={11} /> Remove lane
          </button>
        )}
        <button onClick={onClose} className="rounded bg-indigo-600 px-2.5 py-1 font-medium text-white transition hover:bg-indigo-700">
          Done
        </button>
      </div>
    </div>
  )
}
