import { useState } from 'react'
import { Plus, Shapes, Trash2, X } from 'lucide-react'
import { useStore } from '@/store'

/** Custom issue types: name + colour. Columns live on boards, not types. */
export function TypeEditor() {
  const issueTypes = useStore((s) => s.issueTypes)
  const updateIssueType = useStore((s) => s.updateIssueType)
  const addIssueType = useStore((s) => s.addIssueType)
  const removeIssueType = useStore((s) => s.removeIssueType)
  const close = useStore((s) => s.toggleTypeEditor)

  const [name, setName] = useState('')
  const [color, setColor] = useState('#0ea5e9')
  const initiativeTypeId = issueTypes.find((t) => t.name === 'Initiative')?.id
  const nameIsReserved = name.trim().toLowerCase() === 'initiative'

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onClick={close}>
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Shapes size={16} className="text-indigo-600" />
          <span className="text-sm font-semibold text-slate-800">Issue types</span>
          <button onClick={close} className="ml-auto text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto px-4 py-3">
          {issueTypes.map((t) => {
            const reserved = t.id === initiativeTypeId
            return (
              <div key={t.id} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5">
                <input
                  type="color"
                  value={t.color}
                  disabled={reserved}
                  onChange={(e) => updateIssueType(t.id, { color: e.target.value })}
                  className="h-6 w-6 cursor-pointer rounded border border-slate-200 bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  title="Type colour"
                />
                <input
                  value={t.name}
                  readOnly={reserved}
                  onChange={(e) => updateIssueType(t.id, { name: e.target.value })}
                  className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-[12px] font-medium text-slate-800 hover:border-slate-200 focus:border-indigo-300 focus:outline-none read-only:text-slate-500"
                  title={reserved ? 'Reserved for the Initiatives workflow' : undefined}
                />
                {reserved ? (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500" title="Initiative is reserved for the Initiatives workflow">
                    reserved
                  </span>
                ) : (
                  <button onClick={() => removeIssueType(t.id)} className="text-slate-300 hover:text-rose-500" title="Delete type">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-7 w-7 cursor-pointer rounded border border-slate-200 bg-white"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New type name (e.g. Risk, Spike, Task)"
            className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1 text-[12px] outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button
            disabled={name.trim().length < 2 || nameIsReserved}
            onClick={() => {
              addIssueType(name.trim(), color)
              setName('')
            }}
            className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            <Plus size={13} /> Add
          </button>
        </div>
        <p className="px-4 pb-3 text-[10px] text-slate-400">
          Types are labels + colour. A board defines its own columns; any type can sit in any column.{' '}
          <span className="font-medium text-slate-500">Initiative is reserved for the Initiatives workflow.</span>
        </p>
      </div>
    </div>
  )
}
