import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Minus, Pencil, Plus, Trash2, X } from 'lucide-react'
import { InlineEdit } from './InlineEdit'
import { BAND_STYLES, BOARD_BANDS } from './BandBadge'
import { LaneEditControls } from './LaneCtl'
import { LaneSettings } from './LaneSettings'
import { cardTypes, NONE_TYPE_ID } from '@/domain/board'
import {
  canRemoveTemplateFlow,
  templateAddFlow,
  templateAddLane,
  templateChildren,
  templateDuplicateLane,
  templateInsertLaneAfter,
  templateLaneIsRow,
  templateMoveFlow,
  templateMoveLane,
  templateRemoveFlow,
  templateRemoveLane,
  templateRenameFlow,
  templateRenameLane,
  templateSetLanePolicy,
  templateSetLaneWip,
  templateSetOrientation,
  templateFlowsInOrder,
  templateSplitLane,
} from '@/domain/template'
import { STAGE_ACCENT } from '@/lib/colors'
import { cn, uid } from '@/lib/utils'
import { useStore } from '@/store'
import { useDialogFocus } from '@/lib/useDialogFocus'
import type { BoardTemplate, InitiativeType, TemplateLane } from '@/domain/types'
import { VocabularySaveError } from './VocabularySaveError'
import { ColorSwatches } from './ColorSwatches'

/**
 * A template, read-only or editable.
 *
 * It opens as a **preview** — the shape the template would produce, and the settings it
 * carries — and **Edit** turns the same view into the editor, so what you are changing is
 * always what you are looking at.
 *
 * While editing, changes live in a **draft**: Save replaces the template with it, and Cancel
 * (or closing the dialog) puts the draft back to what the template says. A new template is the
 * one exception in the store — it is made up front so the dialog has an id, and Cancel takes it
 * back out.
 */
export function TemplateEditor({
  template,
  onClose,
  onUse,
  isNew = false,
  startEditing = false,
}: {
  template: BoardTemplate
  onClose: () => void
  /** Create a board from this design — the act a template exists for, offered where it is read. */
  onUse?: () => void
  /** A template just created for this dialog: Save keeps it, Cancel takes it back out. */
  isNew?: boolean
  /** Open straight into the editor — the shape a new template starts in. */
  startEditing?: boolean
}) {
  const issueTypes = useStore((s) => s.issueTypes)
  const replaceBoardTemplate = useStore((s) => s.replaceBoardTemplate)
  const removeBoardTemplate = useStore((s) => s.removeBoardTemplate)
  const addIssueType = useStore((s) => s.addIssueType)
  const removeIssueType = useStore((s) => s.removeIssueType)
  const askConfirm = useStore((s) => s.askConfirm)
  const [editing, setEditing] = useState(startEditing)
  const [draft, setDraft] = useState<BoardTemplate>(template)
  // The draft a click on Save should keep, even when the commit came from a field's blur in the
  // same gesture (a name edited and then saved without pressing Enter).
  const draftRef = useRef(draft)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeColor, setNewTypeColor] = useState('#8b5cf6')
  const [newKindName, setNewKindName] = useState('')
  const [newKindColor, setNewKindColor] = useState('#0ea5e9')
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  // The shape on screen: the draft while editing, the stored template otherwise.
  const shown = editing ? draft : template
  const orderedFlows = templateFlowsInOrder(shown)
  const cardsInOrder = orderedFlows.filter((flow) => flow.kind === 'cards')
  const kinds = shown.initiativeTypes ?? []

  const beginEdit = () => {
    setDraft(template)
    setEditing(true)
  }

  const save = () => {
    // A field still in edit commits on blur; let that land in the draft first.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    window.setTimeout(() => {
      replaceBoardTemplate(draftRef.current)
      if (isNew) {
        onClose()
        return
      }
      setEditing(false)
    }, 0)
  }

  /** Put the draft back to the stored template; a new template is taken back out of the store. */
  const cancel = () => {
    if (isNew) {
      removeBoardTemplate(template.id)
      onClose()
      return
    }
    setDraft(template)
    setEditing(false)
  }

  /** Closing is Cancel: unsaved changes are never kept behind a click-away. */
  const requestClose = () => {
    if (editing) {
      if (isNew) {
        cancel()
        return
      }
      setDraft(template)
      setEditing(false)
    }
    onClose()
  }

  // The editor is a dialog like any other: focus inside, Escape out, and the caret goes back to
  // the control that opened it.
  useDialogFocus(dialogRef, requestClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        requestClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const patch = (p: Partial<Omit<BoardTemplate, 'id' | 'lanes'>>) => setDraft((d) => ({ ...d, ...p }))

  /** A band change is a change of the design's kind: a program keeps only its initiatives flow. */
  const setBand = (band: BoardTemplate['band']) => {
    if (band === 'portfolio' || band === draft.band) return
    if (band === 'program') {
      const initiatives = templateFlowsInOrder(draft).find((flow) => flow.kind === 'initiatives')
      if (!initiatives) return
      setDraft((d) => ({
        ...d,
        band,
        flows: [{ ...initiatives, order: 0 }],
        lanes: d.lanes.filter((lane) => lane.flowKey === initiatives.key),
        defaultCardTypeId: undefined,
        wipEnforcement: undefined,
      }))
      return
    }
    setDraft((d) => {
      if (d.flows.some((flow) => flow.kind === 'cards')) return { ...d, band }
      const added = templateAddFlow(d)
      return { ...d, band, flows: added.flows, lanes: added.lanes }
    })
  }

  /** The irreversible act, kept in the detail where everything else about the template lives. */
  const removeTemplate = () =>
    askConfirm({
      title: `Delete template “${shown.name}”?`,
      body: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => {
        removeBoardTemplate(template.id)
        onClose()
      },
    })

  const types = cardTypes(issueTypes)

  const setKinds = (next: InitiativeType[]) =>
    setDraft((d) => ({ ...d, initiativeTypes: next.length > 0 ? next : undefined }))

  const addKind = () => {
    const name = newKindName.trim()
    if (!name || /^none$/i.test(name)) return
    setKinds([...kinds, { id: uid(), name, color: newKindColor }])
    setNewKindName('')
  }

  const updateKind = (id: string, p: Partial<InitiativeType>) => {
    if (p.name !== undefined && /^none$/i.test(p.name.trim())) return
    setKinds(kinds.map((kind) => (kind.id === id ? { ...kind, ...p } : kind)))
  }

  const removeKind = (id: string) => setKinds(kinds.filter((kind) => kind.id !== id))

  /** Define a brand-new type for the workspace, as Board settings does. */
  const addType = () => {
    const name = newTypeName.trim()
    if (!name) return
    addIssueType(name, newTypeColor)
    setNewTypeName('')
  }

  /**
   * Deleting a type is global — types are labels for the whole workspace, not per board —
   * so it says so before doing it, and cleans the template's own references afterwards.
   */
  const deleteType = (id: string, name: string) =>
    askConfirm({
      title: `Delete the “${name}” type?`,
      body: 'It goes from every board and template. Cards using it fall back to a generic item.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => {
        removeIssueType(id)
        if (shown.defaultCardTypeId === id) patch({ defaultCardTypeId: undefined })
      },
    })

  const dt = 'text-micro font-bold uppercase tracking-wide text-slate-600'
  const field = 'rounded border border-slate-200 px-1.5 py-0.5 text-meta outline-none focus:border-indigo-300'
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onClick={requestClose}>
      <div
        ref={dialogRef}
        data-template-editor
        role="dialog"
        aria-modal="true"
        aria-label={`Template: ${shown.name}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          {editing ? (
            <InlineEdit
              value={shown.name}
              ariaLabel="Template name"
              autoEdit={isNew}
              onSave={(name) => name.trim() && patch({ name: name.trim() })}
              className="min-w-0 truncate rounded text-title font-semibold text-slate-800 transition hover:text-indigo-700"
              inputClassName="w-56 rounded border border-indigo-300 px-1.5 py-0.5 text-title font-semibold text-slate-800 outline-none"
            />
          ) : (
            <h2 className="min-w-0 truncate text-title font-semibold text-slate-800">{shown.name}</h2>
          )}
          <span className="text-meta text-slate-600">
            {isNew
              ? 'name it, then shape the design'
              : editing
                ? 'editing this design'
                : 'a board design, not its work'}
          </span>

          {!isNew && (
            <>
              {!editing && (
                <button
                  onClick={beginEdit}
                  className="ml-auto flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-meta font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
                  title="Edit the lanes and settings"
                >
                  <Pencil size={13} /> Edit
                </button>
              )}
              <button
                onClick={requestClose}
                className={cn('text-slate-600 hover:text-slate-600', editing && 'ml-auto')}
                title={editing ? 'Discard changes and close' : 'Close'}
              >
                <X size={16} />
              </button>
            </>
          )}
        </div>

        <div className="space-y-4 px-4 py-3">
          {/* A template is one of the workspace's words: a refusal is said in the editor that made it. */}
          <VocabularySaveError lists={['boardTemplates']} />
          {/* One section per flow, initiatives first: a template is a set of designs, and the same
              column name in two flows is two different columns. A customised flow can be wider than
              the dialog; let it scroll rather than clip. */}
          <div className="min-w-0 space-y-4">
            {orderedFlows.map((flow) => (
              <section key={flow.key} data-template-flow={flow.key} className="min-w-0">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-600" />
                  <h3 className="min-w-0 text-meta font-bold uppercase tracking-wide text-slate-700">
                    {editing && flow.kind !== 'initiatives' ? (
                      <InlineEdit
                        value={flow.name}
                        onSave={(name) => {
                          if (name.trim()) patch({ flows: templateRenameFlow(shown, flow.key, name.trim()) })
                        }}
                        ariaLabel={`Rename ${flow.name}`}
                        title="Rename this flow"
                        className="rounded px-0.5 text-left uppercase tracking-wide transition hover:bg-indigo-50"
                        inputClassName="w-40 rounded border border-indigo-300 px-1 py-0.5 text-meta font-bold uppercase tracking-wide text-slate-800 outline-none"
                      />
                    ) : (
                      flow.name
                    )}
                  </h3>
                  <span className="text-micro text-slate-500">
                    {shown.lanes.filter((l) => l.flowKey === flow.key).length} lanes
                  </span>
                  {flow.kind === 'initiatives' && (
                    <span className="text-micro text-slate-600" title="The four typed sections are the organisation's; their cells are the design.">
                      the standard sections; their cells are yours
                    </span>
                  )}
                  {editing && flow.kind !== 'initiatives' && (
                    <span className="ml-auto flex items-center gap-0.5">
                      <button
                        onClick={() => patch({ flows: templateMoveFlow(shown, flow.key, -1) })}
                        disabled={cardsInOrder[0]?.key === flow.key}
                        title="Move this flow up"
                        aria-label={`Move ${flow.name} up`}
                        className="grid h-5 w-5 place-items-center rounded text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ChevronUp size={11} />
                      </button>
                      <button
                        onClick={() => patch({ flows: templateMoveFlow(shown, flow.key, 1) })}
                        disabled={cardsInOrder[cardsInOrder.length - 1]?.key === flow.key}
                        title="Move this flow down"
                        aria-label={`Move ${flow.name} down`}
                        className="grid h-5 w-5 place-items-center text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ChevronDown size={11} />
                      </button>
                      <button
                        onClick={() => {
                          const next = templateRemoveFlow(shown, flow.key)
                          if (next) setDraft((d) => ({ ...d, flows: next.flows, lanes: next.lanes }))
                        }}
                        disabled={!canRemoveTemplateFlow(shown, flow.key)}
                        title={
                          canRemoveTemplateFlow(shown, flow.key)
                            ? 'Remove this flow and its lanes'
                            : 'A template needs at least one cards flow'
                        }
                        aria-label={`Remove ${flow.name}`}
                        className="grid h-5 w-5 place-items-center rounded text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <Trash2 size={10} />
                      </button>
                    </span>
                  )}
                </div>
                <div className="min-w-0 overflow-x-auto">
                  <div className="min-w-min">
                    <Lanes
                      template={shown}
                      flowKey={flow.key}
                      parentKey={null}
                      editing={editing}
                      onChange={(lanes) => setDraft((d) => ({ ...d, lanes }))}
                    />
                  </div>
                </div>
              </section>
            ))}
            {editing && shown.band === 'team' && (
              <button
                onClick={() => {
                  const added = templateAddFlow(shown)
                  setDraft((d) => ({ ...d, flows: added.flows, lanes: added.lanes }))
                }}
                title="Another set of columns in this template"
                aria-label="Add a cards flow"
                className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-indigo-300 px-2 py-1.5 text-meta font-medium text-indigo-700 transition hover:bg-indigo-50"
              >
                <Plus size={12} /> Add a cards flow
              </button>
            )}
          </div>

          <dl className="grid grid-cols-[104px_1fr] items-start gap-x-3 gap-y-2 text-meta">
            <dt className={dt}>Board type</dt>
            <dd>
              {editing ? (
                <select
                  value={shown.band}
                  onChange={(e) => setBand(e.target.value as BoardTemplate['band'])}
                  aria-label="Template board type"
                  className={field}
                >
                  {BOARD_BANDS.filter((b) => b !== 'portfolio').map((b) => (
                    <option key={b} value={b}>
                      {BAND_STYLES[b].label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={cn('rounded px-1.5 py-px text-micro font-bold uppercase tracking-wide', BAND_STYLES[shown.band].chip)}>
                  {BAND_STYLES[shown.band].label}
                </span>
              )}
            </dd>

            <dt className={dt}>Initiative kinds</dt>
            <dd className="max-w-md space-y-1">
              {editing ? (
                <>
                  {kinds.length === 0 && <p className="text-meta text-slate-600">No kinds of your own yet.</p>}
                  {kinds.map((kind) => (
                    <div key={kind.id} className="flex items-center gap-1.5">
                      <ColorSwatches
                        value={kind.color}
                        onChange={(color) => updateKind(kind.id, { color })}
                        label={`${kind.name} colour`}
                        size="sm"
                      />
                      <InlineEdit
                        value={kind.name}
                        onSave={(name) => name.trim() && updateKind(kind.id, { name: name.trim() })}
                        ariaLabel={`${kind.name} name`}
                        title="Rename this kind"
                        className="min-w-0 flex-1 rounded px-1 py-0.5 text-left text-meta font-medium text-slate-800 transition hover:bg-slate-100"
                        inputClassName="min-w-0 flex-1 rounded border border-indigo-300 px-1 py-0.5 text-meta font-medium text-slate-800 outline-none"
                      />
                      <button
                        onClick={() => removeKind(kind.id)}
                        title={`Remove ${kind.name}`}
                        className="shrink-0 rounded p-0.5 text-slate-600 transition hover:text-rose-600"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-1 pt-0.5">
                    <ColorSwatches value={newKindColor} onChange={setNewKindColor} label="New kind colour" size="sm" />
                    <input
                      value={newKindName}
                      onChange={(e) => setNewKindName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addKind()
                      }}
                      placeholder="Define a new initiative kind…"
                      aria-label="New initiative kind name"
                      className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-meta outline-none focus:border-indigo-300"
                    />
                    <button
                      disabled={!newKindName.trim()}
                      onClick={addKind}
                      className="flex shrink-0 items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-meta font-medium text-white disabled:opacity-40"
                      title="Create this kind on the template"
                    >
                      <Plus size={11} /> Add kind
                    </button>
                  </div>
                </>
              ) : kinds.length === 0 ? (
                <span className="text-slate-600">No initiative kinds</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {kinds.map((kind) => (
                    <span
                      key={kind.id}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-px text-micro text-slate-700"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: kind.color }} />
                      {kind.name}
                    </span>
                  ))}
                </div>
              )}
            </dd>

            {shown.band === 'team' && (
              <>
            <dt className={dt}>Card types</dt>
            <dd className="max-w-md space-y-1">
              {editing ? (
                <>
                  {types.map((t) => (
                    <div key={t.id} className="flex items-center gap-1.5">
                      {t.id === NONE_TYPE_ID ? (
                        <Minus size={13} className="shrink-0 text-slate-400" />
                      ) : (
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                      )}
                      <span className="min-w-0 flex-1 truncate text-meta text-slate-700">{t.name}</span>
                      {t.id === NONE_TYPE_ID ? (
                        <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-micro font-semibold uppercase tracking-wide text-slate-600">built-in</span>
                      ) : (
                        <button
                          onClick={() => deleteType(t.id, t.name)}
                          className="shrink-0 text-slate-600 transition hover:text-rose-500"
                          title={`Delete the ${t.name} type everywhere`}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}

                  <div className="flex items-center gap-1 pt-0.5">
                    <ColorSwatches value={newTypeColor} onChange={setNewTypeColor} label="New type colour" size="sm" />
                    <input
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addType()
                      }}
                      placeholder="Define a new card type…"
                      aria-label="New card type name"
                      className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-meta outline-none focus:border-indigo-300"
                    />
                    <button
                      disabled={!newTypeName.trim()}
                      onClick={addType}
                      className="flex shrink-0 items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-meta font-medium text-white disabled:opacity-40"
                      title="Create this type and enable it on this template"
                    >
                      <Plus size={11} /> Add type
                    </button>
                  </div>
                </>
              ) : types.filter((t) => t.id !== NONE_TYPE_ID).length === 0 ? (
                <span className="text-slate-600">No card types defined</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {types
                    .filter((t) => t.id !== NONE_TYPE_ID)
                    .map((t) => (
                      <span
                        key={t.id}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-px text-micro text-slate-700"
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                        {t.name}
                      </span>
                    ))}
                </div>
              )}
            </dd>

            <dt className={dt}>Default type</dt>
            <dd>
              {editing ? (
                <select
                  value={shown.defaultCardTypeId ?? ''}
                  onChange={(e) => patch({ defaultCardTypeId: e.target.value || undefined })}
                  aria-label="Template default type"
                  className={field}
                >
                  <option value="">—</option>
                  {types
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              ) : (
                <span className="text-slate-700">
                  {shown.defaultCardTypeId
                    ? issueTypes.find((t) => t.id === shown.defaultCardTypeId)?.name ?? '—'
                    : '—'}
                </span>
              )}
            </dd>

            <dt className={dt}>WIP policy</dt>
            <dd>
              {editing ? (
                <select
                  value={shown.wipEnforcement ?? 'visualize'}
                  onChange={(e) => patch({ wipEnforcement: e.target.value as BoardTemplate['wipEnforcement'] })}
                  aria-label="Template WIP policy"
                  className={field}
                >
                  <option value="visualize">Visualize — tint at or over the limit</option>
                  <option value="justify">Justify — ask for a reason to exceed</option>
                  <option value="block">Block — refuse the move</option>
                </select>
              ) : (
                <span className="text-slate-700">{shown.wipEnforcement ?? 'visualize'}</span>
              )}
            </dd>
              </>
            )}
          </dl>

        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
          {editing ? (
            <>
              <p className="text-micro text-slate-600">
                {isNew ? 'Save keeps it; Cancel discards it.' : 'Save keeps these changes; Cancel reverts them.'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={cancel}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-meta font-medium text-slate-600 transition hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  className="rounded-md bg-indigo-600 px-2.5 py-1 text-meta font-semibold text-white transition hover:bg-indigo-500"
                >
                  Save
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={removeTemplate}
                className="flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-meta font-medium text-rose-700 transition hover:bg-rose-50"
                title="Delete this template"
              >
                <Trash2 size={13} /> Delete template
              </button>
              {onUse && (
                <button
                  onClick={onUse}
                  className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-meta font-semibold text-white transition hover:bg-indigo-500"
                  title="Create a board from this template"
                >
                  <Plus size={13} /> Use template
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** The lane tree, arranged the way the board would arrange it: columns or rows, recursively. */
function Lanes({
  template,
  flowKey,
  parentKey,
  editing,
  onChange,
}: {
  template: BoardTemplate
  /** The flow this tree belongs to; a template with several has several top levels. */
  flowKey: string
  parentKey: string | null
  editing: boolean
  onChange: (lanes: TemplateLane[]) => void
}) {
  const parent = parentKey === null ? undefined : template.lanes.find((l) => l.key === parentKey)
  const children = templateChildren(template, parentKey, flowKey)
  if (children.length === 0) return null

  return (
    <div className={cn('flex gap-1.5', parent?.orientation === 'rows' ? 'flex-col' : 'flex-row')}>
      {children.map((lane) => (
        <Lane key={lane.key} template={template} lane={lane} editing={editing} onChange={onChange} />
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

function Lane({
  template,
  lane,
  editing,
  onChange,
}: {
  template: BoardTemplate
  lane: TemplateLane
  editing: boolean
  onChange: (lanes: TemplateLane[]) => void
}) {
  const apply = onChange

  const kids = templateChildren(template, lane.key)
  const isContainer = kids.length > 0
  const isTop = lane.parentKey === null
  const flowKind = template.flows.find((flow) => flow.key === lane.flowKey)?.kind
  const fixedName = isTop && flowKind === 'initiatives'
  const rows = lane.orientation === 'rows'
  const siblings = templateChildren(template, lane.parentKey)
  /** This lane is a row of its parent's stack, not a column beside its siblings. */
  const isRow = templateLaneIsRow(template, lane.key)
  const idx = siblings.findIndex((s) => s.key === lane.key)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)

  return (
    <div
      className="flex min-w-[112px] flex-col overflow-hidden rounded border border-slate-300 bg-slate-50"
      // A lane in a split of columns claims width in proportion to the cells beneath it, which
      // is what `leafCount` is for. A lane in a split of *rows* must not: `flexBasis: 0` in a
      // column whose height is its own content is a lane with no height at all — which is how
      // a stack of rows arrived as two hairlines, headers and controls clipped away with them.
      style={isRow ? undefined : { flexGrow: leafCount(template, lane.key), flexBasis: 0 }}
    >
      <div
        className="mx-0.5 mt-0.5 flex items-center gap-1.5 rounded border border-slate-300 bg-white px-1.5 py-0.5"
        style={lane.stage ? { borderTop: `3px solid ${STAGE_ACCENT[lane.stage]}` } : undefined}
      >
        {editing && !fixedName ? (
          // The lane's own name, edited where it is read — the same as the board's headers.
          <InlineEdit
            value={lane.name}
            onSave={(name) => apply(templateRenameLane(template, lane.key, name))}
            ariaLabel={`Rename ${lane.name}`}
            title="Rename this lane"
            // Stretched to the header bar and reaching a little past it — the bar is the only
            // thing to aim at in a lane this narrow. The negative margin cancels the padding,
            // so the text inside has not moved.
            className="min-w-0 flex-1 self-stretch -my-0.5 truncate rounded py-0.5 text-left text-micro font-bold uppercase tracking-wide text-slate-700 transition hover:bg-slate-900/5"
            inputClassName="min-w-0 flex-1 self-stretch -my-0.5 rounded px-1 py-0.5 text-micro font-bold uppercase tracking-wide text-slate-800 outline-none ring-1 ring-inset ring-indigo-300"
          />
        ) : (
          <span className="truncate text-micro font-bold uppercase tracking-wide text-slate-700" title={lane.name}>
            {lane.name}
          </span>
        )}
        {lane.wipLimit !== undefined && flowKind !== 'initiatives' && (
          <span className="ml-auto shrink-0 text-micro font-semibold tabular-nums text-slate-600">
            WIP {lane.wipLimit}
          </span>
        )}
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white px-1 py-0.5">
          {/* The board's own edit cluster, over the template's lanes — the same
              capabilities, the same icons, the same refusals, from one component and
              one set of kernels, so the two never drift again. */}
          <LaneEditControls
            isLeafCell={!isContainer}
            top={isTop}
            orientation={lane.orientation}
            horizontal={!isRow}
            canMovePrev={idx > 0}
            canMoveNext={idx < siblings.length - 1}
            onMove={(d) => apply(templateMoveLane(template, lane.key, d))}
            onSplit={(o) => apply(templateSplitLane(template, lane.key, o, uid))}
            onAdd={() => apply(templateAddLane(template, lane.key, uid))}
            onFlip={() => apply(templateSetOrientation(template, lane.key, rows ? 'columns' : 'rows'))}
            onInsert={() => apply(templateInsertLaneAfter(template, lane.key, uid))}
            onDuplicate={() => apply(templateDuplicateLane(template, lane.key, uid))}
            onSettings={() => setSettingsOpen((o) => !o)}
            settingsActive={settingsOpen}
            settingsBtnRef={settingsBtnRef}
          />
        </div>
      )}

      {lane.description && (
        <p className="px-1.5 pt-1 text-micro leading-snug text-slate-600">{lane.description}</p>
      )}

      <div className="relative flex-1 p-1.5">
        {isContainer ? (
          <Lanes
            template={template}
            flowKey={lane.flowKey}
            parentKey={lane.key}
            editing={editing}
            onChange={onChange}
          />
        ) : (
          <div className="h-10 rounded border border-dashed border-slate-200 bg-white" />
        )}
        {settingsOpen && (
          <LaneSettings
            lane={lane}
            top={isTop}
            anchorRef={settingsBtnRef}
            onClose={() => setSettingsOpen(false)}
            rename={(name) => apply(templateRenameLane(template, lane.key, name))}
            setWip={(w) => apply(templateSetLaneWip(template, lane.key, w))}
            setPolicy={(text) => apply(templateSetLanePolicy(template, lane.key, text))}
            nameFixed={fixedName}
            wipHidden={flowKind === 'initiatives'}
            remove={() => {
              setSettingsOpen(false)
              apply(templateRemoveLane(template, lane.key))
            }}
          />
        )}
      </div>
    </div>
  )
}

