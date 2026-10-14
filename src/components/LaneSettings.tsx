import { useEffect, useRef, useState, type RefObject } from 'react'
import { Info, Trash2 } from 'lucide-react'
import type { Lane } from '@/domain/types'

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
        className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
        title="Lane policy"
        aria-label="Lane policy"
      >
        <Info size={12} />
      </button>
      {pos && (
        <div
          role="tooltip"
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 w-60 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-2 text-[11px] leading-relaxed text-slate-100 shadow-xl"
        >
          <div className="mb-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">Policy</div>
          <p className="whitespace-pre-wrap">{policy}</p>
        </div>
      )}
    </>
  )
}

interface LaneSettingsProps {
  lane: Lane
  /** Top-level typed columns are fixed: name read-only, no remove. */
  top: boolean
  /** The settings button, to anchor the popover. */
  anchorRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  rename: (name: string) => void
  setWip: (wipLimit: number | undefined) => void
  setPolicy: (text: string | undefined) => void
  remove: () => void
}

/**
 * The lane settings popover: name, WIP limit, policy (description) and remove.
 * Fields commit on blur / Enter; it closes on Escape, a click away, or Done.
 */
export function LaneSettings({ lane, top, anchorRef, onClose, rename, setWip, setPolicy, remove }: LaneSettingsProps) {
  const [name, setNameDraft] = useState(lane.name)
  const [wip, setWipDraft] = useState(lane.wipLimit !== undefined ? String(lane.wipLimit) : '')
  const [policy, setPolicyDraft] = useState(lane.description ?? '')
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Anchor under the settings button; keep it in place while the board scrolls.
  useEffect(() => {
    const update = () => {
      const r = anchorRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 272)) })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchorRef])

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

  const field = 'w-full rounded border border-slate-600 bg-slate-700 px-1.5 py-1 text-slate-100 outline-none focus:ring-2 focus:ring-indigo-400'
  const label = 'mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-400'

  return (
    <div
      ref={panelRef}
      data-lane-settings
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-50 w-64 space-y-3 rounded-lg border border-slate-600 bg-slate-800 p-3 text-[11px] text-slate-100 shadow-2xl"
    >
      <div>
        <label className={label} htmlFor="lane-name">
          Name
        </label>
        <input
          id="lane-name"
          value={name}
          disabled={top}
          onChange={(e) => {
            setNameDraft(e.target.value)
            const v = e.target.value.trim()
            if (v) rename(v)
          }}
          onBlur={() => {
            if (!name.trim()) setNameDraft(lane.name)
          }}
          className={`${field} text-[12px] disabled:opacity-60`}
        />
        {top && <p className="mt-1 text-[10px] text-slate-400">Typed columns are fixed — split to refine.</p>}
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
          className={`${field} w-20 text-[12px]`}
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
          className={`${field} resize-y text-[11px] leading-relaxed placeholder:text-slate-400`}
        />
        <p className="mt-1 text-[10px] text-slate-400">Shown to the board via the lane's info icon.</p>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-700 pt-2">
        {top ? (
          <span />
        ) : (
          <button
            onClick={remove}
            className="flex items-center gap-1 rounded border border-rose-500/50 px-2 py-1 font-medium text-rose-300 hover:bg-rose-500/20"
          >
            <Trash2 size={11} /> Remove lane
          </button>
        )}
        <button onClick={onClose} className="rounded bg-slate-600 px-2.5 py-1 font-medium text-white hover:bg-slate-500">
          Done
        </button>
      </div>
    </div>
  )
}
