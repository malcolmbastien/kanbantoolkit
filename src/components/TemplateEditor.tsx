import { useEffect, useState } from 'react'
import { Eye, Pencil, Plus, Trash2, X } from 'lucide-react'
import { InlineEdit } from './InlineEdit'
import { BAND_STYLES, BOARD_BANDS } from './BandBadge'
import {
  cardTypes,
  templateAddLane,
  templateChildren,
  templateMoveLane,
  templateRemoveLane,
  templateRenameLane,
  templateSetLanePolicy,
  templateSetLaneWip,
  templateSetOrientation,
  templateSplitLane,
} from '@/domain/board'
import { STAGE_ACCENT } from '@/lib/colors'
import { cn, uid } from '@/lib/utils'
import { useStore } from '@/store'
import type { BoardTemplate, TemplateLane } from '@/domain/types'

/**
 * A template, read-only or editable.
 *
 * It opens as a **preview** — the shape the template would produce, and the settings it
 * carries — and **Edit** turns the same view into the editor, so what you are changing is
 * always what you are looking at.
 *
 * Edits are immediate rather than batched behind Save/Cancel. A template is a small
 * design, every action has an inverse (split → remove, and so on), and a dialog is a bad
 * place to strand unsaved work.
 */
export function TemplateEditor({ template, onClose }: { template: BoardTemplate; onClose: () => void }) {
  const issueTypes = useStore((s) => s.issueTypes)
  const updateBoardTemplate = useStore((s) => s.updateBoardTemplate)
  const addIssueType = useStore((s) => s.addIssueType)
  const removeIssueType = useStore((s) => s.removeIssueType)
  const askConfirm = useStore((s) => s.askConfirm)
  const [editing, setEditing] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeColor, setNewTypeColor] = useState('#8b5cf6')

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

  const patch = (p: Partial<Omit<BoardTemplate, 'id' | 'lanes'>>) => updateBoardTemplate(template.id, p)

  const types = cardTypes(issueTypes)
  const allowed = template.cardTypeIds ?? types.map((t) => t.id)
  const toggleType = (id: string) => {
    const next = allowed.includes(id) ? allowed.filter((x) => x !== id) : [...allowed, id]
    if (next.length === 0) return // at least one type must stay available
    patch({
      cardTypeIds: next,
      // Keep the default inside the allowed set.
      ...(template.defaultCardTypeId && !next.includes(template.defaultCardTypeId)
        ? { defaultCardTypeId: next[0] }
        : {}),
    })
  }

  /** Define a brand-new type and enable it on this template, as Board settings does. */
  const addType = () => {
    const name = newTypeName.trim()
    if (!name) return
    const id = addIssueType(name, newTypeColor)
    patch({ cardTypeIds: [...allowed, id] })
    setNewTypeName('')
  }

  /**
   * Deleting a type is global — types are labels for the whole workspace, not per board —
   * so it says so before doing it, and cleans the template's own references afterwards.
   */
  const deleteType = (id: string, name: string) =>
    askConfirm({
      title: `Delete the “${name}” type?`,
      body: 'It goes from every board and template, not just this one. Cards using it fall back to a generic item.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => {
        removeIssueType(id)
        patch({
          ...(template.cardTypeIds ? { cardTypeIds: template.cardTypeIds.filter((x) => x !== id) } : {}),
          ...(template.defaultCardTypeId === id ? { defaultCardTypeId: undefined } : {}),
        })
      },
    })

  const dt = 'text-[10px] font-bold uppercase tracking-wide text-slate-400'
  const field = 'rounded border border-slate-200 px-1.5 py-0.5 text-[11px] outline-none focus:border-indigo-300'
  const typeNames = template.cardTypeIds
    ?.map((id) => issueTypes.find((t) => t.id === id)?.name)
    .filter((n): n is string => Boolean(n))

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        data-template-editor
        role="dialog"
        aria-modal="true"
        aria-label={`Template: ${template.name}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          {editing ? (
            <InlineEdit
              autoEdit
              value={template.name}
              ariaLabel="Template name"
              onSave={(name) => name.trim() && patch({ name: name.trim() })}
              className="min-w-0"
              inputClassName="w-56 rounded border border-indigo-300 px-1.5 py-0.5 text-sm font-semibold text-slate-800 outline-none"
            />
          ) : (
            <span className="text-sm font-semibold text-slate-800">{template.name}</span>
          )}
          <span className="text-[11px] text-slate-500">
            {editing ? 'editing this design' : 'a board design, not its work'}
          </span>

          <button
            onClick={() => setEditing((v) => !v)}
            className={cn(
              'ml-auto flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition',
              editing
                ? 'border-emerald-400/60 bg-emerald-50 text-emerald-700'
                : 'border-slate-300 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700',
            )}
            title={editing ? 'Stop editing' : 'Edit this template’s lanes and settings'}
          >
            {editing ? (
              <>
                <Eye size={13} /> Done
              </>
            ) : (
              <>
                <Pencil size={13} /> Edit
              </>
            )}
          </button>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-3">
          {/* A customised flow can be wider than the dialog; let it scroll rather than clip. */}
          <div className="min-w-0 overflow-x-auto">
            <div className="min-w-min">
              <Lanes template={template} parentKey={null} editing={editing} />
            </div>
          </div>

          <dl className="grid grid-cols-[104px_1fr] items-start gap-x-3 gap-y-2 text-[12px]">
            <dt className={dt}>Board type</dt>
            <dd>
              {editing ? (
                <select
                  value={template.band}
                  onChange={(e) => patch({ band: e.target.value as BoardTemplate['band'] })}
                  aria-label="Template board type"
                  className={field}
                >
                  {BOARD_BANDS.map((b) => (
                    <option key={b} value={b}>
                      {BAND_STYLES[b].label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={cn('rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wide', BAND_STYLES[template.band].chip)}>
                  {BAND_STYLES[template.band].label}
                </span>
              )}
            </dd>

            <dt className={dt}>Card types</dt>
            <dd className="max-w-md space-y-1">
              {editing ? (
                <>
                  {types.map((t) => (
                    <div key={t.id} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={allowed.includes(t.id)}
                        onChange={() => toggleType(t.id)}
                        aria-label={`Allow ${t.name} on this template`}
                      />
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">{t.name}</span>
                      <button
                        onClick={() => deleteType(t.id, t.name)}
                        className="shrink-0 text-slate-300 transition hover:text-rose-500"
                        title={`Delete the ${t.name} type everywhere`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}

                  <div className="flex items-center gap-1 pt-0.5">
                    <input
                      type="color"
                      value={newTypeColor}
                      onChange={(e) => setNewTypeColor(e.target.value)}
                      title="New type colour"
                      className="h-6 w-6 shrink-0 cursor-pointer rounded border border-slate-200 bg-white"
                    />
                    <input
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addType()
                      }}
                      placeholder="Define a new card type…"
                      aria-label="New card type name"
                      className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] outline-none focus:border-indigo-300"
                    />
                    <button
                      disabled={!newTypeName.trim()}
                      onClick={addType}
                      className="flex shrink-0 items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40"
                      title="Create this type and enable it on this template"
                    >
                      <Plus size={11} /> Add type
                    </button>
                  </div>
                </>
              ) : (
                <span className="text-slate-700">{typeNames?.length ? typeNames.join(', ') : 'every type'}</span>
              )}
            </dd>

            <dt className={dt}>Default type</dt>
            <dd>
              {editing ? (
                <select
                  value={template.defaultCardTypeId ?? ''}
                  onChange={(e) => patch({ defaultCardTypeId: e.target.value || undefined })}
                  aria-label="Template default type"
                  className={field}
                >
                  <option value="">—</option>
                  {types
                    .filter((t) => allowed.includes(t.id))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              ) : (
                <span className="text-slate-700">
                  {template.defaultCardTypeId
                    ? issueTypes.find((t) => t.id === template.defaultCardTypeId)?.name ?? '—'
                    : '—'}
                </span>
              )}
            </dd>

            <dt className={dt}>WIP policy</dt>
            <dd>
              {editing ? (
                <select
                  value={template.wipEnforcement ?? 'visualize'}
                  onChange={(e) => patch({ wipEnforcement: e.target.value as BoardTemplate['wipEnforcement'] })}
                  aria-label="Template WIP policy"
                  className={field}
                >
                  <option value="visualize">Visualize — tint, moves always allowed</option>
                  <option value="justify">Justify — ask for a reason to exceed</option>
                  <option value="block">Block — refuse moves that would exceed</option>
                </select>
              ) : (
                <span className="text-slate-700">{template.wipEnforcement ?? 'visualize'}</span>
              )}
            </dd>
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
function Lanes({
  template,
  parentKey,
  editing,
}: {
  template: BoardTemplate
  parentKey: string | null
  editing: boolean
}) {
  const parent = parentKey === null ? undefined : template.lanes.find((l) => l.key === parentKey)
  const children = templateChildren(template, parentKey)
  if (children.length === 0) return null

  return (
    <div className={cn('flex gap-1.5', parent?.orientation === 'rows' ? 'flex-col' : 'flex-row')}>
      {children.map((lane) => (
        <Lane key={lane.key} template={template} lane={lane} editing={editing} />
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
  const kids = templateChildren(template, key)
  return kids.length === 0 ? 1 : kids.reduce((n, k) => n + leafCount(template, k.key), 0)
}

function Lane({ template, lane, editing }: { template: BoardTemplate; lane: TemplateLane; editing: boolean }) {
  const setTemplateLanes = useStore((s) => s.setTemplateLanes)
  const apply = (next: TemplateLane[]) => setTemplateLanes(template.id, next)

  const kids = templateChildren(template, lane.key)
  const isContainer = kids.length > 0
  const isTop = lane.parentKey === null
  const rows = lane.orientation === 'rows'
  const siblings = templateChildren(template, lane.parentKey)
  const idx = siblings.findIndex((s) => s.key === lane.key)

  return (
    <div
      className="flex min-w-[112px] flex-col overflow-hidden rounded border border-slate-300 bg-slate-50"
      style={{ flexGrow: leafCount(template, lane.key), flexBasis: 0 }}
    >
      <div
        className="mx-0.5 mt-0.5 flex items-center gap-1.5 rounded border border-slate-300 bg-white px-1.5 py-0.5"
        style={lane.stage ? { borderTop: `3px solid ${STAGE_ACCENT[lane.stage]}` } : undefined}
      >
        {editing ? (
          // A plain input rather than InlineEdit: this one autofocuses, which scrolls a
          // long lane name to its end and hides the start while you are reading it.
          <input
            value={lane.name}
            onChange={(e) => apply(templateRenameLane(template, lane.key, e.target.value))}
            aria-label={`Lane name: ${lane.name}`}
            className="w-full min-w-0 rounded border border-indigo-300 px-1 py-px text-[10px] font-bold uppercase tracking-wide text-slate-800 outline-none"
          />
        ) : (
          <>
            <span className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-700" title={lane.name}>
              {lane.name}
            </span>
            {lane.wipLimit !== undefined && (
              <span className="ml-auto shrink-0 text-[9px] font-semibold tabular-nums text-slate-400">
                WIP {lane.wipLimit}
              </span>
            )}
          </>
        )}
      </div>

      {editing && (
        <>
          <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white px-1 py-0.5">
            {isContainer ? (
              <>
                <Ctl title="Add a lane to this split" onClick={() => apply(templateAddLane(template, lane.key, uid))}>
                  ＋
                </Ctl>
                {!isTop && (
                  <Ctl
                    title="Flip columns ↔ rows"
                    onClick={() => apply(templateSetOrientation(template, lane.key, rows ? 'columns' : 'rows'))}
                  >
                    ⟷
                  </Ctl>
                )}
              </>
            ) : (
              <>
                <Ctl title="Split into columns" onClick={() => apply(templateSplitLane(template, lane.key, 'columns', uid))}>
                  ▤
                </Ctl>
                <Ctl title="Split into rows" onClick={() => apply(templateSplitLane(template, lane.key, 'rows', uid))}>
                  ▥
                </Ctl>
              </>
            )}
            {!isTop && (
              <>
                {rows ? (
                  <>
                    <Ctl title="Move up" disabled={idx <= 0} onClick={() => apply(templateMoveLane(template, lane.key, -1))}>
                      ▲
                    </Ctl>
                    <Ctl
                      title="Move down"
                      disabled={idx >= siblings.length - 1}
                      onClick={() => apply(templateMoveLane(template, lane.key, 1))}
                    >
                      ▼
                    </Ctl>
                  </>
                ) : (
                  <>
                    <Ctl title="Move left" disabled={idx <= 0} onClick={() => apply(templateMoveLane(template, lane.key, -1))}>
                      ◀
                    </Ctl>
                    <Ctl
                      title="Move right"
                      disabled={idx >= siblings.length - 1}
                      onClick={() => apply(templateMoveLane(template, lane.key, 1))}
                    >
                      ▶
                    </Ctl>
                  </>
                )}
                <Ctl title="Remove this lane" danger onClick={() => apply(templateRemoveLane(template, lane.key))}>
                  ×
                </Ctl>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-1 py-0.5">
            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">WIP</span>
            <input
              type="number"
              min={1}
              value={lane.wipLimit ?? ''}
              onChange={(e) =>
                apply(templateSetLaneWip(template, lane.key, e.target.value === '' ? undefined : Number(e.target.value)))
              }
              placeholder="—"
              aria-label={`WIP limit: ${lane.name}`}
              className="w-10 rounded border border-slate-200 px-1 py-px text-[10px] outline-none focus:border-indigo-300"
            />
          </div>

          <div className="border-b border-slate-200 bg-white px-1 py-0.5">
            <input
              value={lane.description ?? ''}
              onChange={(e) =>
                apply(templateSetLanePolicy(template, lane.key, e.target.value.trim() ? e.target.value : undefined))
              }
              placeholder="Policy…"
              aria-label={`Lane policy: ${lane.name}`}
              className="w-full rounded border border-slate-200 px-1 py-px text-[9px] outline-none focus:border-indigo-300"
            />
          </div>
        </>
      )}

      {lane.description && !editing && (
        <p className="px-1.5 pt-1 text-[9px] leading-snug text-slate-500">{lane.description}</p>
      )}

      <div className="flex-1 p-1.5">
        {isContainer ? (
          <Lanes template={template} parentKey={lane.key} editing={editing} />
        ) : (
          <div className="h-10 rounded border border-dashed border-slate-200 bg-white" />
        )}
      </div>
    </div>
  )
}

function Ctl({
  children,
  onClick,
  title,
  disabled,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'rounded px-1 py-px text-[10px] font-semibold transition',
        disabled
          ? 'cursor-not-allowed bg-slate-100 text-slate-300'
          : danger
            ? 'bg-slate-100 text-slate-500 hover:bg-rose-100 hover:text-rose-600'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
      )}
    >
      {children}
    </button>
  )
}
