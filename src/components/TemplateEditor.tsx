import { useEffect, useRef, useState } from 'react'
import { Eye, Minus, Pencil, Plus, Trash2, X } from 'lucide-react'
import { InlineEdit } from './InlineEdit'
import { BAND_STYLES, BOARD_BANDS } from './BandBadge'
import { LaneEditControls } from './LaneCtl'
import { LaneSettings } from './LaneSettings'
import {
  cardTypes,
  templateAddLane,
  templateChildren,
  templateDuplicateLane,
  templateInsertLaneAfter,
  templateLaneIsRow,
  templateMoveLane,
  templateRemoveLane,
  templateRenameLane,
  templateSetLanePolicy,
  templateSetLaneWip,
  templateSetOrientation,
  templateSplitLane,
  NONE_TYPE_ID,
} from '@/domain/board'
import { STAGE_ACCENT } from '@/lib/colors'
import { cn, uid } from '@/lib/utils'
import { useStore } from '@/store'
import { useDialogFocus } from '@/lib/useDialogFocus'
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
export function TemplateEditor({
  template,
  onClose,
  isNew = false,
  startEditing = false,
}: {
  template: BoardTemplate
  onClose: () => void
  /** A template just created for this dialog: Cancel discards it, Done keeps it. */
  isNew?: boolean
  /** Open straight into the editor — the shape a new template starts in. */
  startEditing?: boolean
}) {
  const issueTypes = useStore((s) => s.issueTypes)
  const updateBoardTemplate = useStore((s) => s.updateBoardTemplate)
  const removeBoardTemplate = useStore((s) => s.removeBoardTemplate)
  const addIssueType = useStore((s) => s.addIssueType)
  const removeIssueType = useStore((s) => s.removeIssueType)
  const askConfirm = useStore((s) => s.askConfirm)
  const [editing, setEditing] = useState(startEditing)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeColor, setNewTypeColor] = useState('#8b5cf6')
  const dialogRef = useRef<HTMLDivElement>(null)
  // The editor is a dialog like any other: focus inside, Escape out, and the caret goes back to
  // the control that opened it.
  useDialogFocus(dialogRef, onClose)

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

  /** The irreversible act, kept in the detail where everything else about the template lives. */
  const removeTemplate = () =>
    askConfirm({
      title: `Delete template “${template.name}”?`,
      body: 'Boards already created from it are untouched. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => {
        removeBoardTemplate(template.id)
        onClose()
      },
    })

  /** A new template only exists because this dialog made it: Cancel takes it back out. */
  const discard = () => {
    removeBoardTemplate(template.id)
    onClose()
  }

  const types = cardTypes(issueTypes)

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
      body: 'It goes from every board and template, not just this one. Cards using it fall back to a generic item.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => {
        removeIssueType(id)
        if (template.defaultCardTypeId === id) patch({ defaultCardTypeId: undefined })
      },
    })

  const dt = 'text-micro font-bold uppercase tracking-wide text-slate-600'
  const field = 'rounded border border-slate-200 px-1.5 py-0.5 text-meta outline-none focus:border-indigo-300'
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        data-template-editor
        role="dialog"
        aria-modal="true"
        aria-label={`Template: ${template.name}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <InlineEdit
            value={template.name}
            ariaLabel="Template name"
            autoEdit={isNew}
            onSave={(name) => name.trim() && patch({ name: name.trim() })}
            className="min-w-0 truncate rounded text-title font-semibold text-slate-800 transition hover:text-indigo-700"
            inputClassName="w-56 rounded border border-indigo-300 px-1.5 py-0.5 text-title font-semibold text-slate-800 outline-none"
          />
          <span className="text-meta text-slate-600">
            {isNew
              ? 'new template — name it, then shape its design'
              : editing
                ? 'editing this design'
                : 'a board design, not its work'}
          </span>

          {!isNew && (
            <>
              <button
                onClick={() => setEditing((v) => !v)}
                className={cn(
                  'ml-auto flex items-center gap-1 rounded-md border px-2 py-1 text-meta font-medium transition',
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
              <button onClick={onClose} className="text-slate-600 hover:text-slate-600" title="Close">
                <X size={16} />
              </button>
            </>
          )}
        </div>

        <div className="space-y-4 px-4 py-3">
          {/* A customised flow can be wider than the dialog; let it scroll rather than clip. */}
          <div className="min-w-0 overflow-x-auto">
            <div className="min-w-min">
              <Lanes template={template} parentKey={null} editing={editing} />
            </div>
          </div>

          <dl className="grid grid-cols-[104px_1fr] items-start gap-x-3 gap-y-2 text-meta">
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
                <span className={cn('rounded px-1.5 py-px text-micro font-bold uppercase tracking-wide', BAND_STYLES[template.band].chip)}>
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
              ) : (
                <span className="text-slate-700">every type</span>
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

          <p className="text-micro text-slate-600">
            Cards, placements and linked boards are never part of a template — they belong to a board.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
          <p className="text-micro text-slate-600">
            {isNew
              ? 'Cancel discards this template; Done keeps it.'
              : 'Deleting a template never touches boards made from it.'}
          </p>
          {isNew ? (
            <div className="flex items-center gap-2">
              <button
                onClick={discard}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-meta font-medium text-slate-600 transition hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={onClose}
                className="rounded-md bg-sky-700 px-2.5 py-1 text-meta font-semibold text-white transition hover:bg-sky-600"
              >
                Done
              </button>
            </div>
          ) : (
            <button
              onClick={removeTemplate}
              className="flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-meta font-medium text-rose-700 transition hover:bg-rose-50"
              title="Delete this template"
            >
              <Trash2 size={13} /> Delete template
            </button>
          )}
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
        {editing ? (
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
        {lane.wipLimit !== undefined && (
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
          <Lanes template={template} parentKey={lane.key} editing={editing} />
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

