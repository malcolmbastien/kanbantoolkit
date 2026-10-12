import { useEffect } from 'react'
import { X } from 'lucide-react'
import { STAGE_ACCENT } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { BoardTemplate, TemplateLane } from '@/domain/types'

/**
 * A read-only look at a template: the board shape it would produce, and the settings it
 * carries. Nothing here is editable — a template is a design, and this is what it looks
 * like before you commit to using it.
 */
export function TemplatePreview({ template, onClose }: { template: BoardTemplate; onClose: () => void }) {
  const issueTypes = useStore((s) => s.issueTypes)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const typeNames = template.cardTypeIds
    ?.map((id) => issueTypes.find((t) => t.id === id)?.name)
    .filter((n): n is string => Boolean(n))
  const defaultName = template.defaultCardTypeId
    ? issueTypes.find((t) => t.id === template.defaultCardTypeId)?.name
    : undefined

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        data-template-preview
        role="dialog"
        aria-modal="true"
        aria-label={`Template preview: ${template.name}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <span className="text-sm font-semibold text-slate-800">Preview — “{template.name}”</span>
          <span className="text-[11px] text-slate-500">a board design, not its work</span>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-600" title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-3">
          {/* A customised flow can be wider than the dialog; let it scroll rather than clip. */}
          <div className="min-w-0 overflow-x-auto">
            <div className="min-w-min">
              <Lanes template={template} parentKey={null} />
            </div>
          </div>

          <dl className="grid grid-cols-[104px_1fr] gap-x-3 gap-y-1 text-[12px]">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Card types</dt>
            <dd className="text-slate-700">{typeNames?.length ? typeNames.join(', ') : 'every type'}</dd>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Default type</dt>
            <dd className="text-slate-700">{defaultName ?? '—'}</dd>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">WIP policy</dt>
            <dd className="text-slate-700">{template.wipEnforcement ?? 'visualize'}</dd>
          </dl>

          <p className="text-[10px] text-slate-400">
            Cards, placements and linked boards are never part of a template — they belong to a board.
          </p>
        </div>
      </div>
    </div>
  )
}

/** The lane tree, arranged the way the board would arrange it: columns or rows, recursively. */
function Lanes({ template, parentKey }: { template: BoardTemplate; parentKey: string | null }) {
  const parent = parentKey === null ? undefined : template.lanes.find((l) => l.key === parentKey)
  const children = template.lanes.filter((l) => l.parentKey === parentKey).sort((a, b) => a.order - b.order)
  if (children.length === 0) return null

  return (
    <div className={cn('flex gap-1.5', parent?.orientation === 'rows' ? 'flex-col' : 'flex-row')}>
      {children.map((lane) => (
        <Lane key={lane.key} template={template} lane={lane} />
      ))}
    </div>
  )
}

/**
 * How many cells sit beneath a lane. A container claims width in proportion to that, so
 * its own children get the same room a top-level column has — the same rule the board
 * uses, and without it a split would be squeezed into its parent and clipped.
 */
function leafCount(template: BoardTemplate, key: string): number {
  const kids = template.lanes.filter((l) => l.parentKey === key)
  return kids.length === 0 ? 1 : kids.reduce((n, k) => n + leafCount(template, k.key), 0)
}

function Lane({ template, lane }: { template: BoardTemplate; lane: TemplateLane }) {
  const isContainer = template.lanes.some((l) => l.parentKey === lane.key)
  return (
    <div
      className="flex min-w-[112px] flex-col overflow-hidden rounded border border-slate-300 bg-slate-50"
      style={{ flexGrow: leafCount(template, lane.key), flexBasis: 0 }}
    >
      <div
        className="flex items-center gap-1.5 bg-slate-100 px-1.5 py-0.5"
        style={lane.stage ? { borderTop: `3px solid ${STAGE_ACCENT[lane.stage]}` } : undefined}
      >
        <span className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-700" title={lane.name}>
          {lane.name}
        </span>
        {lane.wipLimit !== undefined && (
          <span className="ml-auto shrink-0 text-[9px] font-semibold tabular-nums text-slate-400">WIP {lane.wipLimit}</span>
        )}
      </div>
      {lane.description && <p className="px-1.5 pt-1 text-[9px] leading-snug text-slate-500">{lane.description}</p>}
      <div className="flex-1 p-1.5">
        {isContainer ? (
          <Lanes template={template} parentKey={lane.key} />
        ) : (
          <div className="h-10 rounded border border-dashed border-slate-200 bg-white" />
        )}
      </div>
    </div>
  )
}
