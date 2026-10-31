import { useMemo, useRef, useState } from 'react'
import { FileUp, Upload, X } from 'lucide-react'
import { cardTypes, defaultCardTypeId } from '@/domain/board'
import { inferStage, parseImport, planImport, type ImportMapping, type ImportSource, type ParsedImport } from '@/domain/import'
import { STAGE_LABELS } from '@/domain/lanes'
import { useDialogFocus } from '@/lib/useDialogFocus'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Stage } from '@/domain/types'

const FIELD =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none focus:ring-2 focus:ring-indigo-300'
const BUTTON =
  'rounded-md border border-slate-200 px-2.5 py-1 text-meta font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40'

/**
 * A guided import from Trello or Jira.
 *
 * The file is parsed into a neutral description, then the one thing the source cannot answer is
 * asked: which of our four stages each source list means, which of our types each source type is,
 * and who each source person is. The preview is the plan the store will create — nothing is written
 * until Import, and Cancel leaves the workspace exactly as it was.
 */
export function ImportBoardDialog({ onClose }: { onClose: () => void }) {
  const users = useStore((s) => s.users)
  const issueTypes = useStore((s) => s.issueTypes)
  const importBoard = useStore((s) => s.importBoard)
  const selectBoard = useStore((s) => s.selectBoard)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, onClose)

  const [source, setSource] = useState<ImportSource>('trello')
  const [parsed, setParsed] = useState<ParsedImport | undefined>()
  const [mapping, setMapping] = useState<ImportMapping>({ listStages: {} })
  const [boardName, setBoardName] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | undefined>()
  const fileRef = useRef<HTMLInputElement>(null)

  const types = cardTypes(issueTypes)
  const defaultTypeId = defaultCardTypeId(issueTypes) ?? types[0]?.id ?? ''
  const typeNames = parsed ? [...new Set(parsed.cards.map((card) => card.typeName).filter((name): name is string => Boolean(name)))] : []

  const read = async (file: File | undefined) => {
    if (!file) return
    setError(undefined)
    setFileName(file.name)
    try {
      const next = parseImport(await file.text(), source)
      setParsed(next)
      setBoardName(next.boardName)
      setMapping({
        listStages: Object.fromEntries(next.lists.map((list) => [list.key, inferStage(list.name)])),
        types: Object.fromEntries(
          [...new Set(next.cards.map((card) => card.typeName).filter((name): name is string => Boolean(name)))].map((name) => [
            name,
            types.find((type) => type.name.toLowerCase() === name.toLowerCase())?.id ?? defaultTypeId,
          ]),
        ),
        people: Object.fromEntries(
          next.people.map((person) => [
            person.key,
            users.find((user) => user.name.toLowerCase() === person.name.toLowerCase())?.id ?? null,
          ]),
        ),
      })
    } catch (reason) {
      setParsed(undefined)
      setError(reason instanceof Error ? reason.message : 'That file could not be read.')
    }
  }

  const plan = useMemo(() => {
    if (!parsed) return undefined
    try {
      return planImport(parsed, mapping, {
        types,
        users,
        defaultTypeId,
        includeArchived,
        boardName,
      })
    } catch (reason) {
      return undefined
    }
  }, [parsed, mapping, types, users, defaultTypeId, includeArchived, boardName])

  const setListStage = (key: string, stage: Stage) =>
    setMapping((current) => ({ ...current, listStages: { ...current.listStages, [key]: stage } }))
  const setType = (name: string, id: string) =>
    setMapping((current) => ({ ...current, types: { ...(current.types ?? {}), [name]: id } }))
  const setPerson = (key: string, id: string) =>
    setMapping((current) => ({ ...current, people: { ...(current.people ?? {}), [key]: id === '__new' ? null : id } }))

  const importNow = () => {
    if (!plan) return
    const id = importBoard(plan)
    selectBoard(id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        data-import-board-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-board-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <FileUp size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="import-board-title" className="text-body font-semibold text-slate-900">
              Import a board
            </h2>
            <p className="mt-0.5 text-meta text-slate-600">
              Bring a Trello board export or a Jira CSV in as one board. Nothing is written until you choose Import.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close import" title="Close" className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-micro font-semibold uppercase tracking-wide text-slate-500">
              Source
              <select
                value={source}
                onChange={(event) => {
                  setSource(event.target.value as ImportSource)
                  setParsed(undefined)
                  setFileName('')
                  setError(undefined)
                }}
                className={cn(FIELD, 'mt-1 block w-40')}
                aria-label="Import source"
              >
                <option value="trello">Trello (JSON)</option>
                <option value="jira">Jira (CSV)</option>
              </select>
            </label>
            <label className="text-micro font-semibold uppercase tracking-wide text-slate-500">
              File
              <span className="mt-1 flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept={source === 'trello' ? '.json,application/json' : '.csv,text/csv'}
                  aria-label="Import file"
                  onChange={(event) => {
                    void read(event.target.files?.[0])
                    event.target.value = ''
                  }}
                  className="hidden"
                />
                <button className={BUTTON} onClick={() => fileRef.current?.click()}>
                  <Upload size={11} className="mr-1 inline" /> Choose {source === 'trello' ? 'JSON' : 'CSV'}
                </button>
                <span className="max-w-[18rem] truncate text-meta text-slate-500">{fileName || 'No file chosen'}</span>
              </span>
            </label>
            {parsed && (
              <label className="ml-auto text-micro font-semibold uppercase tracking-wide text-slate-500">
                Board name
                <input value={boardName} onChange={(event) => setBoardName(event.target.value)} aria-label="Imported board name" className={cn(FIELD, 'mt-1 block w-56')} />
              </label>
            )}
          </div>

          {error && <p className="mt-3 rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">{error}</p>}

          {parsed && (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <section className="rounded-lg border border-slate-200 p-3">
                  <h3 className="text-micro font-bold uppercase tracking-wide text-slate-500">Lists → stages</h3>
                  <div className="mt-1 space-y-1.5">
                    {parsed.lists.map((list) => (
                      <label key={list.key} className="flex items-center gap-2 text-meta text-slate-700">
                        <span className="min-w-0 flex-1 truncate">{list.name}</span>
                        <select
                          value={mapping.listStages[list.key] ?? inferStage(list.name)}
                          onChange={(event) => setListStage(list.key, event.target.value as Stage)}
                          className={FIELD}
                          aria-label={`Stage for ${list.name}`}
                        >
                          {(['backlog', 'notStarted', 'inProgress', 'done'] as Stage[]).map((stage) => (
                            <option key={stage} value={stage}>
                              {STAGE_LABELS[stage]}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 p-3">
                  <h3 className="text-micro font-bold uppercase tracking-wide text-slate-500">People</h3>
                  {parsed.people.length === 0 ? (
                    <p className="mt-1 text-meta text-slate-500">No people named in this file.</p>
                  ) : (
                    <div className="mt-1 space-y-1.5">
                      {parsed.people.map((person) => (
                        <label key={person.key} className="flex items-center gap-2 text-meta text-slate-700">
                          <span className="min-w-0 flex-1 truncate">{person.name}</span>
                          <select
                            value={mapping.people?.[person.key] ?? '__new'}
                            onChange={(event) => setPerson(person.key, event.target.value)}
                            className={FIELD}
                            aria-label={`Person for ${person.name}`}
                          >
                            <option value="__new">Create a new person</option>
                            {users.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              {typeNames.length > 0 && (
                <section className="mt-3 rounded-lg border border-slate-200 p-3">
                  <h3 className="text-micro font-bold uppercase tracking-wide text-slate-500">Types</h3>
                  <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                    {typeNames.map((name) => (
                      <label key={name} className="flex items-center gap-2 text-meta text-slate-700">
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        <select
                          value={mapping.types?.[name] ?? defaultTypeId}
                          onChange={(event) => setType(name, event.target.value)}
                          className={FIELD}
                          aria-label={`Type for ${name}`}
                        >
                          {types.map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              <label className="mt-3 flex items-center gap-2 text-meta text-slate-700">
                <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />
                Include archived cards
              </label>

              <div data-import-preview className="mt-3 rounded-lg bg-slate-50 p-3 text-meta text-slate-700">
                <p>
                  <span className="font-semibold">{plan?.cards.length ?? 0}</span> card{(plan?.cards.length ?? 0) === 1 ? '' : 's'} in{' '}
                  <span className="font-semibold">{parsed.lists.length}</span> source list{parsed.lists.length === 1 ? '' : 's'}, on one board
                  with four stages.
                </p>
                {plan && plan.people.length > 0 && <p className="mt-0.5 text-micro">Creates {plan.people.map((person) => person.name).join(', ')}.</p>}
                {plan && plan.warnings.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-micro text-amber-800">
                    {plan.warnings.slice(0, 8).map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                    {plan.warnings.length > 8 && <li>and {plan.warnings.length - 8} more…</li>}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button className={BUTTON} onClick={onClose}>
            Cancel
          </button>
          <button
            disabled={!plan || (plan.cards.length === 0 && parsed?.cards.length === 0)}
            onClick={importNow}
            className="rounded-md bg-indigo-600 px-3 py-1 text-meta font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40"
          >
            Import board
          </button>
        </footer>
      </div>
    </div>
  )
}
